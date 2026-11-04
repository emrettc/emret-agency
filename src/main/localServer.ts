/**
 * Hızlı yerel motor — llama.cpp'nin kendi sunucusu (`llama-server`) + ajan belleği.
 *
 * NEDEN: Ollama tek yuvada aynı anda yalnız bir ajanın istem önbelleğini (KV)
 * tutar; sıra başka ajana geçince silinir ve ajan dönünce konuşmasının tamamını
 * baştan okur (65k token ≈ 56 sn, ölçüm 2026-11-03). Ollama yuvayı dışarı açmaz;
 * llama-server açar: `/slots/0?action=save|restore`.
 *
 * NASIL: sıra görevlisi (localGate.ts) modele giren ajan değişince önce eskisinin
 * belleğini diske kaydeder (`<ajan>.bin`), sonra yenisininkini (varsa) geri yükler.
 * Ölçüm: 51k tokenlık konuşma — kaydetme 2,0 sn, geri yükleme 1,5 sn, devam 0,8 sn;
 * geri yüklemesiz 30,5 sn. Kayıt klasörü HIZLI bir diskte olmalı (C: 102 MB/sn
 * iken 23 sn sürdü; D: 1,7 GB/sn).
 *
 * Sunucu uygulamayla açılır/kapanır; aynı adreste zaten bir sunucu çalışıyorsa
 * ona dokunulmaz (elle başlatılmış olabilir).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalServerConfig {
  enabled: boolean;
  /** llama-server.exe yolu. */
  binPath: string;
  /** GGUF model dosyası. */
  modelPath: string;
  /** İsteklerdeki model adı (ör. `emrettc-genel`). */
  alias: string;
  port: number;
  /** Bağlam penceresi (token). */
  ctx: number;
  /** Ajan belleklerinin kaydedildiği klasör (hızlı disk). */
  slotDir: string;
  /** Klasörün üst sınırı (GB); aşılınca en eski kayıtlar silinir. */
  maxSlotGb?: number;
  /** Ek örnekleme/sunucu argümanları. */
  extraArgs?: string[];
}

export interface SlotMemoryStatus { dir: string; agents: number; totalGb: number }

/** Ajan kimliği → güvenli dosya adı. */
export function slotFileName(agentId: string): string {
  return `${agentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'ajan'}.bin`;
}

/** Sınırı aşan klasörde silinecek dosyalar: en eskiden başlayarak, toplam sınırın altına inene kadar. */
export function filesToPrune(files: Array<{ name: string; size: number; mtime: number }>, maxBytes: number, keep?: string): string[] {
  let total = files.reduce((a, f) => a + f.size, 0);
  const out: string[] = [];
  for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes) break;
    if (f.name === keep) continue;
    out.push(f.name);
    total -= f.size;
  }
  return out;
}

/**
 * Önbellek varsayılanı q8_0 (ölçüm 2026-11-03, RTX 3080 10 GB, 47k token):
 * ekran kartında −0,5 GB, ajan kaydı 3,2 → 1,5 GB, kaydet 2,0 → 1,25 sn,
 * geri yükle 1,5 → 1,0 sn; okuma ~%7 yavaş. extraArgs'ta -ctk verilirse o geçer.
 */
export function serverArgs(c: LocalServerConfig): string[] {
  const extra = c.extraArgs ?? [];
  return [
    '-m', c.modelPath, '--alias', c.alias,
    '-c', String(c.ctx), '-np', '1', '-ngl', '99', '-fa', 'on', '--jinja',
    ...(extra.includes('-ctk') ? [] : ['-ctk', 'q8_0', '-ctv', 'q8_0']),
    '--slot-save-path', c.slotDir,
    '--host', '127.0.0.1', '--port', String(c.port),
    ...extra
  ];
}

export class LocalServer {
  private child: ChildProcess | null = null;
  private cfg: LocalServerConfig | null = null;

  constructor(private readonly log: (m: string) => void = () => {}) {}

  base(): string | null { return this.cfg ? `http://127.0.0.1:${this.cfg.port}` : null; }

  async healthy(timeoutMs = 2000): Promise<boolean> {
    const b = this.base();
    if (!b) return false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { return (await fetch(`${b}/health`, { signal: ctl.signal })).ok; } catch { return false; } finally { clearTimeout(t); }
  }

  /** Sunucuyu başlat (zaten çalışıyorsa dokunma). */
  async start(cfg: LocalServerConfig): Promise<void> {
    this.cfg = cfg;
    if (!cfg.enabled) return;
    try { mkdirSync(cfg.slotDir, { recursive: true }); } catch { /* aşağıda hata verir */ }
    if (await this.healthy()) { this.log(`[yerel motor] llama-server zaten çalışıyor (${this.base()})`); return; }
    if (!existsSync(cfg.binPath) || !existsSync(cfg.modelPath)) {
      this.log(`[yerel motor] llama-server ya da model bulunamadı: ${cfg.binPath} / ${cfg.modelPath}`);
      return;
    }
    const child = spawn(cfg.binPath, serverArgs(cfg), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    child.stderr?.on('data', (d: Buffer) => {
      // Yalnız hata satırları; renk kodları atılır (sunucu her isteği yazar).
      for (const line of d.toString().replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
        if (/\b(E|error|failed|out of memory)\b/i.test(line) && !line.includes('common_fit_params')) this.log(`[yerel motor] ${line.trim().slice(0, 300)}`);
      }
    });
    child.on('exit', (code) => { if (this.child === child) this.child = null; this.log(`[yerel motor] llama-server kapandı (kod ${code})`); });
    this.log(`[yerel motor] llama-server başlatıldı (${this.base()}, bağlam ${cfg.ctx})`);
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private async slotAction(action: 'save' | 'restore', agentId: string): Promise<boolean> {
    const b = this.base();
    if (!b) return false;
    const r = await fetch(`${b}/slots/0?action=${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: slotFileName(agentId) })
    });
    return r.ok;
  }

  /** Yuvadaki (modeldeki) ajanın belleğini diske kaydet. */
  async save(agentId: string): Promise<boolean> {
    const ok = await this.slotAction('save', agentId);
    this.prune(slotFileName(agentId));
    return ok;
  }

  /** Ajanın kayıtlı belleğini yuvaya geri yükle; kayıt yoksa false. */
  async restore(agentId: string): Promise<boolean> {
    if (!this.cfg || !existsSync(join(this.cfg.slotDir, slotFileName(agentId)))) return false;
    return this.slotAction('restore', agentId);
  }

  private files(): Array<{ name: string; size: number; mtime: number }> {
    if (!this.cfg) return [];
    try {
      return readdirSync(this.cfg.slotDir).filter((n) => n.endsWith('.bin')).map((name) => {
        const s = statSync(join(this.cfg!.slotDir, name));
        return { name, size: s.size, mtime: s.mtimeMs };
      });
    } catch { return []; }
  }

  private prune(keep: string): void {
    if (!this.cfg) return;
    const max = (this.cfg.maxSlotGb ?? 60) * 1024 ** 3;
    for (const name of filesToPrune(this.files(), max, keep)) {
      try { unlinkSync(join(this.cfg.slotDir, name)); } catch { /* kullanımda olabilir */ }
    }
  }

  memoryStatus(): SlotMemoryStatus | null {
    if (!this.cfg?.enabled) return null;
    const f = this.files();
    return { dir: this.cfg.slotDir, agents: f.length, totalGb: Math.round((f.reduce((a, x) => a + x.size, 0) / 1024 ** 3) * 10) / 10 };
  }
}
