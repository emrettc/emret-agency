<p><img src="img/logo-yazi.svg" alt="Emret Agency" width="368"></p>

# Ollama ile Yerel Yapay Zekâ Motoru Kurulum Kılavuzu

Emret Agency, işçi ajanların (Developer, Tasarım, Reklam, Araştırma vb.) tüm görevlerini **kendi bilgisayarında, ekran kartında çalışan yerel yapay zekâ modeliyle** yürütmek üzere tasarlanmıştır.

Bu sayede:
- **Token ücreti ödemezsiniz:** Gece gündüz binlerce satır kod yazsa bile faturanız sıfır kalır.
- **API anahtarı gerekmez:** Harici servislere kart bağlamadan sıfırdan çalışabilirsiniz.
- **Gizlilik:** Kodlarınız ve verileriniz bilgisayarınızdan dışarı çıkmaz.
- **Akıllı taşma:** Yerel modelin bağlamı yetmezse veya sırada uzun beklenirse isteğe bağlı olarak ücretsiz/ücretli API'lere taşabilir.

---

## 1. Donanım ve Model Seçim Tablosu

Yerel model doğrudan ekran kartınızın belleğinde (VRAM) çalışır. Sisteminizdeki ekran kartına göre en uygun modeli seçin:

| Ekran Kartı (NVIDIA VRAM) | Model | Taban Model | Boyut | Kullanım Amacı |
|---|---|---|---|---|
| **Yok / 6 GB altı** | — | — | — | Yerel model önerilmez; API motorları kullanılmalıdır. |
| **8 GB** | `emrettc-hafif` | `qwen3.5:4b` | ~3 GB | Hızlı yanıtlar, basit dosya düzenlemeleri, özetler. |
| **10 – 16 GB** | `emrettc-genel` | `gemma4:12b` | ~8 GB | **(Önerilen)** Günlük tüm kodlama, test ve ofis işleri. |
| **24 GB ve üstü** (RTX 3090/4090) | `emrettc-kod` <br> `emrettc-analiz` | `qwen3-coder:30b` <br> `qwen3.5:27b` | ~18 GB <br> ~17 GB | Karmaşık mimari analizler, derin kod refactoring. |

> **RAM Önerisi:** En az 16 GB RAM (tercihen 32 GB) önerilir.

---

## 2. Ollama'yı Kurma

### Windows Kurulumu
1. **Komut satırı ile (Önerilen):**
   Terminali (PowerShell veya CMD) açıp şu komutu çalıştırın:
   ```bash
   winget install Ollama.Ollama
   ```
2. **Doğrudan indirici ile:**
   [ollama.com/download/windows](https://ollama.com/download/windows) adresinden `OllamaSetup.exe` dosyasını indirin ve kurun.

### macOS Kurulumu
```bash
brew install ollama
# veya https://ollama.com/download/mac adresinden indirin
```

### Linux Kurulumu
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Kurulum bittikten sonra bir terminalde `ollama --version` yazarak çalıştığını doğrulayın. Ayrıca tarayıcınızda `http://127.0.0.1:11434` adresine gittiğinizde **"Ollama is running"** mesajını görmelisiniz.

---

## 3. Tek Ekran Kartında Hızlandırma Ayarları (Kritik!)

Ollama varsayılan olarak birden çok modeli belleğe almaya çalışabilir veya arka planda modeli çabuk bellekten atabilir. Emret Agency'nin tek ekran kartından maksimum performans (hızlı token üretimi ve sıfır bekleme) alması için şu ortam değişkenleri tanımlanmalıdır:

### Windows'ta Otomatik Ayarlama (PowerShell):
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '-1', 'User')
```
*(Bu ayarlar projedeki `kurulum.cmd -Yerel` komutu çalıştırıldığında otomatik olarak da uygulanır.)*

> **Not:** Değişkenlerin etkin olması için sistem tepsisindeki (sağ altta) Ollama simgesine sağ tıklayıp **Quit Ollama** deyin ve Ollama'yı yeniden başlatın.

### Ayarların Anlamı:
- `OLLAMA_NUM_PARALLEL=1`: GPU gücünü tek bir ajana odaklayarak maksimum yanıt hızı sağlar.
- `OLLAMA_MAX_LOADED_MODELS=1`: VRAM'in bölünmesini ve aşırı bellek dolmasını engeller.
- `OLLAMA_FLASH_ATTENTION=1`: Desteklenen kartlarda işlem süresini ve bellek tüketimini ciddi oranda düşürür.
- `OLLAMA_KEEP_ALIVE=-1`: Modeli sürekli GPU belleğinde sıcak tutar, her istekte modelin baştan yüklenmesini önler.

---

## 4. Modelleri İndirme ve Oluşturma

Emret Agency, ham modeller yerine sistem talimatları ve bağlam boyutları optimize edilmiş özel Modelfile'lar kullanır (`resources/ollama/` dizininde yer alır).

### Yöntem A: Otomatik Kurulum Betiği ile (En Kolayı)

Proje ana klasöründeyken:
- **Yalnızca önerilen genel işçi modelini (`emrettc-genel`, ~8 GB) kurmak için:**
  ```bash
  kurulum.cmd -Yerel
  ```
- **Tüm modelleri (hafif, genel, kod, analiz modelleri, toplam ~40 GB) kurmak için:**
  ```bash
  kurulum.cmd -Yerel -TumModeller
  ```

---

### Yöntem B: Elle (Manuel) Komutlarla Kurulum

İstediğiniz modeli tek tek kendiniz çekip yapılandırabilirsiniz:

#### 1. Genel İşler Modeli (`emrettc-genel` - Gemma 4 12B, 64K Bağlam) - **Önerilen**:
```bash
ollama pull gemma4:12b
ollama create emrettc-genel -f resources/ollama/emrettc-genel.Modelfile
```

#### 2. Hafif İşler Modeli (`emrettc-hafif` - Qwen 3.5 4B, 32K Bağlam - 8 GB VRAM için):
```bash
ollama pull qwen3.5:4b
ollama create emrettc-hafif -f resources/ollama/emrettc-hafif.Modelfile
```

#### 3. Kod Odaklı Model (`emrettc-kod` - Qwen 3 Coder 30B - 24 GB VRAM için):
```bash
ollama pull qwen3-coder:30b
ollama create emrettc-kod -f resources/ollama/emrettc-kod.Modelfile
```

#### 4. Analiz Modeli (`emrettc-analiz` - Qwen 3.5 27B - 24 GB VRAM için):
```bash
ollama pull qwen3.5:27b
ollama create emrettc-analiz -f resources/ollama/emrettc-analiz.Modelfile
```

Yüklü modelleri listelemek için:
```bash
ollama list
```

---

## 5. Emret Agency İçerisinde Yerel Motoru Tanımlama

Modelleri oluşturduktan sonra uygulamaya tanıtmak çok basittir:

1. Uygulamayı başlatın: `baslat.cmd` (veya `npm run dev`).
2. Sol alt menüden veya üst bardan **Ayarlar › Yapay Zekâ Motorları** (veya *Motorlar*) sayfasına gidin.
3. **Uç Noktalar** altında **Ollama** motorunu kontrol edin (varsayılan adres: `http://127.0.0.1:11434/v1`).
4. **Bağlantıyı Test Et** butonuna tıklayın. Yeşil onay işareti çıkmalı ve oluşturduğunuz `emrettc-genel` modeli listede görünmelidir.
5. **Varsayılan işçi motoru** açılır kutusundan **Genel İşler** (`emrettc-genel`) veya oluşturduğunuz modeli seçin.
6. Artık açacağınız tüm işçi ajanlar (Developer, Tasarımcı vb.) doğrudan yerel motorunuzda çalışmaya başlar!

### Hız Testi (Benchmark):
Motorlar sayfasındaki **Hız Testi** butonuna tıklayarak donanımınızın istem okuma ve token üretme hızını ölçebilirsiniz. Sonuç "Hızlı / Orta / Yavaş" olarak raporlanır.

---

## 6. Gelişmiş: llama-server ile 10 Kat Hızlı Ajan Değişimi

Ollama yerine saf `llama-server` (llama.cpp) kullanarak **diske kaydedilen ajan belleği (slot cache)** özelliğinden yararlanabilirsiniz.

| İşlem | Standart Ollama | llama-server + Ajan Belleği |
|---|---|---|
| **Ajan değişince 51 bin tokenlık hafıza yükleme** | ~30 saniye (baştan okur) | **~2 saniye** (diskten anında yükler) |
| **İstem okuma hızı** | ~1100–1300 token/sn | **~1500–2100 token/sn** |
| **VRAM tüketimi** | 9,7 GB | 9,2 GB (q8 önbellek) |

### Nasıl Yapılır?
1. [llama.cpp GitHub Releases](https://github.com/ggml-org/llama.cpp/releases) sayfasından CUDA uyumlu Windows paketini indirin (`llama-...-bin-win-cuda-...-x64.zip`) ve bir klasöre çıkartın (örn: `C:\llama\bin\`).
2. Ollama'nın indirdiği GGUF model dosyasını `%USERPROFILE%\.ollama\models\blobs\` altından bulun.
3. `%APPDATA%\emrettc\config.json` dosyasını açıp şu bloğu ekleyin:
   ```json
   "localServer": {
     "enabled": true,
     "binPath": "C:/llama/bin/llama-server.exe",
     "modelPath": "C:/Users/<kullanici_adiniz>/.ollama/models/blobs/sha256-...",
     "alias": "emrettc-genel",
     "port": 8090,
     "ctx": 65536,
     "slotDir": "C:/ajans-bellek/yuvalar",
     "maxSlotGb": 60,
     "extraArgs": ["--temp", "1", "--top-k", "64", "--top-p", "0.95"]
   }
   ```
4. Motorlar sayfasında Genel İşler motorunun adresini `http://127.0.0.1:8090/v1` olarak güncelleyin. Emret Agency sunucuyu gerektiğinde kendisi başlatıp yönetecektir.

---

## 7. Sık Karşılaşılan Sorunlar ve Çözümleri

- **"Connection refused" veya "Ollama'ya bağlanılamadı"**:
  Ollama arka planda açık mı kontrol edin. Görev çubuğunda Ollama ikonu görünmüyorsa Başlat menüsünden `Ollama` uygulamasını çalıştırın.
- **"Request exceeds available context size"**:
  Konuşma geçmişi yerel modelin bağlam penceresini (64K) aşmış demektir. Ayarlar'da **API'ye Taşma** seçeneği açıksa istek otomatik olarak bağladığınız ücretsiz/ücretli API'ye taşınır; açık değilse ajanı yeni bir görevle temiz başlatabilirsiniz.
- **Model çok yavaş çalışıyor (CPU'ya taşıyor)**:
  Ekran kartı belleğiniz (VRAM) modele yetmediğinde modelin bir kısmı sistem belleğine (RAM) ve işlemciye (CPU) taşar. Ekran kartınız 8 GB ise `emrettc-genel` yerine `emrettc-hafif` modelini kullanın.
- **Monitör GPU VRAM'ini harcıyor**:
  Monitör kablonuzu anakartın dahili grafik birimine (iGPU) bağlayarak ana ekran kartınızda ~0,8 GB VRAM tasarrufu sağlayabilirsiniz.

