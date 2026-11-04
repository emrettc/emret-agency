'use strict';

/**
 * Ana süreçteki uyandırma bekçisi, kullanıcı yarım bir satır yazarken dürtmeyi
 * o satırın sonuna ekliyordu. Taslak varken bekçi beklemeli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { HumanDraftTracker, HUMAN_DRAFT_STALE_MS } = loadTs('src/main/humanDraft.ts');
const { WorkerWakeWatchdog } = loadTs('src/main/workerWake.ts');

test('yazılan metin taslak bırakır; Enter, Esc, Ctrl-C, Ctrl-U temizler', () => {
  const d = new HumanDraftTracker();
  d.note('p', 'HALA', 1000);
  assert.equal(d.has('p', 2000), true);
  d.note('p', '\r', 3000);
  assert.equal(d.has('p', 3000), false);
  for (const clear of ['\x1b', '\x03', '\x15']) {
    d.note('p', 'x', 4000);
    d.note('p', clear, 4001);
    assert.equal(d.has('p', 4002), false);
  }
});

test('ok tuşları taslak sayılmaz; yapıştırmanın satır sonu göndermez', () => {
  const d = new HumanDraftTracker();
  d.note('p', '\x1b[A', 1000);
  assert.equal(d.has('p', 1000), false);
  d.note('p', '\x1b[200~satır 1\rsatır 2\x1b[201~', 2000);
  assert.equal(d.has('p', 2000), true);
});

test('taslak süresi dolunca bekleme kalkar', () => {
  const d = new HumanDraftTracker();
  d.note('p', 'a', 0);
  assert.equal(d.has('p', HUMAN_DRAFT_STALE_MS - 1), true);
  assert.equal(d.has('p', HUMAN_DRAFT_STALE_MS), false);
});

test('bekçi taslak varken dürtmez, yoksa dürter', () => {
  const now = 10_000_000;
  const facts = {
    agentId: 'w', ptyId: 'p', lastOutputAt: now - 60_000, inboxIds: ['m1'],
    autoDeliveryPaused: false, paused: false, halted: false
  };
  const w = new WorkerWakeWatchdog();
  assert.equal(w.explain({ ...facts, humanDraft: true }, now), 'draft');
  assert.deepEqual(w.decide([{ ...facts, humanDraft: true }], now), []);
  assert.deepEqual(w.decide([facts], now), ['w']);
});
