# Faz 3 Tasarımı — Çok Projeli Emret Agency

Durum: **Onaylandı — uygulama sürüyor** (3.1 tamamlandı)

## 1. Amaç

- Birden fazla proje **aynı anda** çalışsın. Her projenin kendi ekibi (ajanlar,
  hafıza, görev panosu) ve kendi **Proje Lideri** olsun.
- En üstte tüm projeleri gören bir **Genel Müdür** olsun: projelere iş dağıtsın,
  durumlarını izlesin, size toplu rapor versin.
- Kullanıcı tek bir yerden projeleri açıp kapatabilsin, hepsinin durumunu görebilsin.

## 2. Mevcut durum (koddan çıkan bulgular)

| Konu | Durum |
|---|---|
| Hive (çalışma alanı) | `HiveManager` tek bir kök klasöre bağlı; kök, `config.json`'daki `harnessHome`'dan okunuyor |
| Ana süreç servisleri | Hook sunucusu, telemetri, devre kesici, maliyet defteri, zamanlayıcılar, webhook/Slack, worker izleyici — hepsi süreç başına **tek kopya** (`src/main/index.ts`, ~255 hive referansı) |
| Ajan kimlikleri | Her hive'da yönetici `god` kimliğini kullanıyor. Aynı süreçte iki hive olursa telemetri, devre kesici ve PTY eşlemeleri **çakışır** |
| Ayarlar | `userData/config.json` — tek dosya; tek kopya kilidi de `userData`'ya bağlı |
| Çoklu pencere ("floor") | Var, ama tüm pencereler **aynı hive'ı** paylaşıyor |
| Hive değiştirme | Uygulamayı yeniden başlatıyor (aynı anda tek hive) |
| Yerel portlar | Telemetri ve entegrasyon aracısı rastgele boş port alıyor; webhook/Slack isteğe bağlı ve port ayarlanabilir → birden fazla kopya çakışmaz |

## 3. Seçenekler

### A) Proje başına ayrı uygulama süreci (önerilen)

Her proje, kendi ayar profiliyle çalışan ayrı bir Emret Agency kopyasıdır. Genel Müdür
de kendi "Merkez" kopyasında oturur. Projeler arası iletişim, hive'ın zaten kullandığı
**dosya tabanlı posta kutusu** modeliyle yapılır.

### B) Tek süreçte çoklu hive

`HiveManager`, hook sunucusu, telemetri, devre kesici, maliyet defteri, zamanlayıcılar
ve arayüz durumunun tamamı proje başına örneklenebilir hale getirilir; ajan kimlikleri
proje önekiyle ad alanına alınır.

### Karşılaştırma

| | A) Ayrı süreç | B) Tek süreç |
|---|---|---|
| Değişiklik boyutu | Küçük-orta: profil desteği + proje yöneticisi + projeler arası posta | Çok büyük: `index.ts`'in büyük kısmı, `hive.ts`, renderer store |
| Risk | Düşük — mevcut tek-hive kodu olduğu gibi çalışır | Yüksek — kimlik çakışmaları, ince eşzamanlılık hataları |
| Hata yalıtımı | Bir proje çökerse diğerleri etkilenmez | Bir hata tüm projeleri düşürür |
| Bellek | Proje başına ~300–500 MB (Electron) | Daha az |
| Taban koddan güncelleme almak | Kolay — çekirdeğe az dokunuluyor | Zor — çekirdek yeniden yazılıyor |
| Teslim süresi | Birkaç oturum | Çok daha uzun |

**Öneri: A.** Ölçek beklentisi (aynı anda birkaç–on proje) için bellek maliyeti kabul
edilebilir; karşılığında mevcut, testlenmiş tek-hive kodunu bozmadan, hata yalıtımlı ve
hızlı teslim edilebilir bir yapı elde ediyoruz. İleride gerekirse B'ye geçiş, A'nın
posta kutusu protokolünü koruyarak yapılabilir.

## 4. Önerilen mimari (A)

### 4.1 Kavramlar

- **Merkez**: Genel Müdür'ün ofisi. Uygulamayı normal açtığınızda gelen kopya budur.
  Kendi hive'ı vardır; yöneticisinin adı **Genel Müdür**'dür.
- **Proje**: Kendi profilinde çalışan bir kopya. Kendi hive'ı, ajanları ve **Proje
  Lideri** vardır. Kendi penceresinde açılır.

### 4.2 Klasör ve profil yapısı

```
%APPDATA%\emrettc\                 ← Merkez profili (bugünkü kurulum, değişmez)
  config.json
  projeler.json                           ← proje kaydı (id, ad, klasör, durum, renk)
  profiles\<proje-id>\                    ← her projenin ayar profili (Electron userData)
    config.json                           ← harnessHome = proje klasörü

C:\Users\<kullanici>\AjansOfisi\Projeler\<proje-adı>\   ← projenin ana klasörü (harnessHome)
  hive\                                   ← ajanlar, hafıza, görevler, posta
  roster.json
```

- Yeni seçenek: `--profile=<proje-id>`. Ana süreç, `app.ready`'den ve tek kopya
  kilidinden **önce** `userData` yolunu `profiles\<proje-id>` olarak ayarlar. Böylece
  her projenin kendi `config.json`'ı, şifreli anahtarları ve tek kopya kilidi olur;
  aynı proje iki kez açılamaz, farklı projeler aynı anda açılabilir.
- Mevcut kurulumunuz (Faruk ve Proje Lideri'nin olduğu hive) **Merkez** olarak kalır,
  hiçbir veri taşınmaz. İsterseniz onu ilk proje olarak da kaydedebiliriz (bkz. Açık Sorular).

### 4.3 Proje yönetimi (Merkez penceresi)

Komuta Merkezi'ne yeni bir **"Projeler"** sekmesi:

- Proje listesi: ad, durum (çalışıyor / durdu), aktif ajan sayısı, açık görevler,
  **sizi bekleyen sorular**, bugünkü token/maliyet.
- Eylemler: **Yeni proje** (ad + klasör + motor), **Aç** (kopyayı başlatır ya da
  penceresini öne getirir), **Durdur** (mesai bitişi protokolüyle güvenli kapatma),
  **Arşivle**.
- Yeni proje oluşturulurken Merkez'in ortak ayarları (varsayılan model, özerklik,
  MCP sunucuları, devre kesici sınırları, dil) yeni profile kopyalanır.
- Durum bilgisi, her projenin `hive\fleet.json` ve `hive\tasks.json` dosyalarından
  **salt okunur** olarak toplanır; projeye çalışırken dokunulmaz.

### 4.4 Projeler arası posta

Hive zaten dosya tabanlı ve tek yazarlı bir posta modeli kullanıyor (ajan → `outbox`,
yönlendirici → alıcının `inbox`). Bunu süreçler arasına genişletiyoruz:

- Her hive'a yeni bir klasör: `hive\dis-posta\` (dış gelen kutusu). Bu klasöre
  **yalnızca dışarıdan** atomik dosya yazılır (geçici dosyaya yaz → yeniden adlandır).
- Her kopyanın ana süreci bu klasörü izler ve gelen her mektubu kendi yönlendiricisi
  üzerinden yöneticisine teslim eder (`hive.send`, `from: "genel-mudur"` veya
  `from: "proje:<id>"`). Böylece "hive'a yalnızca kendi ana süreci yazar" kuralı korunur.
- Adresleme:
  - Genel Müdür → bir proje: `to: "proje:<id>"`. Merkez'in yönlendiricisi bunu
    `projeler.json`'dan bulduğu klasörün `hive\dis-posta\`'sına bırakır.
  - Proje Lideri → Genel Müdür: `to: "genel-mudur"`. Projenin yönlendiricisi bunu
    Merkez'in `hive\dis-posta\`'sına bırakır.
- Proje kapalıyken gelen mektuplar klasörde bekler; proje açıldığında teslim edilir.
- Döngü koruması: mevcut `hops` sayacı aynen taşınır.

### 4.5 Genel Müdür'ün çalışma biçimi

- Prompt'una, bugünkü LIVE ROSTER'ın benzeri bir **PROJE LİSTESİ** eklenir: her
  projenin adı, durumu, lideri, açık/engelli görev sayısı, bekleyen insan soruları, son
  etkinlik ve harcama.
- Yetkileri:
  - Projelere iş gönderir (yalnızca **Proje Liderlerine** — projenin ajanlarına doğrudan
    değil; ekibi lider yönetir).
  - Proje raporlarını okur, size projeler arası özet çıkarır.
  - Kapalı bir projeyi açmak/kapatmak için size sorar (kaynak ve maliyet kararı).
- Proje Liderlerinin prompt'una tek satır eklenir: "Üstünde bir Genel Müdür var;
  proje dışı kararlar ve proje durum raporları için ona `to: genel-mudur` ile yaz."

### 4.6 Size görünen deneyim

1. Emret Agency'yi açarsınız → Merkez açılır, Genel Müdür hazırdır.
2. "Projeler" sekmesinden proje oluşturur veya açarsınız → her proje kendi penceresinde,
   kendi ekibiyle çalışır.
3. Genel Müdür'e "X projesinde şu işi başlat, Y projesinin durumunu raporla" dersiniz;
   o da ilgili Proje Liderlerine yazar.
4. Tüm projelerden sizi bekleyen sorular Merkez'de toplu görünür.

## 5. Riskler ve sınırlar

- **Bellek:** Proje başına ~300–500 MB. Aynı anda çok proje açıksa bilgisayar
  zorlanabilir; Projeler sekmesi toplam açık proje sayısını gösterecek.
- **Aynı depo iki projede:** İki proje aynı kod klasöründe çalışırsa çakışabilir;
  oluştururken uyarılır (git worktree yalıtımı bu sorunu azaltır).
- **Ayar ayrışması:** Projeler ayarları kopyalayarak başlar; sonradan Merkez'de
  değişen ortak bir ayar otomatik yayılmaz (v2: "ortak ayarları eşitle" düğmesi).
- **Geliştirme modu:** `npm run dev` altında ek kopya başlatmak, Electron'u aynı
  renderer adresiyle tekrar çalıştırarak yapılır; paketli kurulumda doğrudan exe.

## 6. Uygulama planı

| Adım | İçerik | Doğrulama |
|---|---|---|
| **3.1 Profil desteği** | `--profile` seçeneği, profil başına `userData`, profil kopyalama | İki farklı profil aynı anda açılıyor; aynı profil ikinci kez açılmıyor (test) |
| **3.2 Proje kaydı ve Projeler sekmesi** | `projeler.json`, oluştur/aç/durdur/arşivle, durum özeti | Arayüzden proje oluşturup açma; durum dosyalardan okunuyor (test) |
| **3.3 Projeler arası posta** | `dis-posta` klasörü, izleyici, `proje:<id>` ve `genel-mudur` adresleme | Merkez → proje ve proje → Merkez mektupları teslim ediliyor; kapalı projede bekliyor (test) |
| **3.4 Genel Müdür** | Merkez yöneticisinin adı/rolü, PROJE LİSTESİ enjeksiyonu, lider prompt satırı | Genel Müdür prompt'unda proje listesi; uçtan uca bir görev dağıtımı denemesi |
| **3.5 Toplu "Bana Sor" ve rapor** | Projelerden bekleyen soruları Merkez'de toplama | Proje kartında soru sayısı ve Merkez listesi |
| **3.6 Kurulum dosyası** | `npm run dist:win` ile Emret Agency kurulumu | Kurulumdan açılan uygulamada 3.1–3.5 |

Her adım ayrı commit'ler ve testlerle ilerler; her adımdan sonra uygulama çalışır halde kalır.

## 7. Kararlar (27 Ekim 2026)

| Soru | Karar |
|---|---|
| Proje klasörleri | `C:\Users\<kullanici>\AjansOfisi\Projeler\<ad>` |
| Genel Müdür projelerin ajanlarına doğrudan iş verebilir mi? | **Evet** — Proje Liderlerinin yanı sıra projedeki ajanlara da `proje:<id>/<ajan>` adresiyle yazabilir (4.4 ve 4.5 buna göre uygulanacak) |
| API anahtarları ve ayarlar | **Her proje tamamen ayrı** — Merkez'den kopyalanmaz; her proje kendi profilinde sıfırdan kurulur (4.3'teki "ortak ayarları kopyala" maddesi geçersiz) |
| Aynı anda kaç proje/ajan? | **Sınır yok** — uygulama üst sınır koymaz; Projeler sekmesi açık proje sayısını bilgi olarak gösterir |
| Mevcut kurulum | Açık — öneri: Merkez olarak kalsın |

## 8. Uygulananlar

- **3.1 Profil desteği:** `--profile=<id>` (`src/main/profile.ts`, `src/shared/profile.ts`).
- **Çalışma alanı kilidi** (`src/main/hiveLock.ts`): Profil başına tek kopya kilidi
  yetmediği için eklendi. Elle denemede, Merkez'in hive'ını gösteren bir test profilinin
  aynı hive'ı ikinci kez çalıştırdığı görüldü. Kilit, iki kopyanın aynı `harnessHome`'a
  bağlanmasını açılışta, ilk kurulumda ve çalışma alanı değişiminde engeller.
- **Riskli işlemlerde onay** (kullanıcı isteği):
  - Hook katmanı (`src/shared/riskGate.ts`): Toplu silme, `git push`, yıkıcı git ve
    veritabanı komutları, yayına alma, internetten betik çalıştırma ve gizli dosyalara
    yazma `permissionDecision: "ask"` ile durur; ajan terminalinde onay sorulur.
    Otomatik modda (`bypassPermissions`) da geçerli olduğu gerçek Claude CLI ile
    doğrulandı.
  - Talimat kuralı (`hive.ts` `RISK_LINE`): Para harcama, dışarıyla iletişim, kapsam veya
    güvenlik değişikliği gibi tek bir komut olmayan kararlar BANA SOR panosundan sorulur.
  - Ayarlar → Özerklik ve Bütçeler → "Riskli işlemlerde bana sor" (varsayılan açık).
  - Sınır: Hook kapısı Claude Code ajanlarında doğrulandı. Codex gibi diğer motorlarda
    yalnızca talimat kuralı garanti; hook desteği motorlara göre ayrıca test edilecek.
- **3.2 Proje kaydı ve Projeler sekmesi** (`src/main/projects.ts`,
  `src/renderer/src/components/ProjectsTab.tsx`):
  - Kayıt Merkez'in `userData\projeler.json` dosyasında. Yeni proje: ad → profil kimliği
    (Türkçe harfler sadeleştirilir, çakışırsa `-2`), klasör (varsayılan
    `C:\Users\<kullanici>\AjansOfisi\Projeler\<ad>`), profil `config.json`'ına yalnızca
    `harnessHome` yazılır; diğer her şey ilk açılışta sıfırdan kurulur (karar §7).
  - **Aç:** `--profile=<id>` ile yeni uygulama kopyası (geliştirmede `electron <app> --profile`).
    Çalışan bir proje yeniden açılınca Electron'un profil başına tek kopya kilidi
    mevcut pencereyi öne getirir.
  - **Durdur:** Proje klasörüne `.tutucu-ofis.stop` istek dosyası bırakılır; projenin
    kendi süreci 3 sn'de bir bakar ve normal kapanışı başlatır (çalışan ajan varsa
    kapanış onayı o pencerede sorulur).
  - **Arşivle:** Yalnızca kapalı proje; arşivdeki proje açılamaz.
  - **Durum:** Çalışma alanı kilidi (çalışıyor mu) + `fleet.json`, `tasks.json`,
    `onaylar.json`, `insan-kutusu.json` salt okunur: ajan, açık/engelli görev, size
    soru, onay, okunmamış, harcama.
  - Projeler sekmesi yalnızca Merkez'de görünür; proje pencerelerinin başlığında proje adı yazar.
