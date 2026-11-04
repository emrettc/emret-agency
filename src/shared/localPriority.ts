/**
 * Yerel model öncelik listesi ve performans özeti — saf yardımcılar
 * (Ayarlar › Motorlar › Yerel model sırası). Testler doğrudan çağırır.
 */

/** Görünen sıra: önce kayıtlı öncelik (yalnız hâlâ var olanlar), sonra yeni gelenler kendi sırasıyla. */
export function orderByPriority(ids: string[], priority: string[]): string[] {
  const present = new Set(ids);
  const head = priority.filter((id, i) => present.has(id) && priority.indexOf(id) === i);
  const seen = new Set(head);
  return [...head, ...ids.filter((id) => !seen.has(id) && (seen.add(id), true))];
}

/** Listede `from` sıradaki öğeyi `to` sırasına taşı (yeni dizi). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

export interface RecentStat { waitMs: number; firstByteMs: number | null; totalMs: number; status: number }

/** Son isteklerden ortalamalar (yalnız başarılı olanlar; sn, 1 ondalık). */
export function summarizeRecent(recent: RecentStat[]): { count: number; avgFirstSec: number | null; avgTotalSec: number | null; avgWaitSec: number | null } {
  const ok = recent.filter((r) => r.status >= 200 && r.status < 300);
  const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) / 100) / 10 : null);
  return {
    count: ok.length,
    avgFirstSec: avg(ok.map((r) => r.firstByteMs).filter((x): x is number => x !== null)),
    avgTotalSec: avg(ok.map((r) => r.totalMs)),
    avgWaitSec: avg(ok.map((r) => r.waitMs))
  };
}

/** Okuma hızına göre kaba değerlendirme: 15k tokenlık bir ajan istemi kaç saniyede okunur. */
export function speedVerdict(readTps: number): 'fast' | 'ok' | 'slow' {
  if (readTps >= 1000) return 'fast';
  if (readTps >= 300) return 'ok';
  return 'slow';
}
