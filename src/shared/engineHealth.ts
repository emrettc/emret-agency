/**
 * Otomatik motor geçişi — SAF çekirdek (electron'suz, birim-test edilebilir).
 *
 * Bir motor ('claude' ya da bir BYOK uç nokta kimliği: 'evren', 'nvidia', …)
 * limit / kota / zaman aşımı hatası verdiğinde bir süre "kapalı" sayılır.
 * Main süreci (index.ts) bu kayda bakarak ajanları sıradaki sağlıklı motora
 * taşır (resolveAgentEngine + isDown), süre dolunca asıl motora geri döndürür.
 *
 * Algılama kaynakları:
 *  - Claude Code: ajan terminal çıktısındaki limit satırları (detectClaudeLimit).
 *  - OpenCode: ~/.local/share/opencode/log/opencode.log içindeki
 *    `message="stream error" providerID=<uç-nokta>` satırları (parseOpencodeLogLine).
 */

/** Claude Code'un yerel (abonelik) motoru. BYOK uç nokta kimlikleriyle çakışmaz. */
export const CLAUDE_ENGINE = 'claude';

export type EngineFailureReason = 'limit' | 'low' | 'rate' | 'credits' | 'auth' | 'timeout' | 'unavailable';

export interface EngineFailure {
  reason: EngineFailureReason;
  /** Motorun yeniden denenebileceği an (epoch ms). */
  untilMs: number;
  /** Log/UI için kısa açıklama (anahtar İÇERMEZ — yalnız hata metni). */
  detail: string;
}

const MIN = 60_000;
/** Sıfırlanma saati bilinmiyorsa motorun kapalı kalacağı süre. */
const DEFAULT_DOWN_MS: Record<EngineFailureReason, number> = {
  limit: 60 * MIN,
  low: 60 * MIN,
  rate: 15 * MIN,
  credits: 6 * 60 * MIN,
  auth: 6 * 60 * MIN,
  timeout: 15 * MIN,
  unavailable: 5 * MIN
};

/** Ücretli motorda işçilerin kullanabileceği pay (Claude aboneliği: 5 saatlik ve
 *  haftalık sınır). Emre 2026-11-03: %60'ı işçiler harcasın, %40 yöneticiye
 *  kalsın. Yönetici failover'dan muaf olduğu için bu eşik yalnız işçileri taşır;
 *  taşınan işçiler fallbackOrder'a göre önce yerel motora döner.
 *  (2026-10-28'de eşik %95'ti: o zaman işçiler EVREN'e taşınıyordu.) */
export const LOW_QUOTA_USED_PCT = 60;

type RateWindow = { used_percentage?: unknown; utilization?: unknown; resets_at?: unknown };

/**
 * Claude Code durum satırının `rate_limits` alanı ({five_hour, seven_day}) →
 * eşik aşıldıysa motor "azaldı" kaydı (sıfırlanma anına kadar), değilse null.
 */
export function claudeQuotaFromRateLimits(rl: unknown, now: Date, thresholdPct = LOW_QUOTA_USED_PCT): EngineFailure | null {
  if (!rl || typeof rl !== 'object') return null;
  let worst: { name: string; pct: number; until: number } | null = null;
  for (const [name, w] of Object.entries(rl as Record<string, RateWindow>)) {
    if (!w || typeof w !== 'object') continue;
    const raw = Number(w.used_percentage ?? w.utilization);
    if (!Number.isFinite(raw)) continue;
    const pct = raw <= 1 && w.used_percentage === undefined ? raw * 100 : raw;
    if (pct < thresholdPct) continue;
    const r = w.resets_at;
    const resetMs = typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : typeof r === 'string' ? Date.parse(r) : NaN;
    const until = Number.isFinite(resetMs) && resetMs > now.getTime() ? resetMs : now.getTime() + DEFAULT_DOWN_MS.low;
    // Birden çok pencere eşikteyse en geç açılanı esas al.
    if (!worst || until > worst.until) worst = { name, pct: Math.round(pct), until };
  }
  if (!worst) return null;
  return { reason: 'low', untilMs: worst.until, detail: `Claude ${worst.name === 'seven_day' ? 'haftalık' : worst.name === 'five_hour' ? '5 saatlik' : worst.name} kullanım %${worst.pct} (işçi sınırı %${thresholdPct})` };
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Terminal kontrol kodlarını sil. İmleç-ileri (`ESC[nC`) boşluğa çevrilir ki
 *  TUI'nin boşluk yerine imleç atlattığı kelimeler birleşmesin. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[(\d*)C/g, (_m, n: string) => ' '.repeat(Math.min(Number(n) || 1, 8)))
    .replace(ANSI_RE, '');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RESET_RE = /\breset(?:s| at)?\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

/** "resets 7pm", "reset at 3:30am", "resets Oct 30, 3pm" → epoch ms (yerel saat).
 *  Saat dilimi parantezi yok sayılır (ofis kullanıcının saatinde çalışır). */
export function parseResetTime(text: string, now: Date): number | null {
  const m = RESET_RE.exec(text);
  if (!m) return null;
  const [, mon, day, hh, mm, ampm] = m;
  let hour = Number(hh) % 12;
  if (ampm.toLowerCase() === 'pm') hour += 12;
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  d.setHours(hour, mm ? Number(mm) : 0);
  if (mon) {
    const mi = MONTHS.indexOf(mon.toLowerCase());
    if (mi < 0) return null;
    d.setMonth(mi, Number(day));
    if (d.getTime() <= now.getTime()) d.setFullYear(d.getFullYear() + 1);
  } else if (d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/** TUI süsleri (⎿ ⏺ │ · …) satır başından atılır; kalan satır limit ifadesiyle
 *  BAŞLAMALI. Böylece ajanın ekrana bastığı kaynak kod / alıntı (`'…'`, `/…/`)
 *  yanlış alarm vermez. */
const LEAD_RE = /^[\s⎿⏺●○◯│|>*·∙•✻✳⎯─-]+/;
const LIMIT_RE = /^(?:claude (?:ai )?usage limit reached|you'?ve hit your (?:\w+ )?limit|(?:5-hour|weekly|session|opus|sonnet)(?: usage)? limit reached)/i;
const USED_RE = /^you'?ve used (\d{1,3})% of your (?:\w+ )?limit/i;
const API429_RE = /^API Error:\s*429\b/;

function failure(reason: EngineFailureReason, line: string, now: Date): EngineFailure {
  const until = parseResetTime(line, now) ?? now.getTime() + DEFAULT_DOWN_MS[reason];
  return { reason, untilMs: until, detail: line.slice(0, 160) };
}

/** Claude Code terminal çıktısında limit / kota-azaldı / 429 satırı ara. */
export function detectClaudeLimit(text: string, now: Date): EngineFailure | null {
  for (const raw of stripAnsi(text).split(/[\r\n]+/)) {
    const line = raw.replace(LEAD_RE, '').replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;
    if (LIMIT_RE.test(line)) return failure('limit', line, now);
    const used = USED_RE.exec(line);
    if (used && Number(used[1]) >= LOW_QUOTA_USED_PCT) return failure('low', line, now);
    if (API429_RE.test(line)) return failure('rate', line, now);
  }
  return null;
}

/** Geçici kapasite yanıtları: istemci zaten yeniden dener, motoru kapatmak
 *  (başka sağlıklı motor yokken) ajanları boş yere yeniden başlatır. EVREN:
 *  "…en fazla 4 eşzamanlı istek…", "Model şu anda dolu, lütfen kısa bir süre
 *  sonra tekrar deneyin." (2026-10-29 canlı). */
const TRANSIENT_RE = /eşzamanlı|concurren|şu anda dolu|model.{0,20}(?:busy|at capacity)/i;

const API_ERROR_RE = /^API Error\b/i;
const INVALID_KEY_RE = /^invalid api key\b/i;
const RETRYING_RE = /retrying|retry in|attempt \d+\s*\/\s*\d+/i;

/** Claude Code bir BYOK uç noktasının Anthropic teli üzerindeyken (EVREN, Kimi…)
 *  terminaline düşen son hata satırı. Claude Code geçici hataları kendisi yeniden
 *  dener ("Retrying in 5 seconds… (attempt 2/10)"); o satırlar sayılmaz, yalnız
 *  denemeler bitince kalan `API Error …` / `Invalid API key` satırı motoru kapatır. */
export function detectAnthropicWireError(text: string, now: Date): EngineFailure | null {
  for (const raw of stripAnsi(text).split(/[\r\n]+/)) {
    const line = raw.replace(LEAD_RE, '').replace(/[ \t]+/g, ' ').trim();
    if (!line || RETRYING_RE.test(line)) continue;
    if (INVALID_KEY_RE.test(line)) return { reason: 'auth', untilMs: now.getTime() + DEFAULT_DOWN_MS.auth, detail: line.slice(0, 160) };
    if (!API_ERROR_RE.test(line)) continue;
    // Eşzamanlı istek sınırı / "model dolu" geçicidir (bkz. parseOpencodeLogLine).
    if (TRANSIENT_RE.test(line)) continue;
    return classifyProviderError(line, now);
  }
  return null;
}

/** Sağlayıcı hata metnini sınıflandır (OpenCode / AI SDK hataları). EVREN gibi
 *  yerli ağ geçitleri Türkçe mesaj döndürür ("Geçersiz API anahtarı"). */
export function classifyProviderError(msg: string, now: Date): EngineFailure {
  const reason: EngineFailureReason =
    /\b402\b|quota|credit|insufficient|billing|payment|kota|kredi|bakiye/i.test(msg) ? 'credits'
    : /\b429\b|rate.?limit|too many requests|çok fazla istek/i.test(msg) ? 'rate'
    : /\b40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,12}(?:api.?)?key|authentication|geçersiz.{0,12}anahtar|yetkisiz/i.test(msg) ? 'auth'
    : /HeaderTimeout|timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|socket hang up|zaman aşımı/i.test(msg) ? 'timeout'
    // Tanınmayan her akış hatası da kısa süre kapalı sayılır: sessizce hata
    // veren bir uç noktada ajanı bekletmektense yedeği denemek iyidir.
    : 'unavailable';
  return { reason, untilMs: now.getTime() + DEFAULT_DOWN_MS[reason], detail: msg.slice(0, 160) };
}

/** OpenCode log satırı → { motor, hata }. Yalnız `stream error` satırları. */
export function parseOpencodeLogLine(line: string, now: Date): { engine: string; failure: EngineFailure } | null {
  if (!/level=ERROR/.test(line) || !/message="stream error"/.test(line)) return null;
  const prov = /\bproviderID=([A-Za-z0-9_-]+)/.exec(line);
  if (!prov) return null;
  const err = /\berror\.error="([^"]*)"/.exec(line);
  const msg = err ? err[1] : line;
  // Eşzamanlı istek sınırı (EVREN: "hesabınız bu modelde en fazla 4 eşzamanlı
  // istek açabilir") geçicidir ve OpenCode isteği kendisi yeniden dener; motoru
  // kapatıp ajanları kaydırmak işi bozar.
  if (TRANSIENT_RE.test(msg)) return null;
  return { engine: prov[1].toLowerCase(), failure: classifyProviderError(msg, now) };
}

/** Bir motor kapandığında insana gidecek uyarı (Gelen Kutusu + masaüstü + Slack).
 *  Ne yapması gerektiğini söyler: anahtar/kredi sorunu insanın işidir, geçici
 *  sorunlar ise yalnız bilgi — ofis yedekle devam eder. */
export function engineDownNotice(label: string, f: EngineFailure, now: Date): { title: string; body: string } {
  const until = new Date(f.untilMs).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const mins = Math.max(1, Math.round((f.untilMs - now.getTime()) / 60_000));
  const action: Record<EngineFailureReason, string> = {
    auth: `**Anahtar geçersiz.** Ayarlar → Yapay Zekâ Motorları'ndan ${label} anahtarını yenileyin.`,
    credits: `**Kredi / bakiye bitti.** ${label} hesabına bakiye yükleyin ya da anahtarı değiştirin.`,
    limit: `**Kullanım limiti doldu.** ${until}'e kadar yedek motorlar kullanılıyor.`,
    low: `**Kota azaldı.** Kalan kota korunuyor; ${until}'e kadar yedek motorlar kullanılıyor.`,
    rate: `Çok fazla istek (geçici). ${mins} dk sonra yeniden denenecek.`,
    timeout: `Yanıt vermiyor (zaman aşımı). ${mins} dk sonra yeniden denenecek.`,
    unavailable: `Hizmet şu an kullanılamıyor. ${mins} dk sonra yeniden denenecek.`
  };
  return {
    title: `⚠️ ${label} motoru çalışmıyor`,
    body: `${action[f.reason]}\n\nAjanlar sıradaki sağlıklı motorla çalışmaya devam ediyor.\n\nHata: \`${f.detail.replace(/`/g, "'")}\``
  };
}

export interface EngineDownState extends EngineFailure {
  engine: string;
  sinceMs: number;
}

/** Hangi motorun ne zamana kadar kapalı olduğu. Bellekte tutulur (uygulama
 *  yeniden başlarsa motorlar sağlıklı varsayılır, ilk hatada yeniden kapanır). */
/** Açıldıktan sonra bu süre içinde yine düşen motor "dalgalanıyor" sayılır. */
export const FLAP_WINDOW_MS = 60 * MIN;
/** Dalgalanan motorun kapalı kalma süresinin tavanı. */
export const FLAP_MAX_DOWN_MS = 6 * 60 * MIN;
/** Sıfırlanma saati kesin olan nedenler (limit satırındaki saat) katlanmaz. */
const FLAP_REASONS = new Set<EngineFailureReason>(['rate', 'timeout', 'unavailable']);

export class EngineHealth {
  private down = new Map<string, EngineDownState>();
  /** motor → son açılış anı ve art arda düşüş sayısı (dalgalanma frenine). */
  private flap = new Map<string, { upAt: number; strikes: number }>();

  /** Motoru kapat. Zaten daha uzun süreyle kapalıysa değişmez; true ⇒ yeni/uzatıldı.
   *  Açıldıktan kısa süre sonra yine düşen motorun süresi her seferinde ikiye
   *  katlanır (FLAP_MAX_DOWN_MS'e kadar): canlıda NVIDIA her 15 dk düşüp açıldı,
   *  ajanlar her seferinde iki kez yeniden başladı — boşa bağlam/token. */
  markDown(engine: string, f: EngineFailure, nowMs: number): boolean {
    const cur = this.down.get(engine);
    let failure = f;
    if (!cur && FLAP_REASONS.has(f.reason)) {
      const fl = this.flap.get(engine);
      const strikes = fl && nowMs - fl.upAt < FLAP_WINDOW_MS ? fl.strikes + 1 : 0;
      this.flap.set(engine, { upAt: fl?.upAt ?? 0, strikes });
      if (strikes > 0) {
        const base = Math.max(f.untilMs - nowMs, MIN);
        const until = nowMs + Math.min(base * 2 ** strikes, FLAP_MAX_DOWN_MS);
        failure = { ...f, untilMs: Math.max(f.untilMs, until), detail: `${f.detail} (art arda ${strikes + 1}. düşüş)`.slice(0, 160) };
      }
    }
    if (cur && cur.untilMs >= failure.untilMs) return false;
    this.down.set(engine, { ...failure, engine, sinceMs: cur?.sinceMs ?? nowMs });
    return true;
  }

  /** Motoru hemen açık say (god komutu). true ⇒ kapalıydı. */
  clear(engine: string): boolean {
    return this.down.delete(engine);
  }

  isDown(engine: string, nowMs: number): boolean {
    const cur = this.down.get(engine);
    return !!cur && cur.untilMs > nowMs;
  }

  /** Süresi dolanları sil; geri açılan motorların kimliklerini döndür. */
  expire(nowMs: number): string[] {
    const up: string[] = [];
    for (const [id, s] of this.down) {
      if (s.untilMs > nowMs) continue;
      this.down.delete(id);
      up.push(id);
      const fl = this.flap.get(id);
      this.flap.set(id, { upAt: nowMs, strikes: fl?.strikes ?? 0 });
    }
    return up;
  }

  snapshot(nowMs: number): EngineDownState[] {
    return [...this.down.values()].filter((s) => s.untilMs > nowMs);
  }

  /** Diske yazılmış durumu geri yükle (süresi geçmişler atlanır). Uygulama
   *  yeniden açıldığında ajanlar doğrudan sağlıklı motorda başlasın diye. */
  restore(states: unknown, nowMs: number): void {
    if (!Array.isArray(states)) return;
    for (const s of states) {
      if (!s || typeof s !== 'object') continue;
      const r = s as Partial<EngineDownState>;
      if (typeof r.engine !== 'string' || typeof r.untilMs !== 'number' || r.untilMs <= nowMs) continue;
      this.down.set(r.engine, {
        engine: r.engine,
        reason: (r.reason ?? 'unavailable') as EngineFailureReason,
        untilMs: r.untilMs,
        detail: typeof r.detail === 'string' ? r.detail : '',
        sinceMs: typeof r.sinceMs === 'number' ? r.sinceMs : nowMs
      });
    }
  }
}
