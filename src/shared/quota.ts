/**
 * Krediler ve kotalar — ofis köşesindeki göstergenin saf hesapları.
 *
 *  - Claude aboneliği: Claude Code durum satırının `rate_limits` alanı (5 saatlik
 *    ve haftalık pencere yüzdeleri). Kalan kredi miktarını hiçbir sağlayıcı
 *    açıkça vermez; Claude için yüzde, diğerleri için harcanan token gösterilir.
 *  - Bugünkü kullanım: cost-ledger.jsonl satırları oturum başına BİRİKİMLİ
 *    örneklerdir; bugünkü pay = bugünkü son örnek − bugünden önceki son örnek.
 */

export interface QuotaWindow { pct: number; resetsAt: number | null }
export interface ClaudeQuota { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null; at: number }

/** Durum satırı `rate_limits` → pencereler (yoksa null). */
export function parseRateLimits(rl: unknown, now: number): ClaudeQuota | null {
  if (!rl || typeof rl !== 'object') return null;
  const win = (w: unknown): QuotaWindow | null => {
    if (!w || typeof w !== 'object') return null;
    const o = w as { used_percentage?: unknown; utilization?: unknown; resets_at?: unknown };
    let pct = Number(o.used_percentage ?? o.utilization);
    if (!Number.isFinite(pct)) return null;
    if (o.used_percentage === undefined && pct <= 1) pct *= 100;
    const r = o.resets_at;
    const ms = typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : typeof r === 'string' ? Date.parse(r) : NaN;
    return { pct: Math.max(0, Math.min(100, Math.round(pct))), resetsAt: Number.isFinite(ms) ? ms : null };
  };
  const o = rl as Record<string, unknown>;
  const fiveHour = win(o.five_hour);
  const sevenDay = win(o.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay, at: now } : null;
}

export type UsageFamily = 'claude' | 'gemini' | 'local' | 'api';
export interface FamilyUsage { family: UsageFamily; tokens: number; usd: number; models: string[] }

interface LedgerRow { agent_id?: string; session_id?: string | null; ts?: number; input?: number; output?: number; cache_read?: number; cache_creation?: number; model?: string; usd?: number }

export function familyOf(model: string, isFree: (m: string) => boolean): UsageFamily {
  const m = model.toLowerCase();
  if (isFree(model)) return 'local';
  if (m.startsWith('claude')) return 'claude';
  if (m.includes('gemini')) return 'gemini';
  return 'api';
}

/** Bugünkü (sinceMs'ten beri) kullanım, model ailesine göre. */
export function usageByFamily(rows: LedgerRow[], sinceMs: number, isFree: (m: string) => boolean): FamilyUsage[] {
  const tok = (r: LedgerRow): number => (r.input ?? 0) + (r.output ?? 0) + (r.cache_read ?? 0) + (r.cache_creation ?? 0);
  const before = new Map<string, LedgerRow>();
  const today = new Map<string, LedgerRow>();
  for (const r of rows) {
    if (!r.model || typeof r.ts !== 'number') continue;
    const k = `${r.agent_id}|${r.session_id}|${r.model}`;
    (r.ts < sinceMs ? before : today).set(k, r);
  }
  const out = new Map<UsageFamily, FamilyUsage>();
  for (const [k, r] of today) {
    const b = before.get(k);
    const t = Math.max(0, tok(r) - (b ? tok(b) : 0));
    const usd = Math.max(0, (r.usd ?? 0) - (b?.usd ?? 0));
    if (!t) continue;
    const fam = familyOf(r.model!, isFree);
    const f = out.get(fam) ?? { family: fam, tokens: 0, usd: 0, models: [] };
    f.tokens += t;
    f.usd += fam === 'local' ? 0 : usd;
    if (!f.models.includes(r.model!)) f.models.push(r.model!);
    out.set(fam, f);
  }
  const order: UsageFamily[] = ['local', 'claude', 'gemini', 'api'];
  return order.map((f) => out.get(f)).filter((x): x is FamilyUsage => !!x);
}

/** 1234567 → "1,2 M" (Türkçe ondalık). */
export function shortTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} B`;
  return String(n);
}

// ─── Günlük özetin "Motorlar ve kotalar" bölümü ──────────────────────────────

export interface LocalDailyStats {
  requests: number; errors: number; totalMs: number; waitMs: number;
  spills: Record<string, number>; overflow: number; restores: number;
}

export interface EngineReportInput {
  /** Dönemin adı, ör. "dünden bu yana". */
  period: string;
  local: LocalDailyStats;
  /** Yerel motorun adı ve çalışıyor mu. */
  localEngine: { label: string; up: boolean } | null;
  claude: ClaudeQuota | null;
  workerLimitPct: number;
  engines: Array<{ id: string; label: string; kind: 'free' | 'paid'; down: { reason: string; untilMs: number } | null }>;
  usage: FamilyUsage[];
  labelOf: (engineId: string) => string;
  /** Tarih/saat biçimi (testler sabitler). */
  fmtTime: (ms: number) => string;
}

const REASON_TR: Record<string, string> = {
  limit: 'limit doldu', low: '%60 işçi sınırında', rate: 'kota dolu / yoğun', credits: 'kredi yok',
  auth: 'anahtar hatası', timeout: 'zaman aşımı', unavailable: 'erişilemiyor'
};
const FAMILY_TR: Record<UsageFamily, string> = { local: 'Yerel', claude: 'Claude', gemini: 'Gemini', api: 'Diğer API' };

/** Markdown bölüm: yerel motor, Claude aboneliği, API motorlarının durumu ve kullanım. */
export function buildEngineReport(inp: EngineReportInput): string {
  const L: string[] = [`### Motorlar ve kotalar (${inp.period})`, ''];
  const loc = inp.local;
  const sec = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
  const spillTotal = Object.values(loc.spills).reduce((a, b) => a + b, 0);
  const state = inp.localEngine ? `${inp.localEngine.label}${inp.localEngine.up ? '' : ' — şu an YANIT VERMİYOR'}` : 'tanımlı değil';
  L.push(`**Yerel model** (${state})`);
  if (loc.requests || spillTotal) {
    L.push(`- ${loc.requests} istek, ortalama ${loc.requests ? sec(loc.totalMs / loc.requests) : '—'}; sırada ortalama ${loc.requests ? sec(loc.waitMs / loc.requests) : '—'}`);
    if (loc.errors) L.push(`- ${loc.errors} istek hata döndü`);
    if (spillTotal) {
      const by = Object.entries(loc.spills).map(([k, v]) => `${inp.labelOf(k)} ${v}`).join(', ');
      L.push(`- API'ye taşan: ${spillTotal} (${by})${loc.overflow ? `; ${loc.overflow} tanesi yerel bağlama sığmadığı için` : ''}`);
    }
    if (loc.restores) L.push(`- Ajan belleği diskten ${loc.restores} kez geri yüklendi`);
  } else {
    L.push('- Bu dönemde yerel modele istek gelmedi');
  }
  L.push('');
  L.push(`**Claude aboneliği** (işçi sınırı %${inp.workerLimitPct}, kalan pay Genel Müdür'ün)`);
  const w = (name: string, q: QuotaWindow | null): void => {
    if (!q) return;
    const flag = q.pct >= inp.workerLimitPct ? ' — işçiler durdu' : '';
    L.push(`- ${name}: %${q.pct}${q.resetsAt ? `, sıfırlanma ${inp.fmtTime(q.resetsAt)}` : ''}${flag}`);
  };
  if (inp.claude) { w('5 saatlik', inp.claude.fiveHour); w('Haftalık', inp.claude.sevenDay); }
  else L.push('- Kullanım yüzdesi henüz bildirilmedi');
  L.push('');
  const apis = inp.engines.filter((e) => e.id !== 'claude');
  if (apis.length) {
    L.push('**API motorları**');
    for (const e of apis) {
      const st = e.down ? `${REASON_TR[e.down.reason] ?? e.down.reason} (yeniden deneme: ${inp.fmtTime(e.down.untilMs)})` : 'kullanılabilir';
      L.push(`- ${e.label} (${e.kind === 'free' ? 'ücretsiz' : 'ücretli'}): ${st}`);
    }
    L.push('');
  }
  L.push('**Kullanım**');
  if (inp.usage.length) {
    for (const f of inp.usage) {
      L.push(`- ${FAMILY_TR[f.family]}: ${shortTokens(f.tokens)} token${f.family === 'local' ? ' (ücretsiz)' : f.usd >= 0.01 ? ` · ${f.usd.toFixed(2)} $` : ''}`);
    }
  } else {
    L.push('- Kayıtlı kullanım yok');
  }
  return L.join('\n');
}
