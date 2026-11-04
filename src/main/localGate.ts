/**
 * Yerel model sıra görevlisi — ajanlar ile Ollama arasında küçük bir vekil.
 *
 * SORUN: tek GPU'da tek model, ona ~10 ajan. Ajanlar karışık sırayla geldikçe
 * modelin istem önbelleği (KV cache) her istekte başka ajanın istemiyle ezilir ve
 * her istek 15k+ tokenlık istemi BAŞTAN okur; üstüne hepsi aynı kuyrukta bekler.
 *
 * ÇÖZÜM: aynı anda yalnız `concurrency` ajan modele girer (Ollama da o kadar
 * paralel yuvayla çalışır). Giren ajan işi boyunca yerini TUTAR — yuvasındaki
 * önbellek onun istemiyle sıcak kalır, sonraki isteklerinde yalnız yeni kısım
 * okunur. Ajan `idleReleaseMs` boyunca istek atmazsa (turu bitti) yerini bırakır
 * ve sıradaki ajan girer. Adalet: başkası bekliyorsa hiçbir ajan `maxHoldMs`'ten
 * uzun tutamaz (o an isteği yoksa sırasını verir).
 *
 * Öncelik: sırada bekleyenlerden önce `priority()` listesinde üstte olan girer
 * (listede olmayanlar en sonda, kendi aralarında geliş sırasıyla).
 *
 * Ajan belleği: `slotStore()` verilirse (llama-server, aynı anda 1 ajan) modele
 * giren ajan değişince önce eskisinin belleği kaydedilir, sonra yenisininki geri
 * yüklenir — ajan konuşmasını baştan okumaz (bkz. localServer.ts).
 *
 * Taşma (`spill`): ajan yerel sırada `afterMs`'ten uzun beklerse isteği sırayla
 * API motorlarına (önce ücretsiz, sonra ücretli — sırayı main verir) gönderilir;
 * ajan yeniden başlatılmaz, yalnız o istek başka modele gider. Motor hata verirse
 * (kota, kredi, anahtar, 5xx) sıradakine geçilir; hiçbiri olmazsa ajan yerel
 * sırada beklemeye devam eder. Taşan ajan bir süre (STICKY_MS) yerel sıra doluyken
 * beklemeden taşar.
 *
 * Ölçüm: her model isteğinin sırada bekleme, ilk yanıt ve toplam süresi ile
 * istenen model adı son `RECENT_MAX` istek için tutulur (Ayarlar'daki gösterge).
 *
 * Ajan kimliği istekteki anahtardan okunur (`gate-<ajan-id>`; main spawn'da verir),
 * Ollama'ya `Bearer ollama` ile iletilir. Hedef uç nokta yoldan seçilir:
 * `/e/<uç-nokta-id>/<geri kalanı>` → o uç noktanın gerçek adresi + geri kalanı.
 * Yanıtlar (SSE akışı dahil) olduğu gibi aktarılır. Yalnız 127.0.0.1'e bağlanır.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDate } from '../shared/dailySummary';

export const GATE_KEY_PREFIX = 'gate-';

export interface GateOptions {
  /** Uç nokta kimliği → gerçek taban adres (ör. `http://localhost:11434`). */
  resolveTarget: (endpointId: string) => string | null;
  concurrency: () => number;
  /** Öncelik sırası (ajan kimlikleri, üstteki önce girer). */
  priority?: () => string[];
  /** Ajan belleği deposu; null ⇒ kapalı. Yalnız aynı anda 1 ajanda kullanılır. */
  slotStore?: () => SlotStore | null;
  /** Taşma: yerel sıra uzarsa API motorları. */
  spill?: {
    /** Yerel sırada en çok bu kadar beklenir; 0 ⇒ taşma kapalı. */
    afterMs: () => number;
    /** Bu tel için sıradaki kullanılabilir motorlar (önce ücretsiz, sonra ücretli). */
    targets: (wire: SpillWire) => SpillTarget[];
    /** Motor hata verdi (kota/kredi/anahtar/erişim): main onu bir süre kapalı sayar. */
    onFailure?: (engineId: string, status: number, detail: string) => void;
  };
  idleReleaseMs?: number;
  maxHoldMs?: number;
  log?: (msg: string) => void;
}

export type SpillWire = 'openai' | 'anthropic';

export interface SpillTarget {
  /** Uç nokta kimliği (ör. `evren`). */
  id: string;
  /** Taban adres: openai ⇒ `…/v1`, anthropic ⇒ `/v1/messages` öncesi kök. */
  base: string;
  model: string;
  key: string;
}

/** Taşan ajan, yerel sıra doluyken bu süre boyunca beklemeden taşar. */
const STICKY_MS = 10 * 60_000;

/** İstek yolu → tel; model isteği değilse null. */
export function spillWireOf(path: string): SpillWire | null {
  if (/^\/v1\/chat\/completions(\?|$)/.test(path)) return 'openai';
  if (/^\/v1\/messages(\?|$)/.test(path)) return 'anthropic';
  return null;
}

/** Yerel sunucunun "istem bağlama sığmıyor" hatası mı? */
export function isContextOverflow(body: string): boolean {
  return /exceeds the available context size|context (length|window) exceeded|prompt is too long/i.test(body);
}

/** Taşma hedefinin tam adresi. */
export function spillUrl(t: SpillTarget, wire: SpillWire, path: string): string {
  const b = t.base.replace(/\/+$/, '');
  return wire === 'openai' ? b + path.replace(/^\/v1/, '') : b + path;
}

/** Bu yanıtta sıradaki motora geçilir mi? Her hata yanıtı: kota/kredi/anahtar/
 *  erişim sorunları ve isteği o sağlayıcının kabul etmemesi (400) — ajan başka
 *  bir sağlayıcının hatasıyla değil, yanıtla karşılaşsın. */
export function spillShouldFailover(status: number): boolean {
  return status >= 400;
}

export interface SlotStore {
  save(agentId: string): Promise<boolean>;
  restore(agentId: string): Promise<boolean>;
}

interface Lease { since: number; inflight: number; lastDone: number }
interface Waiter { agentId: string; since: number; grant: () => void }

/** Tamamlanan bir model isteğinin ölçümü. */
export interface GateRequestStat {
  agentId: string;
  model: string;
  at: number;
  /** Sırada bekleme (ms). */
  waitMs: number;
  /** Modelden ilk baytın gelmesi (ms) — istemi okuma süresi buna dahil. */
  firstByteMs: number | null;
  totalMs: number;
  status: number;
  /** Taşmayla gittiği API motoru; yerelde yanıtlandıysa yok. */
  engine?: string;
}

export interface GateStatus {
  concurrency: number;
  active: Array<{ agentId: string; since: number; inflight: number }>;
  waiting: Array<{ agentId: string; since: number }>;
  recent: GateRequestStat[];
  /** Modelin yuvasındaki (belleği yüklü) ajan. */
  slotOwner: string | null;
  /** Son STICKY_MS içinde API'ye taşan ajanlar. */
  spilled: Array<{ agentId: string; engine: string; until: number }>;
}

const RECENT_MAX = 40;

/** Günlük sayaçlar (yerel tarih → sayılar) — günlük özetteki "Yerel model" satırı. */
export interface GateDaily {
  /** Yerelde yanıtlanan model istekleri. */
  requests: number;
  /** Bunlardan hata dönenler (4xx/5xx). */
  errors: number;
  /** Yerel isteklerin toplam süresi ve sırada bekleme (ms). */
  totalMs: number;
  waitMs: number;
  /** API'ye taşan istekler, motora göre. */
  spills: Record<string, number>;
  /** Bunlardan istemi yerel bağlama sığmadığı için taşanlar. */
  overflow: number;
  /** Ajan belleği diskten geri yüklemeleri. */
  restores: number;
}

const DAILY_KEEP = 14;

export function emptyDaily(): GateDaily {
  return { requests: 0, errors: 0, totalMs: 0, waitMs: 0, spills: {}, overflow: 0, restores: 0 };
}

/** Birden çok günün sayaçlarını topla. */
export function sumDaily(days: Array<GateDaily | undefined>): GateDaily {
  const out = emptyDaily();
  for (const d of days) {
    if (!d) continue;
    out.requests += d.requests; out.errors += d.errors; out.totalMs += d.totalMs; out.waitMs += d.waitMs;
    out.overflow += d.overflow; out.restores += d.restores;
    for (const [k, v] of Object.entries(d.spills)) out.spills[k] = (out.spills[k] ?? 0) + v;
  }
  return out;
}

export class LocalModelGate {
  private server: Server | null = null;
  private port = 0;
  private readonly leases = new Map<string, Lease>();
  private readonly queue: Waiter[] = [];
  private readonly recent: GateRequestStat[] = [];
  private slotOwner: string | null = null;
  private readonly spilled = new Map<string, { engine: string; until: number }>();
  private daily: Record<string, GateDaily> = {};
  private switching: Promise<void> = Promise.resolve();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private readonly idleReleaseMs: number;
  private readonly maxHoldMs: number;

  constructor(private readonly opts: GateOptions) {
    this.idleReleaseMs = opts.idleReleaseMs ?? 30_000;
    this.maxHoldMs = opts.maxHoldMs ?? 8 * 60_000;
  }

  async start(port = 0): Promise<number> {
    if (this.server) return this.port;
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
    this.sweeper = setInterval(() => this.sweep(), 1000);
    return this.port;
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    this.server?.close();
    this.server = null;
    for (const w of this.queue.splice(0)) w.grant();
    this.leases.clear();
  }

  url(): string | null { return this.server ? `http://127.0.0.1:${this.port}` : null; }

  status(): GateStatus {
    return {
      concurrency: this.limit(),
      active: [...this.leases.entries()].map(([agentId, l]) => ({ agentId, since: l.since, inflight: l.inflight })),
      waiting: this.ordered().filter((w, i, a) => a.findIndex((x) => x.agentId === w.agentId) === i).map((w) => ({ agentId: w.agentId, since: w.since })),
      recent: [...this.recent],
      slotOwner: this.slotOwner,
      spilled: [...this.spilled.entries()].filter(([, v]) => v.until > Date.now()).map(([agentId, v]) => ({ agentId, ...v }))
    };
  }

  /** Günlük sayaçlar (kalıcılık için main okur/yazar). */
  dailyAll(): Record<string, GateDaily> { return this.daily; }
  seedDaily(d: Record<string, GateDaily> | null | undefined): void {
    if (d && typeof d === 'object') this.daily = { ...d, ...this.daily };
  }
  private today(): GateDaily {
    const k = localDate(new Date());
    if (!this.daily[k]) {
      this.daily[k] = emptyDaily();
      const keys = Object.keys(this.daily).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - DAILY_KEEP))) delete this.daily[old];
    }
    return this.daily[k];
  }

  /** Bekleyenler, öncelik listesine göre (eşitlikte geliş sırası). */
  private ordered(): Waiter[] {
    const prio = this.opts.priority?.() ?? [];
    const rank = (id: string): number => { const i = prio.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    return this.queue.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w.agentId) - rank(b.w.agentId) || a.i - b.i).map((x) => x.w);
  }

  private limit(): number { return Math.max(1, Math.floor(this.opts.concurrency() || 1)); }

  /** Ajan modele girebilir mi? Yeri varsa hemen, yoksa sıra gelince çözülür. */
  acquire(agentId: string): Promise<void> {
    return this.enqueue(agentId).granted;
  }

  /** Sıraya gir; `cancel()` bekleyişi sıradan çıkarır (taşmada). */
  private enqueue(agentId: string): { granted: Promise<void>; cancel: () => void } {
    const none = (): void => {};
    if (this.leases.has(agentId)) return { granted: Promise.resolve(), cancel: none };
    if (this.leases.size < this.limit() && !this.queue.some((w) => w.agentId !== agentId)) {
      this.leases.set(agentId, { since: Date.now(), inflight: 0, lastDone: Date.now() });
      return { granted: Promise.resolve(), cancel: none };
    }
    let w: Waiter | null = null;
    const granted = new Promise<void>((resolve) => { w = { agentId, since: Date.now(), grant: resolve }; this.queue.push(w); });
    return { granted, cancel: () => { const i = w ? this.queue.indexOf(w) : -1; if (i >= 0) this.queue.splice(i, 1); } };
  }

  begin(agentId: string): void {
    const l = this.leases.get(agentId);
    if (l) l.inflight++;
  }

  end(agentId: string): void {
    const l = this.leases.get(agentId);
    if (!l) return;
    l.inflight = Math.max(0, l.inflight - 1);
    l.lastDone = Date.now();
  }

  /** Boşalan yerleri sıradakilere ver. Testler zamanı `now` ile sürer. */
  sweep(now = Date.now()): void {
    const waitingOthers = (id: string): boolean => this.queue.some((w) => w.agentId !== id);
    for (const [id, l] of this.leases) {
      if (l.inflight > 0) continue;
      const idle = now - l.lastDone >= this.idleReleaseMs;
      const overstayed = now - l.since >= this.maxHoldMs && waitingOthers(id);
      if (idle || overstayed) {
        this.leases.delete(id);
        this.opts.log?.(`[sıra] ${id} yerini bıraktı (${idle ? 'işi bitti' : 'süresi doldu, sıra başkasında'})`);
      }
    }
    while (this.queue.length && this.leases.size < this.limit()) {
      const next = this.ordered()[0];
      this.leases.set(next.agentId, { since: now, inflight: 0, lastDone: now });
      // Aynı ajanın sıradaki bütün istekleri birlikte girer.
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].agentId === next.agentId) this.queue.splice(i, 1)[0].grant();
      }
      this.opts.log?.(`[sıra] ${next.agentId} modele girdi`);
    }
  }

  /**
   * Modelin yuvasını bu ajana hazırla: başka ajanın belleği yüklüyse onu kaydet,
   * bu ajanın kayıtlı belleği varsa geri yükle. Geçişler sırayla yapılır; hata
   * olursa ajan yine girer (yalnız baştan okur).
   */
  switchTo(agentId: string): Promise<void> {
    const store = this.limit() === 1 ? this.opts.slotStore?.() ?? null : null;
    if (!store) { this.slotOwner = null; return Promise.resolve(); }
    if (this.slotOwner === agentId) return this.switching;
    const run = this.switching.then(async () => {
      if (this.slotOwner === agentId) return;
      const prev = this.slotOwner;
      const t0 = Date.now();
      if (prev) await store.save(prev).catch((e) => { this.opts.log?.(`[bellek] ${prev} kaydedilemedi: ${e instanceof Error ? e.message : e}`); return false; });
      const t1 = Date.now();
      const restored = await store.restore(agentId).catch(() => false);
      this.slotOwner = agentId;
      if (restored) this.today().restores++;
      this.opts.log?.(`[bellek] ${prev ?? '—'} → ${agentId}: kaydet ${((t1 - t0) / 1000).toFixed(1)} sn, ${restored ? `geri yüklendi ${((Date.now() - t1) / 1000).toFixed(1)} sn` : 'kayıt yok'}`);
    });
    this.switching = run.catch(() => {});
    return this.switching;
  }

  private agentOf(req: IncomingMessage): string {
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.headers['x-api-key'] ?? '');
    return auth.startsWith(GATE_KEY_PREFIX) ? auth.slice(GATE_KEY_PREFIX.length) || 'bilinmeyen' : 'bilinmeyen';
  }

  /**
   * İsteği sırayla API motorlarına dene. Biri yanıt verirse yanıt ajana aktarılır
   * ve true döner; hepsi kullanılamazsa false (ajan yerel sırada bekler).
   */
  private async trySpill(agentId: string, wire: SpillWire, path: string, req: IncomingMessage, body: Buffer, res: ServerResponse, queuedAt: number): Promise<boolean> {
    let json: Record<string, unknown>;
    try { json = JSON.parse(body.toString('utf8')) as Record<string, unknown>; } catch { return false; }
    for (const t of this.opts.spill?.targets(wire) ?? []) {
      if (res.destroyed) return true;
      let url: URL;
      try { url = new URL(spillUrl(t, wire, path)); } catch { continue; }
      const out = Buffer.from(JSON.stringify({ ...json, model: t.model }), 'utf8');
      const headers: Record<string, string | string[] | undefined> = { ...req.headers };
      for (const h of ['host', 'authorization', 'x-api-key', 'content-length', 'transfer-encoding', 'connection']) delete headers[h];
      Object.assign(headers, {
        host: url.host, 'content-type': 'application/json', 'content-length': String(out.length),
        authorization: `Bearer ${t.key}`, ...(wire === 'anthropic' ? { 'x-api-key': t.key } : {})
      });
      const startedAt = Date.now();
      const result = await new Promise<'ok' | 'next'>((resolve) => {
        const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const up = send(url, { method: 'POST', headers }, (upRes) => {
          const status = upRes.statusCode ?? 502;
          if (spillShouldFailover(status)) {
            let detail = '';
            upRes.setEncoding('utf8');
            upRes.on('data', (d: string) => { if (detail.length < 400) detail += d; });
            upRes.on('end', () => { this.opts.spill?.onFailure?.(t.id, status, detail.slice(0, 400)); resolve('next'); });
            upRes.on('error', () => resolve('next'));
            return;
          }
          let firstByteAt: number | null = null;
          res.writeHead(status, upRes.headers);
          upRes.once('data', () => { firstByteAt ??= Date.now(); });
          upRes.pipe(res);
          upRes.on('end', () => {
            const now = Date.now();
            this.recent.push({ agentId, model: t.model, engine: t.id, at: now, waitMs: startedAt - queuedAt, firstByteMs: firstByteAt === null ? null : firstByteAt - startedAt, totalMs: now - startedAt, status });
            const d = this.today();
            d.spills[t.id] = (d.spills[t.id] ?? 0) + 1;
            if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
          });
          resolve('ok');
        });
        up.on('error', (e) => { this.opts.spill?.onFailure?.(t.id, 0, e.message); resolve('next'); });
        res.on('close', () => up.destroy());
        up.end(out);
      });
      if (result === 'ok') {
        const was = this.spilled.get(agentId)?.engine;
        this.spilled.set(agentId, { engine: t.id, until: Date.now() + STICKY_MS });
        if (was !== t.id) this.opts.log?.(`[taşma] ${agentId} → ${t.id}/${t.model}`);
        return true;
      }
    }
    return false;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = /^\/e\/([a-z0-9][a-z0-9-]{0,31})(\/.*)$/.exec(req.url ?? '');
    const base = m ? this.opts.resolveTarget(m[1]) : null;
    if (!m || !base) { res.statusCode = 404; res.end('sıra görevlisi: bilinmeyen uç nokta'); return; }
    let target: URL;
    try { target = new URL(base.replace(/\/+$/, '') + m[2]); } catch { res.statusCode = 400; res.end('geçersiz hedef'); return; }

    // Modele gitmeyen hafif istekler (model listesi vb.) sıraya girmez.
    const heavy = req.method === 'POST';
    const agentId = this.agentOf(req);
    // Gövde baştan okunur: hangi modeli istediği ölçüme yazılır. İstekler en çok
    // birkaç yüz KB'lık JSON'dur.
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    let model = '';
    if (heavy) {
      try { model = String((JSON.parse(body.toString('utf8')) as { model?: unknown }).model ?? ''); } catch { /* JSON değil */ }
      // Tanı: EMRET_GATE_DUMP=<klasör> ise her ajanın son isteği oraya yazılır
      // (istemin neden büyük olduğunu görmek için). Normalde kapalı.
      const dumpDir = process.env.EMRET_GATE_DUMP;
      if (dumpDir) {
        try { writeFileSync(join(dumpDir, `${agentId.replace(/[^a-z0-9-]/gi, '_')}.json`), body); } catch { /* tanı, önemsiz */ }
      }
    }
    const queuedAt = Date.now();
    const wire = heavy ? spillWireOf(m[2]) : null;
    if (heavy) {
      const spillMs = wire && this.opts.spill ? this.opts.spill.afterMs() : 0;
      const ticket = this.enqueue(agentId);
      if (spillMs > 0 && wire && !this.leases.has(agentId)) {
        const sticky = (this.spilled.get(agentId)?.until ?? 0) > Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const winner = await Promise.race([
          ticket.granted.then(() => 'local' as const),
          new Promise<'spill'>((r) => { timer = setTimeout(() => r('spill'), sticky ? 0 : spillMs); })
        ]);
        clearTimeout(timer);
        if (winner === 'spill' && !this.leases.has(agentId)) {
          ticket.cancel();
          if (res.destroyed) return;
          if (await this.trySpill(agentId, wire, m[2], req, body, res, queuedAt)) return;
          // Hiçbir API olmadı: yerelden devam.
          await this.acquire(agentId);
        }
      } else {
        await ticket.granted;
      }
      if (res.destroyed) return;
      this.begin(agentId);
      await this.switchTo(agentId);
    }
    const startedAt = Date.now();
    let firstByteAt: number | null = null;
    let status = 0;

    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host, authorization: 'Bearer ollama', 'x-api-key': 'ollama' };
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.length);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      if (!heavy) return;
      this.end(agentId);
      const now = Date.now();
      this.recent.push({ agentId, model, at: now, waitMs: startedAt - queuedAt, firstByteMs: firstByteAt === null ? null : firstByteAt - startedAt, totalMs: now - startedAt, status });
      const d = this.today();
      d.requests++;
      if (status >= 400 || status === 0) d.errors++;
      d.totalMs += now - startedAt;
      d.waitMs += startedAt - queuedAt;
      if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
    };
    const up = send(target, { method: req.method, headers }, (upRes) => {
      status = upRes.statusCode ?? 502;
      // İstem yerel modelin bağlamına sığmıyor (llama-server 400 verir; Ollama
      // sessizce keserdi): beklemeden API'ye taşı; API yoksa hata ajana gider.
      if (status === 400 && wire && this.opts.spill) {
        let text = '';
        upRes.setEncoding('utf8');
        upRes.on('data', (d: string) => { if (text.length < 4000) text += d; });
        upRes.on('end', () => {
          done();
          void (async () => {
            if (isContextOverflow(text)) {
              this.opts.log?.(`[taşma] ${agentId} istemi yerel bağlama sığmıyor → API`);
              this.today().overflow++;
              if (await this.trySpill(agentId, wire, m[2], req, body, res, queuedAt)) return;
            }
            if (!res.headersSent) { res.writeHead(400, { 'content-type': upRes.headers['content-type'] ?? 'application/json' }); res.end(text); }
          })();
        });
        return;
      }
      res.writeHead(status, upRes.headers);
      upRes.once('data', () => { firstByteAt ??= Date.now(); });
      upRes.pipe(res);
      upRes.on('end', done);
      upRes.on('error', done);
    });
    up.on('error', (e) => {
      done();
      if (!res.headersSent) { res.statusCode = 502; res.end(`sıra görevlisi: ${e.message}`); } else res.end();
    });
    res.on('close', () => { done(); up.destroy(); });
    up.end(body);
  }
}
