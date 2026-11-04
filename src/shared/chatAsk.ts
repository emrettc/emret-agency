/**
 * BANA SOR güvenlik ağı — Genel Müdür sohbette soru sorarsa panoya da düşsün.
 *
 * Talimat "insana Bana Sor'dan sor" diyor, ama kullanıcı lidere kendi
 * terminalinden yazınca lider cevabın sonuna doğal olarak soruyu ekliyor
 * ("…Onaylarsan Faruk'a ileteyim. Nasıl diyorsun?") ve soru panoda hiç
 * görünmüyordu (2026-10-29, iki kez). Lider turunu bitirince son cevabındaki
 * soru `SOHBET_CARD_ID` kartının humanQA'sına eklenir; Bana Sor'dan yanıtlanırsa
 * yanıt her zamanki yoldan lidere gider, kullanıcı sohbetten yanıtlarsa açık
 * sohbet soruları kendiliğinden kapanır.
 *
 * Saf: dosya/ağ yok, birim-test edilebilir.
 */

export const SOHBET_CARD_ID = 'sohbet-sorulari';
const MAX_ASK_CHARS = 900;
/** Soru satırı cevabın son bu kadar dolu satırı içinde olmalı — cevabın
 *  ortasındaki retorik soru ("Neden? Çünkü…") kullanıcıya sorulmuş sayılmaz. */
const TAIL_LINES = 12;

/** Satır sonundaki süsler (kalın, emoji, parantez) atılınca `?` ile bitiyor mu? */
function endsWithQuestion(line: string): boolean {
  // Süsler karışık sırada gelebilir ("**…?** 🤔"), o yüzden hepsi tek sınıfta.
  return line.trim().replace(/[*_`)\]\s\p{Extended_Pictographic}️‍]+$/u, '').endsWith('?');
}

/**
 * Cevap metninden kullanıcıya sorulan soruyu çıkar: son TAIL_LINES dolu satır
 * içindeki SON soru satırının paragrafı + (seçenek listesi gibi) sonrasındaki
 * satırlar. Kod blokları ve alıntılar (`>`) yok sayılır. Soru yoksa null.
 */
export function extractChatAsk(text: string): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const plain: boolean[] = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; plain.push(false); continue; }
    plain.push(!inFence && !/^\s*>/.test(l));
  }
  const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const tail = new Set(filled.slice(-TAIL_LINES));
  let q = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (tail.has(i) && plain[i] && endsWithQuestion(lines[i])) { q = i; break; }
  }
  if (q < 0) return null;
  // Sorudan sonra yalnız seçenek listesi gelebilir. Düz metin geliyorsa soru
  // cevaplanmıştır — lider kullanıcının sorusunu başlık yapıp altında yanıtlıyor
  // ("**Projeyi görebiliyor muyuz?** Evet, …"; canlı 2026-10-29).
  const after = lines.slice(q + 1).filter((l) => l.trim());
  if (!after.every((l) => /^\s*(?:[-*•+]|\d+[.)])\s/.test(l))) return null;
  // Aynı satırda sorudan sonra cevap da varsa (kalın başlık + metin) yine soru değil.
  if (/\?\**\s+\S/.test(lines[q].trim().replace(/\?[*_`)\]\s\p{Extended_Pictographic}️‍]*$/u, ''))) return null;
  let start = q;
  while (start > 0 && lines[start - 1].trim() && plain[start - 1]) start--;
  const ask = lines.slice(start).join('\n').trim();
  return ask.length > MAX_ASK_CHARS ? `${ask.slice(0, MAX_ASK_CHARS)}…` : ask;
}

type RawTask = Record<string, unknown>;
type QA = { q: string; a?: string; askedAt?: string; answeredAt?: string; dismissedAt?: string; kaynak?: string };

function qaOf(t: RawTask | undefined): QA[] {
  return Array.isArray(t?.humanQA) ? (t!.humanQA as QA[]).filter((e) => e && typeof e.q === 'string') : [];
}

/**
 * Soruyu sohbet kartına ekle. Kart yoksa yaratılır. Aynı soru (yanıtlanmış ya
 * da kapatılmış olsa bile) bir daha eklenmez. Değişiklik yoksa null döner.
 */
export function addChatAsk(tasks: RawTask[], ask: string, godId: string, nowIso: string): RawTask[] | null {
  const idx = tasks.findIndex((t) => t?.id === SOHBET_CARD_ID);
  const card = idx >= 0 ? tasks[idx] : undefined;
  const qa = qaOf(card);
  if (qa.some((e) => e.q === ask)) return null;
  const entry: QA = { q: ask, askedAt: nowIso, kaynak: 'sohbet' };
  const next: RawTask = card
    ? { ...card, status: 'doing', humanQA: [...qa, entry] }
    : {
        id: SOHBET_CARD_ID,
        title: 'Genel Müdür sohbetinde sorulanlar',
        description: 'Genel Müdür sohbette size bir şey sorduğunda soru buraya da düşer. Buradan yanıtlarsanız yanıt ona iletilir; sohbetten yanıtlarsanız soru kendiliğinden kapanır.',
        assignee: godId,
        status: 'doing',
        dependsOn: [],
        priority: 2,
        createdAt: nowIso,
        humanQA: [entry]
      };
  const out = tasks.slice();
  if (idx >= 0) out[idx] = next; else out.push(next);
  return out;
}

/** Kullanıcı sohbetten yazdı: açık sohbet sorularını kapat (yanıt uydurmadan). */
export function dismissChatAsks(tasks: RawTask[], nowIso: string): RawTask[] | null {
  const idx = tasks.findIndex((t) => t?.id === SOHBET_CARD_ID);
  if (idx < 0) return null;
  const qa = qaOf(tasks[idx]);
  if (!qa.some((e) => !e.a && !e.dismissedAt)) return null;
  const out = tasks.slice();
  out[idx] = { ...tasks[idx], humanQA: qa.map((e) => (!e.a && !e.dismissedAt ? { ...e, dismissedAt: nowIso } : e)) };
  return out;
}

/** Transcript JSONL satırlarından son asistan metnini al (son kullanıcı
 *  mesajından SONRA yazılmış olmalı; yoksa null). */
export function lastAssistantText(jsonlLines: string[]): { text: string; ts?: string } | null {
  for (let i = jsonlLines.length - 1; i >= 0; i--) {
    let e: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try { e = JSON.parse(jsonlLines[i]); } catch { continue; }
    const content = e?.message?.content;
    if (e?.type === 'user') {
      // Araç sonuçları da "user" tipinde gelir; gerçek kullanıcı mesajı metindir.
      const isToolResult = Array.isArray(content) && content.every((b) => (b as { type?: string })?.type === 'tool_result');
      if (!isToolResult) return null;
      continue;
    }
    if (e?.type !== 'assistant' || !Array.isArray(content)) continue;
    const text = content.filter((b) => (b as { type?: string })?.type === 'text').map((b) => (b as { text?: string }).text ?? '').join('\n').trim();
    if (text) return { text, ts: e.timestamp };
  }
  return null;
}
