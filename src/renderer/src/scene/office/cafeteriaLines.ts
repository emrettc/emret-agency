// Mola alanı sohbetleri — nötr, işyerine uygun Türkçe satırlar.
//
// İki tür satır var:
//   • solo  — mola noktasındaki tek bir ajanın üstünde görünen kısa bir söz
//   • pair  — aynı masadaki iki ajan arasında iki-dört vuruşluk bir karşılıklı konuşma
//
// Satırlar ThoughtBubble'a (≈MAX_WIDTH) sığsın diye kısa tutulur. Karakter
// adına göre özel satır yok: kadro kullanıcı tarafından düzenlenebildiği için
// herkes aynı ortak havuzdan konuşur.

import type { OfficeCharacterName } from './cast';

/** Ajanın oyalandığı yer — bağlama uygun satır havuzunu seçer. */
export type BreakSpot = 'coffee' | 'vending' | 'snack' | 'table';

const pick = <T,>(arr: readonly T[], seed: number): T =>
  arr[((seed % arr.length) + arr.length) % arr.length];

// ─── tekil satırlar, noktaya göre ────────────────────────────────────────────

const COFFEE: readonly string[] = [
  'günün ilk kahvesi. ve beşincisi.',
  'kahve çekirdeği yine bitmiş',
  'bir çay demlesek mi?',
  'kupam nerede acaba?',
  'kahve olmadan derleme olmaz',
  'şu makine bugün yavaş',
];

const VENDING: readonly string[] = [
  'makine bozuk paramı yuttu',
  'B4… lütfen kraker olsun',
  'takıldı. tabii ki.',
  'nazikçe sallıyorum. saygıyla.',
  'küçük bir moral atıştırmalığı',
  'yine A1. risk alıyorum.',
];

const SNACK: readonly string[] = [
  'simit var mı bugün?',
  'cipsleri kim bitirdi??',
  'ufak bir ödül',
  'bunlar herkesin mi? tamam tamam',
  'ikinci kahvaltı',
];

const TABLE: readonly string[] = [
  'yoğun gün. bol toplantı.',
  'beş dakika daha',
  'günlük toplantı notlarını gördün mü?',
  'notlarımı okuyormuş gibi yapıyorum',
  'bu molaya ihtiyacım vardı',
  'testler yeşil, içim rahat',
];

const SPOT_POOL: Record<BreakSpot, readonly string[]> = {
  coffee: COFFEE, vending: VENDING, snack: SNACK, table: TABLE,
};

/** Mola alanı için tekil bir satır, ajanın durduğu noktaya göre. `seed` her
 *  çağrı noktasında sonucu belirli tutar (Math.random kullanılmaz).
 *  `character` imza uyumluluğu için duruyor; satırlar karaktere özel değil. */
export function pickSoloLine(_character: OfficeCharacterName, spot: BreakSpot, seed: number): string {
  return pick(SPOT_POOL[spot], seed);
}

// ─── karşılıklı konuşmalar (aynı masadaki iki ajan) ───────────────────────────
//
// Her konuşma, iki ajan arasında SIRAYLA söylenen vuruşlardan oluşur:
// beat[0] = masaya ilk oturan, beat[1] = masa arkadaşı, beat[2] = yine ilki…
// Uzun satırlar düşünce balonunda otomatik kısaltılır.

type Exchange = readonly string[];

const PAIR_POOL: readonly Exchange[] = [
  ['derleme yeşil mi?', '…bakma şimdi.'],
  ['toplantı 40 dakika sürdü.', 'e-posta olabilirdi.'],
  ['herkese yanıtla’yı kim bastı?', 'onu konuşmuyoruz.'],
  ['testleri çalıştırdın mı?', 'çalıştırıyorum.', 'ne zamandır?', 'bir süredir.'],
  ['bu hata dün yoktu.', 'dün bakmamıştık.', 'haklısın.'],
  ['kod incelemesi bekliyor.', 'bakıyorum.', 'gerçekten mi?', 'kahveden sonra.'],
  ['dokümantasyonu kim güncelledi?', 'ben.', 'teşekkürler.', 'rica ederim.'],
  ['teslim tarihi ne zaman?', 'cuma.', 'hangi cuma?', 'bu cuma.'],
  ['bir satırlık değişiklik dedin.', 'öyleydi.', '400 satır olmuş.', 'yan etkiler.'],
  ['çay mı kahve mi?', 'çay.', 'demli mi?', 'tavşan kanı.'],
  ['bugün kaç görev bitti?', 'üç.', 'güzel.', 'bir tanesi yarımdı.'],
  ['bağlamın doldu mu?', 'yarısı.', 'sıkıştırma zamanı yaklaşıyor.'],
  ['bu fonksiyonu kim yazdı?', '…git blame bakmayalım.'],
  ['yine merge çakışması.', 'hangi dosyada?', 'hepsinde.', 'harika.'],
  ['öğle yemeği ne?', 'mercimek çorbası.', 'yine mi?', 'her zaman.'],
  ['yeni görev geldi.', 'öncelik?', 'acil.', 'hepsi acil.'],
  ['canlıya çıktı mı?', 'çıktı.', 'sorun var mı?', 'henüz yok.'],
  ['hafıza dosyanı güncelledin mi?', 'şimdi güncelliyorum.'],
  ['bu hafta çok iş çıkardık.', 'hak ettik bu molayı.'],
  ['yönetici ne dedi?', 'önce testler.', 'mantıklı.'],
];

/** Bir masayı paylaşan iki ajan için çok vuruşlu bir konuşma. Vuruşlar sırayla:
 *  0 = `speaker`, 1 = masa arkadaşı, 2 = speaker, … `speaker` imza uyumluluğu
 *  için duruyor; konuşmalar karaktere özel değil. */
export function pickExchange(_speaker: OfficeCharacterName, seed: number): Exchange {
  return pick(PAIR_POOL, seed);
}
