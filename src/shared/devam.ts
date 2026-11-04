/**
 * Devam noktası (`devam.md`) — ajanın "ne yapıyordum, sırada ne var" notu.
 *
 * memory.md yalnız eklenen uzun bir günlüktür; konuşma sıfırlanınca ya da
 * özetlenince ajan işin neresinde olduğunu kaybeder ve geçmişi/dosyaları baştan
 * tarar (ilanveral-ui 2026-11-03: 173k tokenlık konuşmadan hafızada 116 bayt
 * kalmıştı). devam.md kısa tutulur, üzerine YAZILIR (eklenmez) ve her oturum
 * başında uygulama tarafından ajana verilir — ajan "Sıradaki adım"dan sürer.
 */

/** Ajana verilecek en fazla karakter (~1500 token). */
export const DEVAM_MAX_CHARS = 6000;

/** Devam noktası bu süreden eskiyse ve ajan çalışıyorsa hatırlatılır. */
export const DEVAM_STALE_MS = 20 * 60_000;

export function devamTemplate(name: string, id: string): string {
  return [
    `# Devam noktası — ${name} (${id})`,
    '',
    '_Bu dosyanın ÜZERİNE YAZ (ekleme yapma), en fazla ~40 satır. Her önemli adımdan sonra ve turu bitirmeden önce güncelle._',
    '',
    '## Görev',
    '-',
    '## Bitenler',
    '-',
    '## Sıradaki adım',
    '-',
    '## Dosyalar (yol:satır)',
    '-',
    '## Açık sorular',
    '-',
    ''
  ].join('\n');
}

/** Şablondan başka bir şey yazılmış mı? (Boş şablon ajana verilmez.) */
export function devamHasContent(text: string): boolean {
  const body = text
    .split(/\r?\n/)
    .filter((l) => !/^#|^_.*_$/.test(l.trim()))
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return body.length > 0;
}

/** Ajana verilecek blok; içerik yoksa null. Çok uzunsa başı korunur: başlıklar
 *  Görev → Bitenler → Sıradaki adım sırasında, en önemlisi baştadır. */
export function devamContext(text: string | null | undefined): string | null {
  if (!text || !devamHasContent(text)) return null;
  const t = text.trim();
  const body = t.length > DEVAM_MAX_CHARS ? `${t.slice(0, DEVAM_MAX_CHARS)}\n…(kısaltıldı)` : t;
  return [
    '<devam>',
    body,
    '</devam>',
    'Yukarıdaki senin devam noktan (devam.md). Konuşma geçmişini ya da dosyaları baştan taramadan "Sıradaki adım"dan devam et; yalnız gerçekten gereken dosyayı oku.'
  ].join('\n');
}

/** Çalışan ajanın devam noktası hatırlatılmalı mı? */
export function devamNeedsReminder(devamMtimeMs: number | null, lastReminderMs: number | null, now: number): boolean {
  if (lastReminderMs !== null && now - lastReminderMs < DEVAM_STALE_MS) return false;
  return devamMtimeMs === null || now - devamMtimeMs >= DEVAM_STALE_MS;
}

export const DEVAM_REMINDER =
  'Hatırlatma: devam.md (devam noktan) 20 dakikadır güncellenmedi. Şu anki adımı bitirince dosyanın ÜZERİNE YAZ: Görev / Bitenler / Sıradaki adım / Dosyalar / Açık sorular — kısa tut.';
