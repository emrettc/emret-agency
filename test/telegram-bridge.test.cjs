'use strict';

/**
 * Telegram köprüsü (src/main/telegram.ts): yalnız eşleştirilmiş sohbet dinlenir,
 * eşleştirme yalnız özel sohbetten /start ile olur, uzun mesaj kısaltılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { TelegramBridge } = loadTs('src/main/telegram.ts');

const msg = (chatId, text, type = 'private') => ({
  update_id: 1, message: { message_id: 7, text, chat: { id: chatId, type }, from: { first_name: 'Emre' } }
});

test('eşleşmemiş sohbetten gelen mesaj yok sayılır, eşleşmiş olan iletilir', () => {
  const got = [];
  const b = new TelegramBridge({ token: () => 't', chatId: () => '42', onMessage: (m) => got.push(m) });
  b.handle(msg(99, 'yabancı'));
  b.handle(msg(42, 'merhaba'));
  assert.equal(got.length, 1);
  assert.equal(got[0].text, 'merhaba');
  assert.equal(got[0].from, 'Emre');
  assert.equal(got[0].messageId, 7);
});

test('eşleştirme: yalnız özel sohbetten /start ile tamamlanır', async () => {
  const b = new TelegramBridge({ token: () => 't', chatId: () => undefined, onMessage: () => assert.fail('eşleşmeden ileti olmamalı') });
  b.start = () => {}; // gerçek yoklama yok
  const p = b.pair(5);
  b.handle(msg(5, '/start', 'group'));   // grup: sayılmaz
  b.handle(msg(5, 'merhaba'));           // /start değil: sayılmaz
  b.handle(msg(123, '/start'));
  assert.equal(await p, '123');
});

test('gönderim: eşleşme yoksa reddedilir, uzun metin kısaltılır', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: true, result: {} }) }; };
  try {
    const none = new TelegramBridge({ token: () => 't', chatId: () => undefined, onMessage: () => {} });
    assert.equal((await none.send('x')).ok, false);
    const b = new TelegramBridge({ token: () => 'TOKEN', chatId: () => '42', onMessage: () => {} });
    const r = await b.send('a'.repeat(5000), 7);
    assert.equal(r.ok, true);
    assert.match(calls[0].url, /\/botTOKEN\/sendMessage$/);
    assert.equal(calls[0].body.chat_id, '42');
    assert.ok(calls[0].body.text.length <= 3902);
    assert.equal(calls[0].body.reply_parameters.message_id, 7);
  } finally {
    global.fetch = realFetch;
  }
});
