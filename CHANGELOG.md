# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.5] — 2026-11-02

**Emret Agency sürüm numaralandırması 0.0.5'ten yeniden başlıyor.**

- Ajan kartlarında motor rozeti: yeşil **Yerel** (token harcamaz), kırmızı **API**
  (ücretli motor); başlık çubuğunda API kullanan işçi sayısı.
- Logo Ayarlar → Görünüm'den değiştirilebilir.
- Motorlar: Ayarlar'dan kolay motor ekleme ve bağlantı testi, varsayılan işçi motoru,
  İzleme'den ajan kapanana kadar geçerli geçici motor seçimi.
- Ajanlar: görevsiz ve 24 saat boştaki ajan otomatik arşivlenir, görev gelince geri
  gelir; arşivden tek tıkla etkinleştirme; ajan listesinin boşalmasına karşı koruma.
- Ofis Düzenleyici, hazır temalar, yerel modellerle (Ollama) çalışma.

## [0.6.0] — 2026-10-29

**Emret Agency'nin ilk kendi sürümü.** 0.5.5 tabanı alınıp tamamen Türkçe, tek
ofiste çok projeli bir ajan ofisine dönüştürüldü: Türkçe arayüz ve Türkçe çalışan ajanlar,
Gelen Kutusu ve Sohbet, riskli işlemler için insan onay kuyruğu, proje başına etiketli görevler
ve BYOK yedek motorlar.

### Eklendi

- **Tamamen Türkçe arayüz (Faz 1).** `locales/tr.json` (1203 anahtar) varsayılan dil; Çince ve
  Arapça kaldırıldı, İngilizce yalnızca yedek. i18n kullanmayan sabit metinler de Türkçeleştirildi:
  Ayarlar, Ajan Ekle/Düzenle, açılış sihirbazı, çıkış penceresi, Komuta Merkezi, IDE, ofis ekranı,
  ana süreç menü/bildirim/diyalogları. Türkçe harfler için latin-ext fontları.
- **Ajanlar Türkçe çalışıyor (Faz 2).** Her ajan prompt'unda dil kuralı; hafıza sıkıştırma ve
  ajanlara giden mesajlar Türkçe; kadro adları nötr Türkçe (ad/rol ajan bazında düzenlenebilir);
  varsayılan yönetici adı "Proje Lideri". Uygulama adı **Emret Agency**; masaüstünden tek tıkla
  başlatma (`baslat.cmd`).
- **Ajan yetenekleri görünür.** Yetenek etiketleri, özet kartı, kartta görünürlük, Proje Lideri'ne
  yönlendirme; etiketler açılışta hive kaydından eşitlenir.
- **Tek ofis, etiketli projeler (Faz 3).** Proje profilleri ve çalışma alanı kilidi (3.1); proje
  kaydı ve **Projeler sekmesi** (3.2): her görevin `proje` etiketi, proje başına ajan/görev/soru
  görünümü ve tahmini token harcaması. Karar (29 Ekim, Emre): projeler ayrı ofis kopyası olarak
  açılmaz — ortak ekip, boştaki ajan başka projede çalışabilir.
- **Riskli işlemlerde onay kapısı.** Reklam ve harcama kararları doğrudan insana gider (onay
  kuyruğu); reklam/ödeme/mesaj MCP araçları onay kapısının arkasında; uzmanlık rehberleri ve
  yönetici denetimi.
- **Gelen Kutusu.** Size gelen her şey (sorular, onaylar, mesajlar) tek yerde, bildirimle; Slack'e
  de düşer (özel mesaj veya kanal); sorulara ve onaylara Gelen Kutusu'ndan doğrudan yanıt;
  hatırlatma özeti Türkçe.
- **Sohbet sekmesi.** Ajan oturumu WhatsApp tarzı baloncuklarla izlenir.
- **BYOK çoklu motor.** Ajan başına seçilebilir yedek motorlar: **EVREN** (Anthropic+OpenAI
  uyumlu) ve **NVIDIA** (OpenAI uyumlu). Kota/hata algılamayla **otomatik motor geçişi**
  (Claude/EVREN/NVIDIA): eşzamanlı geçiş çökmesi önlenir, geçiş durumu diske yazılır, kota uyarısı
  eşiği %95. Kullanım: `docs/BYOK-MOTORLAR.md`.
- **Ortak bilgi hafızası.** Ajanlar araştırmaya başlamadan önce `bilgi ara`, bitince `bilgi
  kaydet` — aynı araştırma iki kez yapılmaz (token tasarrufu).

### Değişti

- **Otomatik güncelleyici kapatıldı.** Eski güncelleme kaynağı GitHub sürümlerini sorgulayıp
  bizim build'in üzerine orijinali kurabiliyordu; artık sorgulanmıyor. Yazar: Emre Tutucu.
- **Dizi temaları kaldırıldı.** Tema seçicisi ve sesli asistan ayarları gitti; ofis her zaman
  standart tema (The Office göndermeleri yok).
- **Satır sonları LF'ye normalize edildi**; görsel/font dosyaları binary işaretlendi, normalizasyonda
  bozulan ofis görselleri geri yüklendi.

### Upstream kökenli (Emret Agency 0.4.6'dan beri ağaçta biriken)

- **Görev kartlarında kimlik.** Kartın ve ayrıntı görünümünün fact satırının başında, insanların
  kartı andırdığı isim (`bmt-12` gibi) artık mono olarak görünüyor.
- **Model seçiciler güncel.** Fable 5.1, GPT-6 Astra (Codex 0.153.1+ gerektirir), Gemini 3.7
  Flash, Claude Haiku 5.5, Gemini 4 Argon — her kimlik, çalıştırılacak CLI'dan okunarak eklendi.
- **Yeni model artık sürüm gerektirmiyor.** Seçiciler `docs/model-catalog.json`'ı açılışta okur
  (6 saat önbellek); çevrimdışı/bozuk durumda yerleşik liste taban kalır.
- **Topluluk düzeltmeleri.** Takılan worker'ların uyandırılması, done sinyalinde inbox'ın
  yerleşimi, terminalde https bağlantılarının tıklanabilirliği, Shift+Enter ile yeni satır,
  arşivlenmiş ajana giden postanın bildirimi, hook socket'inin kendini düzeltmesi, çökme
  kayıtlarının sınırlandırılması vb.
