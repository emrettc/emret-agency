# Sürüm Notları — Emret Agency

Anlaşılır Türkçe sürüm notları: her sürümde ne değişti, neye dikkat etmek gerekiyor.
Teknik ayrıntıların tamamı [CHANGELOG.md](../CHANGELOG.md)'de, plan [YOL-HARITASI.md](YOL-HARITASI.md)'de.

## 0.6.0 — 29 Ekim 2026

**Emret Agency'nin ilk kendi sürümü.** 0.5.5 tabanı (2 Ekim 2026) alınıp
Türkçe ve çok projeli bir ofise dönüştürüldü. Son kullanıcı gözüyle en önemli değişiklikler:

### Ofis artık Türkçe

- Menüler, ayarlar, açılış sihirbazı, bildirimler — arayüzün tamamı Türkçe. Çince ve Arapça
  dil paketleri kaldırıldı; İngilizce yalnızca eksik kalırsa yedek olarak devreye giriyor.
- Ajanlar da Türkçe çalışıyor: birbirlerine ve size yazdıkları mesajlar, hafıza notları ve
  görev panosu kayıtları Türkçe. Kadro adları nötr Türkçe isimler; her ajanın adını ve rolünü
  düzenleyebilirsiniz. Varsayılan yöneticinin adı "Proje Lideri".
- Uygulamanın adı artık **Emret Agency**. Masaüstündeki kısayola çift tıklayın
  (`baslat.cmd` çalıştırır); pencere açıldığında komut penceresini açık bırakın.

### Tek ofis, birden çok proje

- Projeler ayrı ofis pencereleri olarak değil, **aynı ofiste etiketle** ayrılıyor (29 Ekim
  kararı). Her görev bir projeye bağlı; boşta kalan ajan başka projenin işini alabilir.
- Yeni **Projeler sekmesi**: her proje için ayrı sekmede o projenin ajanları, görevleri,
  size sorduğu sorular ve tahmini token harcaması.

### Size gelen her şey tek yerde

- **Gelen Kutusu**: ajanların soruları, onay istekleri ve mesajları tek ekranda, bildirimle.
  Sorulara ve onaylara oradan doğrudan yanıt verebilirsiniz; isterseniz Slack'e de düşer.
- **Sohbet sekmesi**: bir ajanın oturumunu WhatsApp tarzı baloncuklarla izleyebilirsiniz.
- **Onay kuyruğu**: para harcatan, canlı hesaba dokunan ya da dışarıya yayın yapan işler
  (reklam, ödeme, mesaj) artık doğrudan size gelir — ajan onaysız ilerleyemez.

### Motor ve maliyet

- **BYOK yedek motorlar**: ajan başına EVREN veya NVIDIA seçilebilir; Claude kotası
  azaldığında ofis otomatik olarak yedek motora geçer, kota açılınca geri döner.
  Nasıl kurulur: [BYOK-MOTORLAR.md](BYOK-MOTORLAR.md).
- **Ortak bilgi hafızası**: ajanlar araştırma yapmadan önce ortak notlara bakar
  (`bilgi ara`), yeni bulguları oraya yazar (`bilgi kaydet`) — aynı iş iki kez
  araştırılmaz, token harcaması düşer.

### Dikkat edilecekler

- **Otomatik güncelleyici kapalı.** Açık kalsaydı orijinal Emret Agency sürümlerini
  bulup bizim build'in üzerine kurabilirdi. Yeni sürüm kurmak her zaman elle yapılır;
  bu notlar bilgi amaçlı.
- İç paket adı `emrettc` olarak korundu (veri klasörü yolu değişmesin diye);
  görünür ad her yerde Emret Agency.
- NVIDIA'nın Anthropic uyumlu URL'si yok: Claude çalıştıran ajanlar yalnız EVREN'i
  yedek motor olarak seçebilir.
- Bu sürüm aynı zamanda upstream'in 0.4.6'dan beri biriken düzeltmelerini ve güncel
  model listesini (Fable 5.1, GPT-6 Astra, Gemini 3.7 Flash, Haiku 5.5, Gemini 4
  Argon) içerir.

### Sırada ne var (YOL-HARITASI.md'den)

- Genel Müdür katmanı: projeler arası görev dağıtımı ve raporlama.
- Proje oluşturma / kapatma / arşivleme arayüzü.
- Güncelleme arayüzü metinlerinin Türkçeleştirilmesi (güncelleyici kapalı, acil değil).
