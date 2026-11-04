<p align="right"><b>🇹🇷 Türkçe</b> | <a href="README.en.md"><b>🇬🇧 English</b></a></p>

<p><img src="docs/img/logo-yazi.svg" alt="Emret Agency" width="368"></p>

# Emret Agency

**Kendi bilgisayarında çalışan bir yapay zekâ ajan ofisi.** Genel Müdür işi dağıtır,
işçi ajanlar piksel ofiste masalarında çalışır; mümkün olan her iş senin ekran
kartındaki yerel modelle, token ücreti ödemeden yapılır.

![Emret Agency piksel ofisi](docs/img/ofis.svg)

[Kurulum ve kullanım kılavuzu](docs/KURULUM.md) ·
[Ollama Yerel Model Rehberi](docs/OLLAMA-KURULUM.md) ·
[Tanıtım sitesi](https://emret-agency.github.io/emret-agency/) ·
[Bağış yap](#destek)

## Neler var

- **Çoklu ajan** — Claude Code, OpenCode, Codex, Crush, pi ve diğer CLI ajanları aynı ofiste.
  Genel Müdür görevleri böler, işçiler yapar, birbirine mesaj atar.
- **Önce yerel model** — llama-server ya da Ollama ile ekran kartında. Yerel yetmezse
  önce ücretsiz, en son ücretli API; API kalmazsa yerelden devam.
- **Ajan belleği** — sıra başka ajana geçince ajanın okuduğu her şey diske kaydedilir;
  51 bin tokenlık bir konuşmaya dönüş 30 sn yerine ~2 sn.
- **Kota koruması** — ücretli abonelikte işçiler %60'ta durur, %40 Genel Müdür'e kalır.
- **Devam noktası** — her ajanın kısa `devam.md` notu; yeniden başlayan ajan kaldığı yerden sürer.
- **Bana sor ve İnceleme** — ajanların soruları, onaylar ve birleştirilecek dallar tek yerde,
  menüde kırmızı rozetle.
- **Projeler, Telegram, temalar, ofis düzenleyici.**

![Motor sırası](docs/img/motor-sirasi.svg)

## Hızlı kurulum (Windows)

**Bilgisayarın iyiyse ücretsiz çalış:** ekran kartın yeterliyse (NVIDIA, 8 GB ve üstü)
önce [Ollama](https://ollama.com/download)'yı kur (`winget install Ollama.Ollama`).
Ajanlar yerel motorla, token ücreti olmadan çalışır. Ekran kartın yoksa Ollama'yı
atla ve `-Yerel` yazma; ajanlar bağladığın API motorlarıyla çalışır.

```bash
git clone https://github.com/emret-agency/emret-agency.git
cd emret-agency
kurulum.cmd -Yerel
baslat.cmd
```

`kurulum.cmd` eksik araçları (Node.js 20+, Python 3.12, C++ derleme araçları, Ollama)
denetler ve nasıl kurulacağını söyler, sonra paketleri kurar. `-Yerel` yerel modeli
(`emrettc-genel`, ~8 GB) de indirir. macOS / Linux ve ayrıntılar için
[kılavuz](docs/KURULUM.md).

## Geliştirme

```bash
npm run dev                    # geliştirme modu
npm run typecheck              # tip denetimi
node --test test/*.test.cjs    # testler
npm run dist:win               # Windows kurulum paketi
```

Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
Motorlar: [docs/BYOK-MOTORLAR.md](docs/BYOK-MOTORLAR.md) ·
Katkı: [CONTRIBUTING.md](CONTRIBUTING.md)

## Destek

Emret Agency ücretsiz ve açık kaynaktır. İşine yaradıysa geliştirmeyi destekleyebilirsin:

[![Bağış yap](https://img.shields.io/badge/Ba%C4%9F%C4%B1%C5%9F%20yap-Emret%20Agency-e5484d?style=for-the-badge)](https://donate.bynogame.com/emrettc)

## Lisans

Kaynak kod MIT lisanslıdır, bkz. [LICENSE](LICENSE); piksel çizimler için
[LICENSE-ASSETS](LICENSE-ASSETS).
