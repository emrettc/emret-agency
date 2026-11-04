/**
 * Expertise guides — the field knowledge behind each capability tag.
 *
 * A capability tag ("reklam yönetimi") tells the project lead WHO should own a
 * task. The guide behind it tells the agent HOW the work is done in this office:
 * the rules, the checklist, the limits that need approval. Guides live as plain
 * Markdown in `<hive>/uzmanlik/<slug>.md`, so the human can read and edit them
 * in any editor; the harness only writes a guide that does not exist yet and
 * never overwrites the human's edits.
 *
 * The project lead is told to read every guide: that is what makes the lead the
 * supervisor who knows every field, and it reviews each agent's proposals and
 * results against the matching guide.
 */

export const EXPERTISE_DIR = 'uzmanlik';

const TR_ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** File-name slug for a capability: ASCII, lower case, dash-separated.
 *  "altyapı / DevOps" → "altyapi-devops". Empty when nothing usable remains. */
export function expertiseSlug(capability: string): string {
  return capability
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_ASCII[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Path of a guide relative to the hive root, e.g. "uzmanlik/seo.md". */
export function expertiseFile(capability: string): string | null {
  const slug = expertiseSlug(capability);
  return slug ? `${EXPERTISE_DIR}/${slug}.md` : null;
}

const APPROVAL_NOTE = 'Bu listedeki adımlar Proje Lideri onayı olmadan yapılmaz; para harcayan veya dışarıya ulaşan adımlar ayrıca insan onayı ister.';

/** Built-in starter guides, keyed by the capability tag exactly as the presets
 *  spell it. Short on purpose: a guide is read at the start of every task. */
export const BUILTIN_GUIDES: Record<string, string> = {
  'reklam yönetimi': `# Reklam yönetimi — uzmanlık rehberi

## Ne yapar
Meta (Facebook/Instagram) reklam hesaplarını yönetir: verileri düzenli çeker, hesap kitap yapar, en iyi kampanya önerilerini hazırlar ve insanın onayına sunar. Onay gelen planı uygular ve sonucunu raporlar.

## Meta Ads bağlantısı (resmi MCP: mcp.facebook.com/ads)
- Serbest (okuma): \`ads_get_ad_accounts\`, \`ads_get_ad_entities\`, \`ads_get_pages_for_business\`, \`ads_insights_*\`, \`ads_get_opportunity_score\`, \`ads_get_dataset_*\`, \`ads_get_errors\`, \`ads_catalog_get_*\`.
- Onaylı (yazma, para harcatabilir): \`ads_create_campaign\`, \`ads_create_ad_set\`, \`ads_create_ad\`, \`ads_update_entity\`, \`ads_activate_entity\`, \`ads_catalog_create\`. Bunlar yalnızca insanın onayından sonra ve onaylanan planın aynısıyla çalıştırılır; uygulama ayrıca terminalde onay ister.
- Yeni kampanya, reklam seti ve reklam her zaman DURAKLATILMIŞ (PAUSED) oluşturulur; yayına alma (\`ads_activate_entity\`) ayrı bir onaydır.
- Bağlantı yoksa veya boş veri dönüyorsa (Meta oturumu yaklaşık 60 günde düşer) bunu Proje Liderine bildir; tahminle rapor yazma.

## Sürekli çalışma döngüsü (her direktifte ve her analiz isteğinde)
1. Son 7 ve 30 günün verisini çek: harcama, gösterim, erişim, frekans, tıklama, CTR, CPC, CPM, dönüşüm, CPA, ROAS.
2. Hesap kitap yap: hedef CPA/ROAS'a göre her kampanya ve reklam seti için "büyüt / koru / düzelt / durdur" kararı ver; kararın gerekçesini rakamla yaz.
3. Gelen direktifleri ve önceki onay/ret yanıtlarını \`memory.md\`'ye işle; aynı hatayı tekrar önerme.
4. En iyi 1-3 öneriyi hazırla (bütçe kaydırma, yeni kitle, yeni kreatif testi). Kreatif gerekiyorsa tasarımcıdan iste.
5. Her öneriyi onay kuyruğuna gönder (aşağıdaki format). Onay gelene kadar uygulama.

## Çalışma kuralları
- Ölçüm önce gelir: piksel/Conversions API, dönüşüm olayları ve UTM doğrulanmadan kampanya önerme.
- Bütçeyi bir seferde en fazla %20 artır; öğrenme aşamasındaki reklam setine 3-7 gün dokunma.
- Testte aynı anda tek değişken (görsel, metin veya kitle). Kazananı en az 50 dönüşüm ya da anlamlı fark olmadan ilan etme.
- Hesap erişim bilgilerini dosyaya, mesaja veya hafızaya yazma.

## Onay gerektirenler (her zaman doğrudan İNSANA: "to":"onay")
- Kampanya, reklam seti veya reklam oluşturmak, etkinleştirmek, durdurmak, düzenlemek
- Bütçe, teklif stratejisi, hedef kitle, yerleşim değişikliği
- Yeni reklam metni/görselinin yayına girmesi
Proje Lideri bu kararları veremez; yalnızca bilgilendirilir.

## Onay isteği formatı
\`subject\`: kısa başlık (ör. "Yaz kampanyası: günlük bütçe 300 → 360 TL").
\`body\` (Markdown): **Ne** · **Nerede** (hesap / kampanya adı) · **Neden** (son 7/30 gün rakamları) · **Beklenen etki** · **Geri alma yolu**.
\`cost\`: ör. "günlük +60 TL, 7 gün = 420 TL". \`files\`: kreatif ve rapor dosyalarının tam yolları.

## Rapor kontrol listesi
- Dönem, harcama, gösterim, tıklama, CTR, CPC, dönüşüm, CPA, ROAS
- Önceki dönemle karşılaştırma ve tek cümlelik yorum
- Önerilen sonraki adım ve tahmini maliyeti
`,
  'sosyal medya': `# Sosyal medya — uzmanlık rehberi

## Ne yapar
İçerik takvimi hazırlar, gönderi metni ve görsel brifi yazar, etkileşimi izler ve raporlar.

## Çalışma kuralları
- Marka dili tutarlı olur; emin olmadığın iddiayı, fiyatı veya kampanya koşulunu yazma.
- Her gönderinin amacı (bilgi, etkileşim, satış) ve çağrısı (CTA) belli olur.
- Telif: izni olmayan görsel, müzik veya alıntı kullanma.
- Kriz anı (şikâyet, olumsuz yorum dalgası) Proje Liderine hemen bildirilir; yanıtı tek başına verme.

## Onay gerektirenler
- Gönderi paylaşmak veya planlamak, yorum/mesajlara marka adına yanıt vermek
- Profil bilgisi, bağlantı veya ayar değişikliği
${APPROVAL_NOTE}

## Rapor kontrol listesi
- Erişim, etkileşim oranı, takipçi değişimi, en iyi/en kötü 3 gönderi ve nedenleri
`,
  'içerik yazarlığı': `# İçerik yazarlığı — uzmanlık rehberi

## Ne yapar
Blog, ürün açıklaması, e-posta, reklam metni ve sayfa metinleri yazar.

## Çalışma kuralları
- Önce hedef okuru, amacı ve tek ana mesajı yaz; sonra metni.
- Kısa cümle, somut fayda, kanıtlanabilir iddia. Rakamları kaynağıyla ver.
- Başka yerden metin kopyalama; alıntıda kaynak göster.
- SEO gerekiyorsa anahtar kelimeyi doğal kullan, başlıkta ve ilk paragrafta geçsin.

## Onay gerektirenler
- Metnin yayına girmesi veya müşteriye gönderilmesi
${APPROVAL_NOTE}

## Teslim kontrol listesi
- Başlık seçenekleri (en az 2), metin, CTA, yazım denetimi yapıldı
`,
  'SEO': `# SEO — uzmanlık rehberi

## Ne yapar
Anahtar kelime araştırması, sayfa içi iyileştirme, teknik SEO denetimi ve sıralama takibi.

## Çalışma kuralları
- Kararlar veriyle: arama hacmi, rekabet, mevcut sıralama ve Search Console verisi.
- Kullanıcı için yaz; anahtar kelime doldurma, gizli metin, satın alınmış bağlantı yok.
- Teknik değişiklikte (yönlendirme, robots.txt, canonical, site haritası) önce etkisini yaz.

## Onay gerektirenler
- robots.txt, yönlendirme, URL yapısı veya canlı sayfa değişikliği
${APPROVAL_NOTE}

## Rapor kontrol listesi
- Hedef kelimeler ve sıralama değişimi, organik trafik, bulunan teknik sorunlar ve öncelik sırası
`,
  'e-ticaret': `# E-ticaret — uzmanlık rehberi

## Ne yapar
Ürün kataloğu, fiyat, stok, kampanya ve sipariş süreçlerini yönetir; dönüşüm oranını iyileştirir.

## Çalışma kuralları
- Fiyat ve stok bilgisinin tek doğru kaynağı belirlenir; çelişki görürsen düzeltmeden önce bildir.
- İndirim ve kampanyada kâr marjını hesapla ve öneride yaz.
- Müşteri verisini (ad, adres, telefon) rapora, mesaja veya hafızaya yazma.

## Onay gerektirenler
- Fiyat, indirim, stok veya ürün yayın durumu değişikliği
- İade, iptal veya müşteriye toplu bildirim
${APPROVAL_NOTE}

## Rapor kontrol listesi
- Ciro, sipariş sayısı, ortalama sepet, dönüşüm oranı, iade oranı, en çok satanlar
`,
  'müşteri iletişimi': `# Müşteri iletişimi — uzmanlık rehberi

## Ne yapar
Müşteri sorularına yanıt taslağı hazırlar, talepleri sınıflandırır ve takip eder.

## Çalışma kuralları
- Nazik, kısa, çözüm odaklı yaz. Söz verme yetkin yoksa söz verme.
- Kişisel veriyi yalnızca işin gerektirdiği kadar kullan; başka yere kopyalama.
- Şikâyet ve hukuki konular Proje Liderine iletilir.

## Onay gerektirenler
- Müşteriye mesaj, e-posta veya SMS göndermek; iade/indirim teklif etmek
${APPROVAL_NOTE}
`,
  'veri analizi': `# Veri analizi — uzmanlık rehberi

## Çalışma kuralları
- Sorudan başla: hangi karar verilecek, hangi veri bunu değiştirir.
- Kaynağı, tarih aralığını ve filtreleri raporda yaz; tekrar üretilebilir olsun.
- Korelasyonu nedensellik gibi sunma; örneklem küçükse söyle.

## Rapor kontrol listesi
- Tek cümlelik sonuç, destekleyen 2-3 rakam, varsayımlar, önerilen karar
`,
  'araştırma': `# Araştırma — uzmanlık rehberi

## Çalışma kuralları
- Birden fazla bağımsız kaynakla doğrula; kaynakların tarihini kontrol et.
- Kesin bilgi ile tahmini ayır ve öyle etiketle.

## Teslim kontrol listesi
- Kısa özet, kaynak listesi, açık kalan sorular
`,
  'kod yazma': `# Kod yazma — uzmanlık rehberi

## Çalışma kuralları
- Çevredeki kodun stiline uy; küçük ve incelenebilir değişiklikler yap.
- Davranış değişikliğini test ile kanıtla; testleri çalıştırıp sonucu raporla.

## Onay gerektirenler
- Uzak depoya gönderme (push), yayına alma, veritabanı şeması değişikliği
${APPROVAL_NOTE}
`,
  'kod inceleme': `# Kod inceleme — uzmanlık rehberi

## Kontrol listesi
- Doğruluk ve uç durumlar, güvenlik, hata yönetimi, test kapsamı, okunabilirlik
- Her bulgu için: dosya:satır, sorun, somut öneri
`,
  'test': `# Test — uzmanlık rehberi

## Çalışma kuralları
- Önce başarısız olan testi yaz, sonra düzeltmeyi doğrula.
- Kararsız (flaky) testi gizleme; nedenini bul veya raporla.
`,
  'hata ayıklama': `# Hata ayıklama — uzmanlık rehberi

## Çalışma kuralları
- Önce hatayı yeniden üret, sonra kök nedeni kanıtla, en son düzelt.
- Raporda: belirti, kök neden, kanıt, düzeltme, nasıl doğrulandı.
`,
  'dokümantasyon': `# Dokümantasyon — uzmanlık rehberi

## Çalışma kuralları
- Okuru düşün: yeni başlayan biri bu belgeyle işi yapabilmeli.
- Uzun anlatım yerine çalışan örnek ver; kodla senkron tut.
`,
  'tasarım': `# Tasarım — uzmanlık rehberi

## Ne yapar
Reklam kreatifleri ve görseller hazırlar; her kreatifi insanın onayına sunar ve onay gelene kadar bekletir.

## Reklam kreatifleri
- Brif önce: reklamcıdan hedef, kitle, ana mesaj, CTA ve formatları al; eksikse sor.
- Meta formatları: kare 1080×1080 (akış), dikey 1080×1920 (Story/Reels, üst-alt %14 güvenli alan), 1080×1350 (4:5 akış). Metin görselin küçük bir kısmında kalsın; logo ve marka renkleri tutarlı.
- Her kreatif için 2-3 varyasyon hazırla (görsel veya başlık farkı), dosya adlarına sürüm yaz: \`kampanya-adi_kare_v1.png\`.
- Dosyaları çalışma klasöründe \`kreatifler/<kampanya-adi>/\` altına kaydet.
- Görseli kodla üretiyorsan (SVG/HTML) mutlaka PNG veya SVG önizleme dosyası da bırak; insan dosyayı görerek onaylar.
- Reklam metnini (birincil metin, başlık, açıklama, CTA) kreatifle birlikte yaz.

## Onaya sunma (doğrudan İNSANA: "to":"onay")
- \`subject\`: "Kreatif: <kampanya> v1".
- \`body\`: brif özeti, varyasyonların farkı, reklam metinleri.
- \`files\`: tüm kreatif dosyalarının tam yolları.
- Onay gelene kadar kreatif hiçbir yerde kullanılmaz. "Revize" gelirse nottaki değişiklikleri yapıp yeni sürümle (v2) tekrar sun. Onaylanan dosyaları reklamcıya bildir.

## Çalışma kuralları
- Erişilebilirlik: yeterli kontrast, okunur yazı boyutu, mobil uyum.
- Lisansı belirsiz görsel, ikon veya yazı tipi kullanma.
`,
  'altyapı / DevOps': `# Altyapı / DevOps — uzmanlık rehberi

## Onay gerektirenler
- Canlı ortamda değişiklik, yayına alma, sunucu/servis açma (maliyet doğurur)
- Erişim yetkisi, güvenlik duvarı veya gizli anahtar değişikliği
${APPROVAL_NOTE}
`,
  'güvenlik': `# Güvenlik — uzmanlık rehberi

## Çalışma kuralları
- Gizli bilgileri (anahtar, parola, token) asla rapora, mesaja veya hafızaya yazma.
- Bulguları önem derecesiyle raporla; istismar adımlarını paylaşma.
`,
  'sürüm yönetimi': `# Sürüm yönetimi — uzmanlık rehberi

## Onay gerektirenler
- Sürüm etiketi oluşturmak, paket yayınlamak, mağazaya göndermek
${APPROVAL_NOTE}
`,
  'planlama': `# Planlama — uzmanlık rehberi

## Çalışma kuralları
- Hedefi, kapsamı, teslim tarihini ve "bitti" tanımını yaz.
- İşi sahibi belli, birbirinden bağımsız küçük görevlere böl.
`
};

/** The guide written for a capability with no built-in guide: a skeleton the
 *  human (or the project lead) fills in. */
export function blankGuide(capability: string): string {
  return `# ${capability} — uzmanlık rehberi

_Bu rehber henüz doldurulmadı. Bu alanın kurallarını buraya yazın; ajan her görevin başında okur._

## Ne yapar

## Çalışma kuralları

## Onay gerektirenler
${APPROVAL_NOTE}

## Teslim / rapor kontrol listesi
`;
}

/** Starter text for a capability's guide: the built-in one when it exists
 *  (matched case-insensitively), otherwise the blank skeleton. */
export function guideFor(capability: string): string {
  const key = capability.toLocaleLowerCase('tr');
  for (const [name, text] of Object.entries(BUILTIN_GUIDES)) {
    if (name.toLocaleLowerCase('tr') === key) return text;
  }
  return blankGuide(capability);
}
