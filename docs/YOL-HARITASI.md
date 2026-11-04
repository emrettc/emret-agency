# Yol Haritası — Türkçe, Çok Projeli Ajan Ofisi

Emret Agency kendi ihtiyaçlarımıza göre geliştiriliyor.
Çalışma dalı: `turkce-coklu-proje`.

## Hedefler

1. **Tamamen Türkçe**: arayüz, ajanların birbirleriyle ve kullanıcıyla iletişimi,
   görev panosu ve hafıza dosyaları.
2. **The Office teması yok**: karakter adları ve dizi göndermeleri kalkar; isimler
   ve roller kullanıcı tarafından düzenlenebilir.
3. **Birden fazla proje aynı anda**: her projenin kendi ekibi (ajanları, hafızası,
   görev panosu) olur ve projeler paralel çalışır.
4. **Yönetim hiyerarşisi**: en üstte tüm projeleri gören bir **Genel Müdür**, her
   projede o projenin ekibini yöneten bir **Proje Lideri**.

## Fazlar

### Faz 1 — Türkçe arayüz
- [x] `locales/tr.json` (1203 anahtar), Türkçe varsayılan dil, testler
- [x] Çince ve Arapça kaldırıldı; İngilizce yalnızca yedek dil
- [x] i18n kullanmayan bileşenlerdeki sabit İngilizce metinler (Ayarlar, Ajan Ekle/Düzenle,
  açılış sihirbazı, çıkış penceresi, IDE, Komuta Merkezi, ofis ekranı…)
- [x] Mola alanı sohbetleri (`cafeteriaLines.ts`) nötr Türkçe satırlarla değişti
- [x] Ana süreçteki (main) diyalog, bildirim ve menü metinleri
- [ ] Güncelleme arayüzü (`UpdateBadge`, `UpdateToast`, `UpdatesSection`, `shared/updateState.ts`)
  — güncelleyici kararıyla birlikte (Faz 2, aşağıya bakın)
- [ ] Küçük kalıntılar: `AiEnginesSettings` uç nokta ipuçları, `OfficeThemePicker` (tema
  kaldırılınca gidecek)

Not: Ajan prompt'larına giden metinler (şablon hedefleri vb.) i18n'e değil, doğrudan
Türkçe olarak koda yazılıyor.

### Faz 2 — Türkçe ajanlar ve düzenlenebilir kadro
- [x] Ajanlar Türkçe çalışıyor: her ajan prompt'unun başında dil kuralı (`LANGUAGE_LINE`,
  `src/main/hive.ts`). Prompt'un geri kalanı İngilizce kaldı: Windows'ta prompt cmd.exe
  argv'sinden geçebiliyor (ASCII güvenli) ve testler protokol metnini sabitliyor.
- [x] Hafıza sıkıştırma (`reflect.ts`) Türkçe yazıyor
- [x] Ajanlara giden mesajlar Türkçe: Bana Sor yanıtı, ek dosya listesi, görev tohumu
- [x] Kadro adları nötr Türkçe (Murat, Can, Elif…) + rol önerileri; iç görünüm
  kimlikleri (`michael`, `jim`…) değişmedi. Ad ve rol ajan bazında düzenlenebilir.
- [x] Varsayılan yönetici adı "Proje Lideri" (Faz 3'te her proje hive'ının lideri;
  Genel Müdür onların üstünde yeni bir katman olacak)
- [x] Uygulama adı: **Emret Agency** (pencere başlığı, metinler, kurulum adı; iç paket adı `emrettc` veri klasörü için korunuyor)
- [x] **Otomatik güncelleyiciyi kapat**: eski güncelleme kaynağının GitHub sürümlerini
  sorguluyor (ilk açılışta günlükte görüldü); açık kalırsa bizim build'imizin üzerine
  orijinali kurar. Kapatılacak ya da kendi sürüm kanalımıza yönlendirilecek.
- [x] Ofis teması seçicisi (`OfficeThemePicker`: Friends, Brooklyn 99…) kaldırılacak

### Faz 3 — Çok projeli mimari
Mevcut durum: "hive" (çalışma alanı) tek bir klasör ve süreç genelinde tekil
(`hive.ts`, `index.ts`). Hive değiştirmek uygulamayı yeniden başlatıyor; "New Floor"
pencereleri aynı hive'ı paylaşıyor.

- [ ] Tasarım: `docs/FAZ3-TASARIM.md` (taslak, onay bekliyor). Öneri: proje başına
  ayrı uygulama süreci + dosya tabanlı projeler arası posta.
- **Karar değişti (29 Ekim 2026, Emre):** projeler ayrı ofis/uygulama kopyası olarak
  AÇILMAYACAK. Tek ofis, ortak ekip; boştaki ajan başka projede çalışabilir. Ayrım
  etiketle: her görevin `proje` alanı (`hive/projeler.json` kimliği), her projenin
  kendi çalışma/belge klasörü; Projeler sekmesi proje başına ajanları, görevleri,
  soruları ve tahmini token harcamasını gösterir (`src/shared/officeProjects.ts`,
  `src/main/officeProjects.ts`). Aşağıdaki çok-kopyalı maddeler bu yüzden askıda;
  kodu (profiller, `projects.ts`) yerinde duruyor ama arayüzden kaldırıldı.
- [x] Projeler tek ofiste etiketle ayrılır (yukarıdaki karar)
- [ ] ~~Her proje kendi penceresinde/sekmesinde, kendi Proje Lideriyle~~ (askıda)
- [ ] Genel Müdür katmanı: projeler arası görev dağıtımı ve raporlama
- [ ] Proje oluşturma/kapama/arşivleme arayüzü

### Bekleyen fikirler (şimdilik yapılmayacak)
- **FreeLLMAPI** (github.com/tashfeenahmed/freellmapi) — 34 sağlayıcının ücretsiz
  kotalarını tek OpenAI uyumlu uç noktada toplar. Değerlendirme (27 Ekim 2026): ana iş
  için uygun değil (zayıf modeller, veri gizliliği, garanti yok). **Claude token/kullanım
  limitine sık takılmaya başlarsak** tek bir "ekonomik işçi" ajanla (OpenCode/özel motor)
  yalnızca hassas olmayan toplu işler için denenecek. `npx freellmapi setup-claude`
  çalıştırılmayacak (Claude Code'un modelini değiştirir).

## Uygulamayı başlatma

Masaüstündeki **Emret Agency** kısayoluna çift tıklayın (repo kökündeki `baslat.cmd`
dosyasını çalıştırır). Simge durumunda bir komut penceresi açılır; uygulama açık
kaldığı sürece o pencereyi kapatmayın. Alternatif: repo klasöründe `npm run dev`.

## Geliştirme ortamı (Windows)

Gerekenler:
- Python 3.12 (`npm_config_python` ile açıkça gösterin; 3.14 de kurulu olabilir)
- Visual Studio Build Tools 2022: "C++ ile masaüstü geliştirme" iş yükü **ve**
  "MSVC Spectre korumalı kitaplıklar" bileşeni (node-pty istiyor, MSB8040)

Kurulum:
```
npm ci --ignore-scripts                 # paketlerin kendi derlemesini atla (aşağıya bakın)
node node_modules/electron/install.js   # Electron ikili dosyasını indir
npm run postinstall                     # native modülleri Electron için derle
npm run dev
```

Tuzaklar:
- `npm ci` (script'lerle) başarısız olur: better-sqlite3 önce sistemdeki Node 24 için
  derlenmeye çalışır ve Node 24 ClangCL araç takımı ister. O derlemeye ihtiyaç yok;
  `electron-rebuild` modülleri Electron 32 için MSVC ile zaten derliyor.
- `NoDefaultCurrentDirectoryInExePath` ortam değişkeni tanımlıysa node-pty'nin winpty
  adımı (`GetCommitHash.bat`) bulunamaz. Derleme ve `npm run dev` için o komutta
  kaldırın (`env -u NoDefaultCurrentDirectoryInExePath ...`).
- Yalnızca typecheck/test için: `npm ci --ignore-scripts` → `npm run typecheck`.
- Testler: Windows'ta symlink ve Electron gerektiren ~18 test taban kodda da
  başarısız; yeni bir hata bu listenin dışında kalanlardır.
