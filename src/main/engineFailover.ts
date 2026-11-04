/**
 * Otomatik motor geçişi — main tarafı. Saf kurallar shared/engineHealth.ts ve
 * shared/byokEndpoints.ts (resolveAgentEngine) içinde; bu sınıf yalnız
 * gözlemler ve tetikler:
 *  - Claude Code ajanlarının PTY çıktısını limit satırları için tarar,
 *  - OpenCode log dosyasını `stream error` satırları için izler,
 *  - bir motor kapanınca / açılınca canlı ajanların olması gereken motorunu
 *    yeniden çözer, farklıysa renderer'dan ajanı yeniden başlatmasını ister
 *    (spawnAgentCore yeni motoru spawn anında uygular).
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EngineHealth, detectAnthropicWireError, detectClaudeLimit, parseOpencodeLogLine, CLAUDE_ENGINE, type EngineFailure } from '../shared/engineHealth';
import type { AgentEnginePin, EndpointWire } from '../shared/byokEndpoints';

export interface TrackedPty {
  agentId: string;
  role?: string;
  isGod?: boolean;
  wire: EndpointWire;
  /** Ajanın ŞU AN çalıştığı motor: 'claude' ya da uç nokta kimliği. */
  engine: string;
  /** Komuttaki `--model <uç-nokta>/<model>`'den türetilen örtük pin (OpenCode). */
  pin?: AgentEnginePin;
}

export interface EngineFailoverDeps {
  autoEnabled(): boolean;
  /** Ajanın olması gereken motor (isDown'a göre); null ⇒ dokunma. */
  desiredEngine(t: TrackedPty, isDown: (engine: string) => boolean): string | null;
  alive(ptyId: string): boolean;
  idleMs(ptyId: string): number;
  requestSwitch(ptyId: string, from: string, to: string, reason: string): void;
  log(event: Record<string, unknown>): void;
  opencodeLogPath: string;
  /** Motor durumunun diskteki yeri (yeniden açılışta ajanlar doğrudan sağlıklı
   *  motorda başlasın); null ⇒ yalnız bellekte. */
  statePath?(): string | null;
  /** god'un motor komut klasörü (hive/motor-komut); null ⇒ komut yok. */
  commandDir?(): string | null;
  /** Yeni bir kesinti başladı — insana haber ver (aynı kesintide bir kez). */
  notifyDown?(engine: string, f: EngineFailure & { sinceMs: number }): void;
}

const TICK_MS = 15_000;
/** Asıl motora geri dönüş yalnız ajan bu kadar süredir sessizse (iş ortasında kesmesin). */
const FAILBACK_IDLE_MS = 60_000;
/** Aynı ajanı bu süreden sık yeniden başlatma (motorlar arası gidip gelmeyi önler). */
const SWITCH_COOLDOWN_MS = 120_000;
/** Aynı anda birden çok PTY'yi öldürüp yeniden başlatmak Windows'ta (node-pty /
 *  ConPTY) ana süreci çökertebiliyor (canlıda 5 eşzamanlı geçiş ⇒ segfault).
 *  Geçişler bu aralıkla sıraya dizilir; god en sona kalır. */
const SWITCH_STAGGER_MS = 5_000;
const CLAUDE_SCAN_WINDOW = 4096;
const LOG_READ_MAX = 256 * 1024;

export class EngineFailover {
  readonly health = new EngineHealth();
  private ptys = new Map<string, TrackedPty>();
  private scan = new Map<string, string>();
  private lastSwitch = new Map<string, number>();
  private logPos = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Sıradaki geçişin en erken zamanı (sıralama için). */
  private nextSwitchAt = 0;
  private loaded = false;

  constructor(private deps: EngineFailoverDeps) {}

  /** Diskteki durumu bir kez yükle (hive kökü spawn'dan önce hazır olmayabilir). */
  private ensureLoaded(): void {
    if (this.loaded) return;
    const p = this.deps.statePath?.();
    if (!p) return;
    this.loaded = true;
    try { this.health.restore(JSON.parse(readFileSync(p, 'utf8')), Date.now()); } catch { /* yok / bozuk */ }
  }

  private save(): void {
    const p = this.deps.statePath?.();
    if (!p) return;
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(this.health.snapshot(Date.now()), null, 2), 'utf8');
    } catch { /* best-effort */ }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  track(ptyId: string, t: TrackedPty): void {
    this.ptys.set(ptyId, t);
    this.scan.delete(ptyId);
  }

  untrack(ptyId: string): void {
    this.ptys.delete(ptyId);
    this.scan.delete(ptyId);
  }

  isDown = (engine: string): boolean => {
    this.ensureLoaded();
    return this.health.isDown(engine, Date.now());
  };

  /** PtyManager veri gözlemcisi: Claude Code ajanları taranır — yerel Claude
   *  motorunda limit satırları, bir BYOK uç noktasının Anthropic teli üzerindeyse
   *  (EVREN, Kimi…) o uç noktanın `API Error` satırları. Böylece yedeğe geçmiş bir
   *  ajan yedek de bozulunca orada takılı kalmaz. OpenCode hataları log'dan gelir. */
  onPtyData(ptyId: string, data: string): void {
    const t = this.ptys.get(ptyId);
    if (!t || t.wire !== 'anthropic') return;
    const buf = ((this.scan.get(ptyId) ?? '') + data).slice(-CLAUDE_SCAN_WINDOW);
    this.scan.set(ptyId, buf);
    const now = new Date();
    const f = t.engine === CLAUDE_ENGINE ? detectClaudeLimit(buf, now) : detectAnthropicWireError(buf, now);
    if (!f) return;
    this.scan.delete(ptyId);
    this.reportDown(t.engine, f, t.agentId);
  }

  /** god'un motor komutları: `motor-komut/<ad>.json` →
   *  `{ "motor": "evren", "durum": "kapali", "dakika": 60, "neden": "…" }` ya da
   *  `{ "motor": "evren", "durum": "acik" }`. İşlenen dosya `.done/` altına taşınır. */
  private pollCommands(): void {
    const dir = this.deps.commandDir?.();
    if (!dir) return;
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return; }
    for (const file of files) {
      const path = join(dir, file);
      let result: string;
      try {
        result = this.applyCommand(JSON.parse(readFileSync(path, 'utf8')));
      } catch (e) {
        result = `geçersiz komut: ${e instanceof Error ? e.message : String(e)}`;
      }
      this.deps.log({ kind: 'engine-command', file, result });
      console.log(`[motor] komut ${file}: ${result}`);
      try {
        mkdirSync(join(dir, '.done'), { recursive: true });
        renameSync(path, join(dir, '.done', file));
      } catch { try { rmSync(path, { force: true }); } catch { /* noop */ } }
    }
  }

  applyCommand(cmd: unknown, nowMs = Date.now()): string {
    if (!cmd || typeof cmd !== 'object') return 'geçersiz komut: nesne değil';
    const c = cmd as { motor?: unknown; durum?: unknown; dakika?: unknown; neden?: unknown };
    const engine = typeof c.motor === 'string' ? c.motor.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(engine)) return 'geçersiz komut: motor adı yok';
    const neden = typeof c.neden === 'string' ? c.neden.slice(0, 160) : 'god kararı';
    if (c.durum === 'acik') {
      const was = this.health.clear(engine);
      this.save();
      this.evaluate();
      return was ? `${engine} açıldı` : `${engine} zaten açıktı`;
    }
    if (c.durum !== 'kapali') return 'geçersiz komut: durum "kapali" ya da "acik" olmalı';
    const dakika = Math.min(Math.max(Number(c.dakika) || 60, 1), 7 * 24 * 60);
    this.reportDown(engine, { reason: 'unavailable', untilMs: nowMs + dakika * 60_000, detail: `god: ${neden}` });
    return `${engine} ${dakika} dk kapalı`;
  }

  reportDown(engine: string, f: EngineFailure, agentId?: string): void {
    this.ensureLoaded();
    const wasDown = this.health.isDown(engine, Date.now());
    if (!this.health.markDown(engine, f, Date.now())) return;
    this.save();
    // Yalnız yeni kesintide: süresi uzatılan bir kesinti için ikinci uyarı yok.
    if (!wasDown) {
      const state = this.health.snapshot(Date.now()).find((s) => s.engine === engine);
      try { if (state) this.deps.notifyDown?.(engine, state); } catch { /* best-effort */ }
    }
    this.deps.log({ kind: 'engine-down', engine, reason: f.reason, until: new Date(f.untilMs).toISOString(), detail: f.detail, ...(agentId ? { agentId } : {}) });
    console.warn(`[motor] ${engine} kapalı (${f.reason}) → ${new Date(f.untilMs).toLocaleString()} — ${f.detail}`);
    this.evaluate();
  }

  tick(): void {
    try {
      this.ensureLoaded();
      const up = this.health.expire(Date.now());
      for (const engine of up) {
        this.deps.log({ kind: 'engine-up', engine });
        console.log(`[motor] ${engine} yeniden açık`);
      }
      if (up.length) this.save();
      this.pollCommands();
      this.pollOpencodeLog();
      this.evaluate();
    } catch (e) { console.error('[motor] tick failed:', e); }
  }

  /** OpenCode log dosyasının yalnız YENİ kısmını oku (ilk açılışta geçmiş atlanır). */
  private pollOpencodeLog(): void {
    let size: number;
    try { size = statSync(this.deps.opencodeLogPath).size; } catch { return; }
    if (this.logPos < 0 || size < this.logPos) { this.logPos = size; return; }
    if (size === this.logPos) return;
    const start = Math.max(this.logPos, size - LOG_READ_MAX);
    const len = size - start;
    const buf = Buffer.alloc(len);
    let fd: number | null = null;
    try {
      fd = openSync(this.deps.opencodeLogPath, 'r');
      readSync(fd, buf, 0, len, start);
    } catch { return; } finally { if (fd !== null) try { closeSync(fd); } catch { /* noop */ } }
    const text = buf.toString('utf8');
    // Yarım kalan son satırı bir sonraki okumaya bırak.
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    this.logPos = start + Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
    const now = new Date();
    for (const line of text.slice(0, lastNl).split('\n')) {
      const hit = parseOpencodeLogLine(line, now);
      if (hit) this.reportDown(hit.engine, hit.failure);
    }
  }

  /** Her canlı ajan için olması gereken motoru çöz; farklıysa geçişi iste. */
  evaluate(): void {
    if (!this.deps.autoEnabled()) return;
    const now = Date.now();
    // god en sona: orkestratör en son kesilsin.
    const order = [...this.ptys].sort(([, a], [, b]) => Number(!!a.isGod) - Number(!!b.isGod));
    for (const [ptyId, t] of order) {
      if (!this.deps.alive(ptyId)) { this.untrack(ptyId); continue; }
      const want = this.deps.desiredEngine(t, this.isDown);
      if (!want || want === t.engine) continue;
      const failingOver = this.health.isDown(t.engine, now);
      if (!failingOver && this.deps.idleMs(ptyId) < FAILBACK_IDLE_MS) continue;
      if (now - (this.lastSwitch.get(ptyId) ?? 0) < SWITCH_COOLDOWN_MS) continue;
      this.lastSwitch.set(ptyId, now);
      const reason = failingOver ? `${t.engine} kapalı` : `${want} yeniden açık`;
      this.deps.log({ kind: 'engine-switch', agentId: t.agentId, from: t.engine, to: want, reason });
      const delay = Math.max(0, this.nextSwitchAt - now);
      this.nextSwitchAt = now + delay + SWITCH_STAGGER_MS;
      console.log(`[motor] ${t.agentId}: ${t.engine} → ${want} (${reason})${delay ? ` — ${Math.round(delay / 1000)} sn sonra` : ''}`);
      const from = t.engine;
      const go = (): void => {
        if (this.deps.alive(ptyId)) this.deps.requestSwitch(ptyId, from, want, reason);
      };
      if (delay === 0) go();
      else setTimeout(go, delay).unref?.();
    }
  }
}
