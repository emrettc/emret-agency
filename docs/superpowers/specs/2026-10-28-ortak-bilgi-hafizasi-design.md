# Ortak bilgi hafızası + token tasarrufu (tasarım)

**Tarih:** 2026-10-28 · **Onay:** Emre (sohbette: "ikisi de", "tahmini olsun")

## Neden

Ajanlar (ve Emre'nin Claude Code oturumları) daha önce araştırılmış, konuşulmuş
işleri yeniden araştırıp token harcıyor. Ofiste MemPalace tabanlı ortak hafıza
var ama yalnız `memory.md` notlarını içeriyor, kullanımı isteğe bağlı ve
araştırma sonuçları sistematik kaydedilmiyor. Tasarruf da görünmüyor.

## Hedefler

1. Araştırma öncesi ortak bilgiye bakmak protokolde **zorunlu**; araştırma
   sonucu kaynaklarıyla **kaydedilir**.
2. Bilgi notları birbirine bağlanır (konu/etiket örtüşmesi → `ilgili` bağı),
   `bilgi graf` ile görülebilir (graphify benzeri, hafif).
3. Ofis token çubuğunun altında **tahmini token tasarrufu** görünür.
4. Aynı bilgi tabanı Emre'nin Claude Code oturumlarından da kullanılır.

## Hedef olmayanlar

- Mevcut kurumsal Knowledge Graph (`kg`, salt-okunur belge deposu) değişmez.
- Gerçek "tasarruf" ölçümü iddia edilmez — sayı her yerde **tahmini** yazılır.
- Yeni bağımlılık yok (MemPalace zaten kurulu; yoksa anahtar-kelime araması).

## Yapı

- `resources/bilgi.cjs` — bağımlılıksız ajan CLI'ı (kg.cjs / md-slack-reply.cjs
  kalıbı). Komutlar: `ara`, `kaydet`, `liste`, `goster`, `graf`.
  - Notlar: `<HIVE_ROOT>/bilgi/notlar/<slug>.md` (frontmatter: konu, ajan, tarih,
    etiketler, kaynaklar, maliyet_token, maliyet_kaynagi, ilgili).
  - Kullanım defteri: `<HIVE_ROOT>/bilgi/kullanim.jsonl` (ara / kaydet / isabet).
  - `ara`: notlarda anahtar-kelime puanlaması + MemPalace `bilgi` kanadında
    anlamsal arama; sonuçlar birleştirilir.
- **Maliyet:** `kaydet` anında ajanın son kayıttan (en fazla 6 saat) bu yana
  `cost-ledger.jsonl`'deki token artışı (input+output+cache_creation). Defter
  yoksa (OpenCode, Claude Code oturumu) not uzunluğundan alt tahmin (karakter/4).
- **Tasarruf:** `ara` sonucunda eşiği geçen her not için notun maliyeti
  tasarruf sayılır; aynı ajan + aynı not 24 saatte bir kez.
- MemoryManager `bilgi/notlar`'ı `bilgi` kanadına işler (mine döngüsü).
- Protokol + sistem istemi: `bilgi ara` önce, `bilgi kaydet` sonra.
- Main: `bilgi:ozet` IPC → Komuta Merkezi token çubuğunun altında satır.
- Claude Code: `~/.local/bin/bilgi.cmd` (HIVE_ROOT sabit) + global CLAUDE.md kuralı.

## Kararlarım (Claude'un)

- Anlamsal eşik cosine ≥ 0.35; anahtar-kelime eşiği: sorgu terimlerinin ≥ %50'si.
- Kendi notunu bulmak da tasarruf sayılır (yeniden araştırmadı).
- `ilgili` bağı: ortak etiket ya da ≥ 2 ortak başlık terimi.
