'use strict';

/**
 * BANA SOR panosu boş kalıyordu: lider humanQA'yı tek nesne yazıyor ve
 * bloklamayan soruları `doing` kartta soruyordu. İkisi de artık açık soru.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { humanQAList, openHumanAsk, normalizeLedgerHumanQA } = loadTs('src/shared/humanQA.ts');

test('tek nesne humanQA diziye çevrilir', () => {
  assert.deepEqual(humanQAList({ q: 'soru?' }), [{ q: 'soru?' }]);
  assert.deepEqual(humanQAList([{ q: 'a' }, null, { x: 1 }]), [{ q: 'a' }]);
  assert.deepEqual(humanQAList(undefined), []);
  assert.deepEqual(humanQAList('metin'), []);
});

test('açık soru: en son yanıtsız ve kapatılmamış giriş', () => {
  assert.equal(openHumanAsk({ q: 'tek' }).q, 'tek');
  assert.equal(openHumanAsk([{ q: 'eski' }, { q: 'yeni' }]).q, 'yeni');
  assert.equal(openHumanAsk([{ q: 'x', a: 'tamam' }]), undefined);
  assert.equal(openHumanAsk([{ q: 'x', dismissedAt: '2026-10-29T00:00:00Z' }]), undefined);
});

test('ledger normalize: yalnız humanQA değişir, diğer alanlar korunur', () => {
  const ledger = { tasks: [
    { id: 'a', status: 'doing', repo: 'r', humanQA: { q: 'soru' } },
    { id: 'b', status: 'todo' }
  ] };
  const out = normalizeLedgerHumanQA(ledger);
  assert.deepEqual(out.tasks[0], { id: 'a', status: 'doing', repo: 'r', humanQA: [{ q: 'soru' }] });
  assert.equal(out.tasks[1], ledger.tasks[1]);
  const clean = { tasks: [{ id: 'c', humanQA: [] }] };
  assert.equal(normalizeLedgerHumanQA(clean), clean);
});
