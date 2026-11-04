/**
 * `humanQA` okuma kuralları — BANA SOR panosu, Gelen Kutusu, Projeler sekmesi
 * ve ofis panosu aynı soruları görsün diye tek yerde.
 *
 * tasks.json'u lider elle yazar ve sık sık `humanQA`'yı DİZİ yerine tek bir
 * nesne olarak bırakır (`"humanQA": { "q": "…" }`). Eski okuyucular yalnız diziyi
 * tanıdığı için bu sorular hiçbir yerde görünmüyordu. Ayrıca lider "işi
 * bloklamıyor" dediği soruları kartı `doing`de tutarak soruyor; pano yalnız
 * `blocked` kartlara baktığı için onlar da kayboluyordu. Kural artık: kartın
 * durumu ne olursa olsun yanıtsız ve kapatılmamış her soru açıktır.
 */

export interface HumanQAEntry {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  dismissedAt?: string;
}

function isEntry(e: unknown): e is HumanQAEntry & Record<string, unknown> {
  return !!e && typeof e === 'object' && !Array.isArray(e) && typeof (e as { q?: unknown }).q === 'string';
}

/** `humanQA` alanını her zaman diziye çevirir: tek nesne → [nesne]; geçersiz girdiler atlanır. */
export function humanQAList(raw: unknown): Array<HumanQAEntry & Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter(isEntry);
  return isEntry(raw) ? [raw] : [];
}

/** En son açık (yanıtsız, kapatılmamış) soru. */
export function openHumanAsk(raw: unknown): (HumanQAEntry & Record<string, unknown>) | undefined {
  const list = humanQAList(raw);
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e.a && !e.dismissedAt) return e;
  }
  return undefined;
}

/** tasks.json içeriğindeki her kartın `humanQA` alanını diziye çevirir (diğer alanlara dokunmaz). */
export function normalizeLedgerHumanQA<T>(ledger: T): T {
  const tasks = (ledger as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) return ledger;
  let changed = false;
  const next = tasks.map((t) => {
    if (!t || typeof t !== 'object' || !('humanQA' in t)) return t;
    const raw = (t as { humanQA?: unknown }).humanQA;
    if (Array.isArray(raw)) return t;
    changed = true;
    return { ...t, humanQA: humanQAList(raw) };
  });
  return changed ? ({ ...(ledger as object), tasks: next } as T) : ledger;
}
