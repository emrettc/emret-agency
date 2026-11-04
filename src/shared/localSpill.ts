/**
 * Taşma politikası — yerel sıra uzarsa işçi istekleri hangi API motorlarına,
 * hangi sırayla gider (main/localGate.ts uygular). Saf yardımcılar; testler
 * doğrudan çağırır.
 *
 * Emre 2026-11-03: sıra YEREL → ÜCRETSİZ API → ÜCRETLİ API; API kalmazsa
 * yerelden devam. Ücretli abonelikte (Claude) işçiler %60'ta durur, %40
 * yöneticiye kalır (engineHealth.LOW_QUOTA_USED_PCT). Yüzde bildirmeyen
 * anahtarlarda (Kimi) sağlayıcının kota/kredi hatasına göre geçilir.
 */
import type { EngineFailure, EngineFailureReason } from './engineHealth';

export interface LocalSpillConfig {
  enabled: boolean;
  /** Yerel sırada en çok bu kadar beklenir (sn). */
  afterSec?: number;
  /** Motor kimlikleri; ücretsizler ücretlilerden önce denenir, kendi aralarında bu sırayla. */
  order: string[];
  /** Ücretsiz motorlar (token parası ödenmeyen). */
  free?: string[];
  /** Motor başına model (boşsa motorun varsayılanı). */
  models?: Record<string, string>;
}

/** Denenecek sıra: önce ücretsiz, sonra ücretli; tekrarlar atılır. */
export function spillOrder(cfg: LocalSpillConfig | undefined): string[] {
  if (!cfg?.enabled) return [];
  const free = new Set(cfg.free ?? []);
  const uniq = cfg.order.filter((id, i) => cfg.order.indexOf(id) === i);
  return [...uniq.filter((id) => free.has(id)), ...uniq.filter((id) => !free.has(id))];
}

/** Arayüz sırası: ücretsizler önce, sonra ücretliler (kendi aralarında verilen sırayla). */
export function spillTierOrder(order: string[], free: string[]): string[] {
  return spillOrder({ enabled: true, order, free });
}

const MIN = 60_000;

/** API motorunun hata yanıtı → ne kadar süre kapalı sayılacağı. */
export function spillFailure(status: number, detail: string, now: number): EngineFailure {
  // Sağlayıcılar kredi bitişini de 429 ile bildirir (OpenAI "no credits remaining",
  // Kimi "suspended due to insufficient balance"); EVREN anlık eşzamanlılık
  // sınırını da 429 ile ("en fazla 4 eşzamanlı istek"). Metne göre ayrılır.
  const credits = /credit|balance|bakiye|insufficient|billing|suspended|payment|quota exceeded/i.test(detail);
  const busy = /eşzamanlı|concurren|yoğun|busy|overloaded|try again/i.test(detail);
  const [reason, mins]: [EngineFailureReason, number] =
    credits ? ['credits', 6 * 60]
    : status === 429 && busy ? ['rate', 1]
    : status === 429 ? ['rate', 15]
      : status === 402 ? ['credits', 6 * 60]
        : status === 401 || status === 403 ? ['auth', 6 * 60]
          : status === 404 ? ['unavailable', 60]
            : ['unavailable', 5];
  const text = detail.replace(/\s+/g, ' ').trim().slice(0, 140);
  return { reason, untilMs: now + mins * MIN, detail: `taşma: HTTP ${status || 'bağlantı'}${text ? ` — ${text}` : ''}` };
}
