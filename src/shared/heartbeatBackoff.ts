/**
 * Kalp atışı boşta fren — sakin ofiste Genel Müdür'ü boş yere uyandırma.
 *
 * Heartbeat, ofis sakinken her beat'te god'a bir özet atıyordu (base 2 dk ×2.5
 * ⇒ ~5 dk): canlıda saatte 12, günde ~290 uyanış; her biri god'un inbox +
 * board + fleet okuması demek (god toplam harcamanın ~yarısı, 2026-10-29).
 * Arada GERÇEK bir olay olmadıysa bekleme her boş uyanışta ikiye katlanır
 * (HEARTBEAT_MAX_IDLE_MS tavanı); gerçek olay ya da gerçek posta gelince başa döner.
 *
 * Saf — birim-test edilebilir.
 */

export const HEARTBEAT_MAX_IDLE_MS = 60 * 60_000;

/** Boş uyanıştan sonraki bekleme: ilk uyanışta eskisi gibi base×2.5, sonra katlanır. */
export function quietBackoffMs(baseMs: number, idleStreak: number): number {
  const first = Math.round(baseMs * 2.5);
  return Math.min(first * 2 ** Math.max(0, idleStreak - 1), Math.max(first, HEARTBEAT_MAX_IDLE_MS));
}

/** log.jsonl olayı ofiste gerçek bir şey olduğunu mu gösteriyor? Zamanlayıcının
 *  kendi gürültüsü (heartbeat/breaker mesajları, motor geçişi yeniden başlatmaları,
 *  kanca gürültüsü) sayılmaz; ajan/insan mesajı ve görev defteri değişikliği sayılır. */
export function isRealActivity(e: unknown, systemSenders: ReadonlySet<string>): boolean {
  if (!e || typeof e !== 'object') return false;
  const r = e as { kind?: unknown; from?: unknown };
  if (r.kind === 'tasks') return true;
  return r.kind === 'message' && typeof r.from === 'string' && !systemSenders.has(r.from);
}
