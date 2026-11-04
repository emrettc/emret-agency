# Emret Agency

> **TR:** Kendi bilgisayarınızda çalışan, ücretsiz yerel modeller ve API‑ler ile çoklu kodlama ajanlarından oluşan bir ofisi yönetin.  
> **EN:** Run a local office of multiple coding agents on your PC, with free local models and optional API integrations.

## 🔗 Live Demo
- **Landing page**: https://crewgamestudio.com/emretagency.html  
- **Setup guide (HTML)**: https://crewgamestudio.com/emretagency.html#kurulum  

## 📦 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/emrettc/emret-agency.git
cd emret-agency
```

### 2. Prerequisites (Windows)
| Tool | Install command |
|------|-----------------|
| Node.js LTS v20+ | `winget install OpenJS.NodeJS.LTS` |
| Git | `winget install Git.Git` |
| Python 3.12 | `winget install Python.Python.3.12` |
| VS Build Tools (C++) | `winget install Microsoft.VisualStudio.BuildTools` |
| Ollama (optional – local model) | `winget install Ollama.Ollama` |

> **Tip:** All of the above can be installed automatically by running `kurulum.cmd` (see step 4).

### 3. Install project dependencies
```bash
npm ci               # installs npm packages and builds native C++ modules
npm run postinstall   # Electron specific setup
```

### 4. Run the automatic installer
```bash
# Basic install – checks missing tools and installs them
kurulum.cmd

# Install local model (requires Ollama)
kurulum.cmd -Yerel

# Install all supported models (~40 GB download)
kurulum.cmd -Yerel -TumModeller
```

### 5. Start the application
```bash
baslat.cmd
```
The terminal window must stay open while the app runs.  
Open your browser at `http://localhost:3000` (or the port shown in the console).

### 6. Language switch
Top‑right **TR / EN** button toggles all UI strings, the setup guide and the README text.

---

## ⚙️ Settings (Ayarlar)  

1. **Ajanlar & Modeller** – `Ayarlar → Ajanlar ve Modeller → Motorlar` menüsünden:
   - **Varsayılan işçi motoru** – yeni ajanların hangi modeli kullanacağını belirler.
   - **Motor sırası** – *Yerel → Ücretsiz API → Ücretli API* olarak sürükle‑bırak.
2. **API Keys** – desteklenen hizmetler (OpenAI, Anthropic, Gemini, …) için **API‑key** girin.
3. **Ollama Model Files** – `resources/ollama/` içinde `.Modelfile`lar bulunur; `ollama create <model‑adi> -f <Modelfile>` ile yeni bir model tanımlanabilir.
4. **Kullanıcı‑Arayüzü** – `Ayarlar → Görünüm` menüsü renk teması, logoyu ve masaüstü pencere davranışlarını özelleştirir.

---

## 🤖 Agents (Ajanlar) – Nasıl Kullanılır?

| Agent | Görev tipi | Örnek komut |
|-------|------------|-------------|
| **Genel Müdür** | İş dağıtıcı, planlayıcı | `Komuta Merkezi → “Yeni bir React projesi oluştur”` |
| **Developer** | Kod üretimi, düzeltme | `Komuta Merkezi → “Bu fonksiyonu TypeScript’e çevir”` |
| **Designer** | Görsel öneri, UI tasarımı | `Komuta Merkezi → “Button için modern bir tasarım öner”` |
| **Researcher** | Döküman tarama, veri toplama | `Komuta Merkezi → “En son React 18 release notlarını özetle”` |
| **Chatbot** | Soru‑cevap, yardım | `Bana sor → “npm install komutu ne işe yarar?”` |

> **Talimat‑kısım**: Her ajan bir **“Görev”** alır, tamamlandığında **`Bana sor`** sekmesinde rapor verir. Ajanlar arasındaki mesajlaşma **lokal disk** üzerinden tutulur, bu da oturum kapatıp açılsa bile geçmişi korur.

---

## 🛠️ Commands Cheat‑Sheet

| Command | What it does |
|---------|--------------|
| `kurulum.cmd` | Bağımlılıkları kontrol eder, eksik paketleri kurar, native modülleri derler. |
| `kurulum.cmd -Yerel` | Ollama kurulumunu ve varsayılan yerel modeli (`emrettc‑genel`) ekler. |
| `kurulum.cmd -Yerel -TumModeller` | **Tüm** yerel modelleri (light, genel, kod, analiz) indirir (~40 GB). |
| `baslat.cmd` | Electron‑tabanlı UI’yı başlatır. |
| `npm run typecheck` | Proje tip kontrollerini çalıştırır (TypeScript). |
| `npm run lint` | Lint (ESLint) kurallarını uygular. |
| `npm run build` | Prod sürümü paketler (Electron‑builder). |
| `npm run dev` | Geliştirme modunda hot‑reload (vite). |

---

## 📡 API Entegrasyonu

1. **OpenAI** – `OPENAI_API_KEY` ortam değişkeni veya **Ayarlar → API Keys** bölümüne ekleyin.  
2. **Anthropic** – `ANTHROPIC_API_KEY` aynı şekilde.  
3. **Google Gemini** – `GEMINI_API_KEY`.  
4. **Ollama** – Yerel `ollama` daemon’ı otomatik olarak `localhost:11434` üzerinden erişilir; bir model **`ollama pull <model>`** ile indirilir ve `ollama create <isim> -f <Modelfile>` ile kaydedilir.  

**Engine‑order (Motor Sırası) örneği**
Bu sırada bir model yanıt veremezse bir sonraki servise otomatik geçilir.

---

## 🤝 Contributing

- Fork the repo, create a feature branch, submit a PR.  
- Run `npm run lint && npm run typecheck` before committing.  
- Update documentation (`docs/*.md`) and the bilingual translation dictionary (`src/renderer/i18n.js`) when adding UI strings.  

## 📄 License
MIT – see `LICENSE` file.

---

### 📌 README Güncellemesi İçin Öneri

1. **README.md**’nin en üstüne **TR / EN** başlık ekleyin (kullanıcılar dili seçebilsin).  
2. **Live Demo** ve **GitHub link** bölümlerini **görsel kart** (badge) ile süsleyin:  

   ```markdown
   [![GitHub stars](https://img.shields.io/github/stars/emrettc/emret-agency?style=flat)](https://github.com/emrettc/emret-agency/stargazers)
   [![License](https://img.shields.io/github/license/emrettc/emret-agency)](LICENSE)
