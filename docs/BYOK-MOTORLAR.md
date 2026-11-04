# BYOK motorları: EVREN, NVIDIA ve Kimi

Emret Agency, ajanları Claude dışında adlandırılmış OpenAI-uyumlu uç noktalarla da çalıştırabilir.
Hazır üç uç nokta gelir. Hepsi aynı anda farklı ajanlarda kullanılabilir.

| Kimlik | Ad | OpenAI-uyumlu base-URL | Anthropic-uyumlu base-URL | Varsayılan model |
|---|---|---|---|---|
| `evren` | EVREN LLM Gateway | `https://evren-llmapi.ssyz.org.tr/v1` | `https://evren-llmapi.ssyz.org.tr` | `glm-5.3` |
| `nvidia` | NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | yok | `deepseek-ai/deepseek-v4.1-flash` |
| `kimi` | Moonshot Kimi | `https://api.moonshot.ai/v1` | `https://api.moonshot.ai/anthropic` | `kimi-k3` |
| `chatgpt` | OpenAI (ChatGPT) | `https://api.openai.com/v1` | yok | `gpt-6.1-sol` |

OpenAI notları ([fiyatlar](https://developers.openai.com/api/docs/pricing)): API token başına ücretlidir, ChatGPT aboneliğinin günlük limitleri API'de geçmez.
Anthropic teli olmadığından yalnız OpenCode ajanlarının yedeğidir ve varsayılan sırada en sondadır. Ucuz model: `gpt-6-luna`.
ChatGPT aboneliğinin limitlerini kullanmak için ajan **Codex** programıyla, ChatGPT hesabıyla giriş yapılarak çalıştırılır (API anahtarı gerekmez).

Önerilen diğer modeller: EVREN için `deepseek-v4.1-flash`, NVIDIA için `google/gemma-4-31b-it`, Kimi için `kimi-k3.1-pro`.

Kimi notları ([resmi kılavuz](https://platform.kimi.ai/docs/guide/claude-code-kimi)):
- Anthropic teli olduğu için Kimi, EVREN gibi **Claude Code ajanlarının da** yedeği olabilir.
- `kimi-k2.7-code` ön ayarda bilerek yok: düşünme modu zorunlu, Claude Code'da Thinking kapalıyken 400 döner.
- Çin içinden açılmış bir hesapta adreslerde `.ai` yerine `.cn` kullanılır.
- Ayarlar'da **Moonshot Kimi** kartı yoksa (eski kayıtlı ayar) ön ayar düğmesiyle tek tıkla eklenir; geçiş sırasına `kimi` yazılmalıdır.

## 1. Anahtarları girmek

1. **Ayarlar → Yapay Zekâ Motorları** sayfasını açın.
2. **BYOK UÇ NOKTALARI (YEDEK MOTORLAR)** bölümünde EVREN kartındaki parola alanına EVREN anahtarını yazıp **Kaydet**'e basın.
3. Aynısını NVIDIA kartı için NVIDIA anahtarıyla yapın.
4. Kart başlığında onay işareti görünür. Anahtar bir daha gösterilmez.

Anahtarlar Electron safeStorage ile şifreli saklanır ve yalnız ana süreç okur.
Repoya, config dosyasına ya da loglara yazılmaz.
OpenCode'a yalnız seçilen uç noktanın anahtarı `BYOK_EVREN_API_KEY` ya da `BYOK_NVIDIA_API_KEY` env'iyle verilir.

Base-URL ya da varsayılan model alanları gerekirse aynı kartta değiştirilebilir.
**UÇ NOKTA EKLE** ile başka OpenAI-uyumlu servisler de eklenebilir.

## 2. Bir ajanı EVREN ya da NVIDIA motoruna atamak

Aynı sayfadaki **AJAN BAŞINA MOTOR (PİN)** kutusuna her satıra bir atama yazın:

```
dev2 = evren/glm-5.3
arastirmaci = nvidia/google/gemma-4-31b-it
worker-ozet = evren
```

- Sol taraf ajan kimliğidir. Sağ taraf `uç-nokta/model` ya da yalnız uç nokta kimliğidir.
- Yalnız uç nokta yazılırsa o uç noktanın varsayılan modeli kullanılır.
- Kutudan çıkınca kaydedilir. Atama ajanın **bir sonraki başlatılışında** geçerli olur. Canlı ajan için Restart & Continue kullanın.

Motor türüne göre davranış:

- **OpenCode ajanı:** EVREN ve NVIDIA'nın ikisini de kullanabilir.
- **Claude Code ajanı:** yalnız Anthropic-uyumlu base-URL'i olan uç noktaya yönlendirilebilir. Hazır ayarda bu yalnız EVREN'dir.
- Claude Code ajanı NVIDIA'ya atanırsa ajan varsayılan Claude motoruyla başlar ve log'a uyarı düşer.
- EVREN'in Anthropic uyumluluğu cihazda gerçek anahtarla doğrulanmalıdır.

## 3. Yedek motor bayrağı

**YEDEK MOTOR** bölümü basit bir manuel anahtardır. Otomatik kota izleme yoktur.

1. **Kapsamdaki ağır ajanlar** alanına ajan kimliklerini, rolleri ya da `worker-*` gibi desenleri virgülle yazın.
2. Claude kotası düştüğünde, örneğin %20'nin altına indiğinde, **Yedek motor açık** kutusunu işaretleyin.
3. Kapsamdaki ajanlar bir sonraki başlatılışta **Yedek sırası**ndaki ilk uygun motorla başlar. Varsayılan sıra `evren, nvidia` şeklindedir.
4. Kota toparlanınca kutuyu kaldırın. Ajanlar bir sonraki başlatılışta Claude'a döner.

`god` ve `developer` varsayılan olarak muaftır. Açık pin her zaman yedek motor bayrağından önce gelir.

## 3b. Otomatik geçiş

**Otomatik geçiş açık** kutusu işaretliyse ofis motorları kendisi izler:

- **Claude:** ajan terminalinde limit satırı görünürse ("Claude usage limit reached", "You've hit your limit", "You've used 95% of your … limit" (%95 ve üstü), `API Error: 429`) Claude, satırdaki sıfırlanma saatine kadar kapalı sayılır. Saat yoksa 1 saat (429 için 15 dk).
- **EVREN / NVIDIA:** OpenCode log'unda (`~/.local/share/opencode/log/opencode.log`) `stream error` görünürse uç nokta kapalı sayılır. Zaman aşımı ve 429 için 15 dk, kredi/kota bitmesi ve geçersiz anahtar için 6 saat, 5xx için 5 dk.
- Kapalı motordaki ajanlar **hemen** yeden sıradaki ilk sağlıklı motorla yeniden başlar: Claude ajanı EVREN'e, NVIDIA ajanı EVREN'e, EVREN ajanı NVIDIA'ya geçer. Claude ajanı konuşmasını sürdürür (`--resume`). OpenCode ajanı hive protokolüyle yeni oturum açar.
- Süre dolunca ajan **en az 1 dk boştaysa** asıl motoruna döner. Aynı ajan 2 dakikadan sık yeniden başlatılmaz.
- **Claude Code ajanı EVREN/Kimi üzerindeyken** (Anthropic teli) terminaldeki son `API Error …` ya da `Invalid API key` satırı o uç noktayı kapatır; Claude Code'un kendi "Retrying…" denemeleri sayılmaz. Böylece yedeğe geçen ajan yedek de bozulunca orada takılı kalmaz.
- Yedek sırası bitince, sıraya yazılmamış ama etkin ve anahtarlı uç noktalar son çare olarak denenir.
- Sağlıklı yedek yoksa ajan asıl motorunda kalır.

### Motor uyarıları

Bir motor kapandığında 📬 Gelen Kutusu'na **"⚠️ <motor> motoru çalışmıyor"** mesajı düşer; masaüstü bildirimi ve (ayarlıysa) Slack DM olarak da gelir.
Mesaj ne yapılacağını söyler: geçersiz anahtar → anahtarı yenile, kredi bitti → bakiye yükle, limit → hangi saate kadar yedekte, geçici sorun → kaç dakika sonra yeniden denenecek.
Aynı kesinti için tek uyarı gider. Ayrıca açılışta, yedek sırasında olup anahtarı girilmemiş motorlar bir kez listelenir.

### Genel Müdür'ün motor yetkisi

Ofisin algılayamadığı bir takılmada (sessizce cevap vermeyen motor, kredi bitti ama hata satırı yok) Genel Müdür motoru kendisi kapatır.
Bunun için `hive/motor-komut/<ad>.json` dosyasını yazar:

```json
{ "motor": "evren", "durum": "kapali", "dakika": 60, "neden": "yanıt yok" }
{ "motor": "evren", "durum": "acik" }
```

O motordaki ajanlar ~15 sn içinde sıradaki sağlıklı motora taşınır. İşlenen komut `motor-komut/.done/` altına taşınır ve `log.jsonl`'a `engine-command` olarak yazılır.
Bu yetki Genel Müdür'ün talimatında yazılıdır. Motor durumunu `hive/motor-durumu.json` dosyasından okur.
- Kapsam ve muaf listeleri bu modda da geçerlidir. Herkes için `*` yazın, muaf listesini boş bırakın.
- OpenCode'un yanıt başlığı bekleme süresi bu uç noktalar için 90 sn'ye indirildi. Varsayılan 5 dk'dır.
- Olaylar `hive/log.jsonl` dosyasına `engine-down`, `engine-up` ve `engine-switch` olarak yazılır. Kapalı motorlar Ayarlar'da da görünür.

## 4. Deploy adımları

1. Branch'i canlı dala entegre edip uygulamayı yeniden başlatın. `log.jsonl` içinde yeni bir `app-start` olayı görünmelidir.
2. Ayarlar'dan EVREN ve NVIDIA anahtarlarını girin.
3. Bir OpenCode ajanını `evren` ile, birini `nvidia` ile pinleyip yeniden başlatın.
4. Konsol log'unda `[byok] <ajan> → evren/glm-5.3 (pin)` satırını ve ajanın yanıt verdiğini doğrulayın.

## 5. Test

```
node --test test/byok-endpoints.test.cjs
```

Canlı duman testi yalnız `EVREN_TEST_KEY` ve `NVIDIA_TEST_KEY` env değişkenleri tanımlıysa koşar. Tanımlı değilse atlanır.
Bu değişkenleri yalnız kendi kabuğunuzda tanımlayın. Hiçbir dosyaya yazmayın.
