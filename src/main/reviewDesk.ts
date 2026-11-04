/**
 * İnceleme ve Birleştirme Masası — ajanların kendi dallarında yaptığı işin
 * kullanıcı onayıyla ana dala alınması.
 *
 * Yalıtılmış her ajan `<harnessHome>/worktrees/<ajan-id>` altında, `agent/<id>`
 * dalında çalışır (git.ts addWorktree). Masa bu worktree'leri tarar; ana dala
 * alınmamış commit'i ya da kaydedilmemiş değişikliği olan her biri bir inceleme
 * kalemidir. Kullanıcı farkı görür, testleri çalıştırır, birleştirir, düzeltme
 * ister ya da reddeder; birleştirme geri alınabilir.
 *
 * Güvenlik kuralları:
 *  - Ana klasörde kaydedilmemiş (izlenen) değişiklik varsa birleştirme reddedilir:
 *    kullanıcının yarım işi asla ezilmez.
 *  - Çakışma çıkarsa birleştirme geri alınır (`merge --abort`) ve söylenir.
 *  - Testleri geçmemiş iş, açıkça `force` denmedikçe birleştirilmez.
 * Durum (test sonuçları, birleştirme geçmişi) `<hive>/review-desk.json`'da.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { mainRepoRoot, removeWorktree, runGit } from './git';

export interface ReviewCommit { sha: string; subject: string; date: string }
export interface ReviewFile { path: string; added: number; removed: number }
export interface ReviewTests { ok: boolean; at: string; head: string; output: string; skipped?: boolean }

export interface ReviewItem {
  /** Dal adı (`agent/<id>`) — kalemin kimliği. */
  id: string;
  agentId: string;
  branch: string;
  wtPath: string;
  repo: string;
  repoName: string;
  baseBranch: string;
  head: string;
  ahead: number;
  dirty: boolean;
  commits: ReviewCommit[];
  files: ReviewFile[];
  updatedAt: string;
  tests?: ReviewTests;
  hasTestScript: boolean;
}

export interface ReviewMerge { branch: string; sha: string; repo: string; base: string; at: string; reverted?: boolean }

interface DeskState { tests: Record<string, ReviewTests>; merges: ReviewMerge[] }

const LONG = 60_000;

export class ReviewDesk {
  constructor(
    private readonly worktreesRoot: () => string | null,
    private readonly statePath: () => string | null
  ) {}

  private read(): DeskState {
    const p = this.statePath();
    try {
      if (p && existsSync(p)) {
        const s = JSON.parse(readFileSync(p, 'utf8')) as Partial<DeskState>;
        return { tests: s.tests ?? {}, merges: Array.isArray(s.merges) ? s.merges : [] };
      }
    } catch { /* bozuk dosya → boş durum */ }
    return { tests: {}, merges: [] };
  }

  private write(s: DeskState): void {
    const p = this.statePath();
    if (!p) return;
    try { writeFileSync(`${p}.tmp`, JSON.stringify(s, null, 2)); renameSync(`${p}.tmp`, p); } catch { /* best-effort */ }
  }

  /** İncelenecek bütün kalemler, en yeniden eskiye. */
  async list(): Promise<ReviewItem[]> {
    const root = this.worktreesRoot();
    if (!root || !existsSync(root)) return [];
    const state = this.read();
    const out: ReviewItem[] = [];
    for (const name of readdirSync(root)) {
      const wtPath = join(root, name);
      try { if (!statSync(wtPath).isDirectory()) continue; } catch { continue; }
      const item = await this.inspect(wtPath, name, state);
      if (item) out.push(item);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async inspect(wtPath: string, name: string, state: DeskState): Promise<ReviewItem | null> {
    const br = await runGit(wtPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!br.ok) return null;
    const branch = br.stdout.trim();
    if (!branch.startsWith('agent/')) return null;
    const repo = await mainRepoRoot(wtPath);
    if (!repo) return null;
    const baseRes = await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const baseBranch = baseRes.ok ? baseRes.stdout.trim() : 'main';
    if (!baseBranch || baseBranch === 'HEAD' || baseBranch === branch) return null;
    const headRes = await runGit(wtPath, ['rev-parse', 'HEAD']);
    const head = headRes.ok ? headRes.stdout.trim() : '';
    const aheadRes = await runGit(wtPath, ['rev-list', '--count', `${baseBranch}..HEAD`]);
    const ahead = aheadRes.ok ? Number(aheadRes.stdout.trim()) || 0 : 0;
    const status = await runGit(wtPath, ['status', '--porcelain']);
    const dirty = status.ok ? status.stdout.trim().length > 0 : false;
    if (ahead === 0 && !dirty) return null;

    const log = await runGit(wtPath, ['log', `${baseBranch}..HEAD`, '-n', '30', '--format=%h%x09%s%x09%cI']);
    const commits: ReviewCommit[] = log.ok
      ? log.stdout.trim().split('\n').filter(Boolean).map((l) => { const [sha, subject, date] = l.split('\t'); return { sha, subject, date }; })
      : [];
    // Commit'lenmiş fark + kaydedilmemiş değişiklikler, dalın ana daldan AYRILDIĞI
    // noktaya göre: ana dalın şimdiki haline göre alınsa, dal açıldıktan sonra ana
    // dala giren her şey de ajanın "değişikliği" sayılırdı (3000+ dosya görünüyordu).
    const forkPoint = await this.forkPoint(wtPath, baseBranch);
    const numstat = await runGit(wtPath, ['diff', '--numstat', forkPoint]);
    const files: ReviewFile[] = numstat.ok
      ? numstat.stdout.trim().split('\n').filter(Boolean).map((l) => {
        const [a, r, ...p] = l.split('\t');
        return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 };
      })
      : [];
    let updatedAt = commits[0]?.date ?? '';
    try { const m = statSync(wtPath).mtime.toISOString(); if (!updatedAt || m > updatedAt) updatedAt = m; } catch { /* noop */ }
    let hasTestScript = false;
    try {
      const pkg = JSON.parse(readFileSync(join(wtPath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
      hasTestScript = typeof pkg.scripts?.test === 'string' && !/no test specified/.test(pkg.scripts.test);
    } catch { /* package.json yok */ }
    const tests = state.tests[branch];
    return {
      id: branch, agentId: name, branch, wtPath, repo, repoName: repo.split(/[\\/]/).filter(Boolean).pop() ?? repo,
      baseBranch, head, ahead, dirty, commits, files, updatedAt,
      ...(tests && tests.head === head ? { tests } : {}),
      hasTestScript
    };
  }

  /** Dalın ana daldan ayrıldığı commit (bulunamazsa ana dalın kendisi). */
  private async forkPoint(wtPath: string, baseBranch: string): Promise<string> {
    const mb = await runGit(wtPath, ['merge-base', baseBranch, 'HEAD']);
    return mb.ok && mb.stdout.trim() ? mb.stdout.trim() : baseBranch;
  }

  private async find(id: string): Promise<ReviewItem | null> {
    return (await this.list()).find((x) => x.id === id) ?? null;
  }

  /** Ana dala göre fark (dosya verilirse yalnız o dosya), en çok 400 KB. */
  async diff(id: string, file?: string): Promise<{ ok: boolean; diff?: string; error?: string }> {
    const it = await this.find(id);
    if (!it) return { ok: false, error: 'kalem bulunamadı' };
    const args = ['diff', await this.forkPoint(it.wtPath, it.baseBranch)];
    if (file) args.push('--', file);
    const r = await runGit(it.wtPath, args, LONG);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, diff: r.stdout.length > 400_000 ? `${r.stdout.slice(0, 400_000)}\n… (fark kısaltıldı)` : r.stdout };
  }

  /** Projenin kendi testleri (`npm test`) ajanın worktree'sinde, en çok 10 dk. */
  async runTests(id: string): Promise<ReviewTests | { ok: false; error: string }> {
    const it = await this.find(id);
    if (!it) return { ok: false, error: 'kalem bulunamadı' };
    const state = this.read();
    let result: ReviewTests;
    if (!it.hasTestScript) {
      result = { ok: true, skipped: true, at: new Date().toISOString(), head: it.head, output: 'Bu projede test komutu yok (package.json → scripts.test).' };
    } else {
      result = await new Promise<ReviewTests>((resolve) => {
        const proc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], { cwd: it.wtPath, shell: process.platform === 'win32', env: { ...process.env, CI: '1' } });
        let out = '';
        const keep = (d: Buffer): void => { out += d.toString(); if (out.length > 200_000) out = out.slice(-100_000); };
        proc.stdout.on('data', keep);
        proc.stderr.on('data', keep);
        const timer = setTimeout(() => { try { proc.kill(); } catch { /* noop */ } out += '\n… 10 dakikada bitmedi, durduruldu.'; }, 10 * LONG);
        proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, at: new Date().toISOString(), head: it.head, output: e.message }); });
        proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, at: new Date().toISOString(), head: it.head, output: out.slice(-6000) }); });
      });
    }
    state.tests[it.branch] = result;
    this.write(state);
    return result;
  }

  /** Ajanın dalını ana dala birleştir (`--no-ff`). */
  async merge(id: string, force = false): Promise<{ ok: boolean; error?: string; sha?: string }> {
    const it = await this.find(id);
    if (!it) return { ok: false, error: 'kalem bulunamadı' };
    if (it.ahead === 0) return { ok: false, error: 'Birleştirilecek commit yok — ajanın değişiklikleri henüz kaydedilmemiş (commit). Ajandan commit etmesini iste.' };
    if (it.hasTestScript && !force && !(it.tests?.ok)) {
      return { ok: false, error: it.tests ? 'Testler geçmedi. Düzeltme iste ya da "yine de birleştir" de.' : 'Testler henüz çalıştırılmadı. Önce "Testleri çalıştır" de ya da "yine de birleştir" seç.' };
    }
    const cur = await runGit(it.repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!cur.ok || cur.stdout.trim() !== it.baseBranch) return { ok: false, error: `Ana klasör ${it.baseBranch} dalında değil.` };
    const dirty = await runGit(it.repo, ['status', '--porcelain', '--untracked-files=no']);
    if (!dirty.ok) return { ok: false, error: dirty.error };
    if (dirty.stdout.trim()) return { ok: false, error: 'Ana klasörde kaydedilmemiş değişiklikler var — yarım işini ezmemek için birleştirme yapılmadı. Önce onları commit et ya da kenara al.' };
    const msg = `Birleştir: ${it.branch} → ${it.baseBranch} (İnceleme Masası)`;
    const m = await runGit(it.repo, ['merge', '--no-ff', '-m', msg, it.branch], LONG);
    if (!m.ok) {
      await runGit(it.repo, ['merge', '--abort']);
      return { ok: false, error: /conflict|çakışma/i.test(m.error) ? `Çakışma çıktı, birleştirme geri alındı. Ajandan dalını ${it.baseBranch} ile güncellemesini iste.` : m.error };
    }
    const shaRes = await runGit(it.repo, ['rev-parse', 'HEAD']);
    const sha = shaRes.ok ? shaRes.stdout.trim() : '';
    const state = this.read();
    state.merges.unshift({ branch: it.branch, sha, repo: it.repo, base: it.baseBranch, at: new Date().toISOString() });
    state.merges = state.merges.slice(0, 50);
    this.write(state);
    return { ok: true, sha };
  }

  /** Son birleştirmeler (geri alma için). */
  merges(): ReviewMerge[] { return this.read().merges; }

  /** Bir birleştirmeyi geri al (`git revert -m 1`). */
  async undo(sha: string): Promise<{ ok: boolean; error?: string }> {
    const state = this.read();
    const m = state.merges.find((x) => x.sha === sha);
    if (!m) return { ok: false, error: 'birleştirme kaydı yok' };
    if (m.reverted) return { ok: false, error: 'zaten geri alındı' };
    const dirty = await runGit(m.repo, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty.ok && dirty.stdout.trim()) return { ok: false, error: 'Ana klasörde kaydedilmemiş değişiklikler var — önce onları commit et.' };
    const r = await runGit(m.repo, ['revert', '-m', '1', '--no-edit', sha], LONG);
    if (!r.ok) { await runGit(m.repo, ['revert', '--abort']); return { ok: false, error: r.error }; }
    m.reverted = true;
    this.write(state);
    return { ok: true };
  }

  /** Reddet: worktree'yi ve dalını sil (geri alınamaz). */
  async reject(id: string): Promise<{ ok: boolean; error?: string }> {
    const it = await this.find(id);
    if (!it) return { ok: false, error: 'kalem bulunamadı' };
    const rm = await removeWorktree(it.repo, it.wtPath);
    if (!rm.ok) return rm;
    const del = await runGit(it.repo, ['branch', '-D', it.branch]);
    const state = this.read();
    delete state.tests[it.branch];
    this.write(state);
    return del.ok ? { ok: true } : { ok: false, error: del.error };
  }
}
