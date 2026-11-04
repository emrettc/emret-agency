/**
 * Ajan yaşam döngüsü — boştaki ajanı arşive gönder, görev gelince geri getir.
 *
 * Kural (kullanıcı isteği): işi olmayan ve 1 gün (varsayılan) çalışmayan ajan
 * otomatik arşive gider; görev panosunda ona atanmış açık bir görev belirince
 * yeniden etkinleşir. Genel Müdür (yönetici) hiçbir zaman arşivlenmez.
 *
 * Saf karar fonksiyonu: hangi ajanın arşivleneceğine / uyanacağına karar verir,
 * PTY öldürmek ya da spawn etmek çağıranın (renderer hook'u) işidir.
 */

/** Görev panosunda kapanmış sayılan durumlar. */
const CLOSED = new Set(['done', 'cancelled', 'canceled', 'dismissed', 'archived', 'rejected']);

export const DEFAULT_AUTO_ARCHIVE_HOURS = 24;

interface TaskLike { status?: unknown; assignee?: unknown; owner?: unknown }

/** Açık görevi olan ajan kimlikleri (görevin `assignee`'si, yoksa `owner`'ı). */
export function openTaskAssignees(ledger: unknown): Set<string> {
  const tasks: unknown[] = Array.isArray(ledger)
    ? ledger
    : Array.isArray((ledger as { tasks?: unknown[] } | null)?.tasks) ? (ledger as { tasks: unknown[] }).tasks : [];
  const out = new Set<string>();
  for (const raw of tasks) {
    const t = raw as TaskLike;
    if (!t || typeof t !== 'object') continue;
    if (CLOSED.has(String(t.status ?? '').toLowerCase())) continue;
    const who = typeof t.assignee === 'string' && t.assignee ? t.assignee : typeof t.owner === 'string' ? t.owner : '';
    if (who) out.add(who);
  }
  return out;
}

export interface LifecycleAgent { id: string; isGod?: boolean; isAssistant?: boolean; status?: string }

export interface LifecycleInput {
  /** Şu an ofiste (canlı) olan ajanlar. */
  live: LifecycleAgent[];
  /** Arşivdeki ajanlar. */
  archived: LifecycleAgent[];
  openAssignees: Set<string>;
  /** Ajanın en son çalıştığı an (ms). Kaydı olmayan ajan hiç boşta sayılmaz. */
  lastActiveAt: Record<string, number>;
  now: number;
  /** Bu kadar saat boşta kalan (ve görevi olmayan) ajan arşivlenir; 0 = kapalı. */
  idleHours: number;
}

export interface LifecycleDecision { archive: string[]; revive: string[] }

/** Çalışıyor sayılan durumlar — bunlardaki ajan boşta değildir. */
const BUSY = new Set(['thinking', 'working', 'waiting', 'blocked', 'compacting', 'looping', 'typing']);

export function decideLifecycle(inp: LifecycleInput): LifecycleDecision {
  const archive: string[] = [];
  const revive: string[] = [];
  if (inp.idleHours > 0) {
    const limit = inp.idleHours * 3_600_000;
    for (const a of inp.live) {
      if (a.isGod || a.isAssistant) continue;
      if (inp.openAssignees.has(a.id)) continue;
      if (a.status && BUSY.has(a.status)) continue;
      const last = inp.lastActiveAt[a.id];
      if (last === undefined || inp.now - last < limit) continue;
      archive.push(a.id);
    }
  }
  const liveIds = new Set(inp.live.map((a) => a.id));
  for (const a of inp.archived) {
    if (a.isGod || liveIds.has(a.id)) continue;
    if (inp.openAssignees.has(a.id)) revive.push(a.id);
  }
  return { archive, revive };
}
