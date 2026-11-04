'use strict';

/**
 * BANA SOR güvenlik ağı: Genel Müdür sohbette sorarsa soru panoya da düşer.
 * Canlı örnek (2026-10-29): "…Onaylarsan Faruk'a ileteyim. Nasıl diyorsun?"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const C = loadTs('src/shared/chatAsk.ts');

const REPLY = [
  'Baktım 👇',
  '## Ne gördüm',
  'Link bir **Firevibe UI prototip galerisi**.',
  '',
  'Neden önemli? Çünkü ekranlar MVP ile örtüşüyor.',
  '',
  'Sen "tasarım olarak kullanabilirsin" dediğin için ben **1. yolu** öneriyorum.',
  'Onaylarsan Faruk\'a "bu seti baz al" diye iletirim. Nasıl diyorsun?'
].join('\n');

test('son paragraftaki soru çıkarılır, ortadaki retorik soru değil', () => {
  const ask = C.extractChatAsk(REPLY);
  assert.match(ask, /^Sen "tasarım olarak/);
  assert.match(ask, /Nasıl diyorsun\?$/);
  assert.doesNotMatch(ask, /Neden önemli/);
});

test('soru yoksa, kod bloğunda ya da alıntıdaysa null', () => {
  assert.equal(C.extractChatAsk('Tamamlandı. Web localhost:3000 adresinde.'), null);
  assert.equal(C.extractChatAsk('Şunu çalıştırdım:\n```\nneden?\n```'), null);
  assert.equal(C.extractChatAsk('Kullanıcı dedi ki:\n> bu olur mu?'), null);
  assert.equal(C.extractChatAsk(''), null);
  // Lider kullanıcının sorusunu başlık yapıp altında yanıtlıyor (canlı yanlış alarm).
  assert.equal(C.extractChatAsk('**Projeyi görebiliyor muyuz?**\n**Evet, her şey yerinde:** repo sağlam.'), null);
  assert.equal(C.extractChatAsk('**Projeyi görebiliyor muyuz?** **Evet, her şey yerinde.**'), null);
});

test('süslü bitiş de soru sayılır; seçenek listesi soruyla gelir', () => {
  assert.ok(C.extractChatAsk('**Hangisini seçelim?** 🤔'));
  const ask = C.extractChatAsk('Özet hazır.\n\nHangi yolu seçelim?\n- A: hızlı\n- B: güvenli');
  assert.equal(ask, 'Hangi yolu seçelim?\n- A: hızlı\n- B: güvenli');
});

test('karta ekle: kart yoksa yaratılır, aynı soru ikinci kez eklenmez', () => {
  const now = '2026-10-29T10:00:00.000Z';
  const t1 = C.addChatAsk([{ id: 'x', title: 'X' }], 'Nasıl diyorsun?', 'god', now);
  const card = t1.find((t) => t.id === C.SOHBET_CARD_ID);
  assert.equal(card.status, 'doing');
  assert.equal(card.assignee, 'god');
  assert.deepEqual(card.humanQA, [{ q: 'Nasıl diyorsun?', askedAt: now, kaynak: 'sohbet' }]);
  assert.equal(C.addChatAsk(t1, 'Nasıl diyorsun?', 'god', now), null);
  const t2 = C.addChatAsk(t1, 'Başka?', 'god', now);
  assert.equal(t2.find((t) => t.id === C.SOHBET_CARD_ID).humanQA.length, 2);
  assert.equal(t2[0].id, 'x');
});

test('sohbetten yanıt: açık sohbet soruları kapanır, yanıtlananlar dokunulmaz', () => {
  const now = '2026-10-29T10:05:00.000Z';
  const tasks = [{ id: C.SOHBET_CARD_ID, humanQA: [{ q: 'a?', a: 'evet' }, { q: 'b?' }] }];
  const out = C.dismissChatAsks(tasks, now);
  assert.deepEqual(out[0].humanQA, [{ q: 'a?', a: 'evet' }, { q: 'b?', dismissedAt: now }]);
  assert.equal(C.dismissChatAsks(out, now), null);
  assert.equal(C.dismissChatAsks([{ id: 'x' }], now), null);
});

test('transcript: son asistan metni, araç sonuçları atlanır, kullanıcı mesajından sonrası', () => {
  const L = (o) => JSON.stringify(o);
  const lines = [
    L({ type: 'user', message: { content: 'web hazır mı?' } }),
    L({ type: 'assistant', timestamp: 't1', message: { content: [{ type: 'text', text: 'Bakıyorum' }, { type: 'tool_use', name: 'Bash' }] } }),
    L({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    L({ type: 'assistant', timestamp: 't2', message: { content: [{ type: 'text', text: 'Hazır. Açayım mı?' }] } })
  ];
  assert.deepEqual(C.lastAssistantText(lines), { text: 'Hazır. Açayım mı?', ts: 't2' });
  assert.equal(C.lastAssistantText([...lines, L({ type: 'user', message: { content: 'aç' } })]), null);
});
