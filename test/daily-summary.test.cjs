'use strict';

/** Günlük özet (src/shared/dailySummary.ts): içerik ve zamanlama. */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const D = loadTs('src/shared/dailySummary.ts');

const base = {
  now: new Date(2026, 10, 3, 9, 0),
  approvals: [],
  inbox: [],
  reviewCount: 0,
  costNow: 10,
  costPrev: 4,
  isOpenAsk: (q) => !!q && q.open === true,
  nameOf: (id) => ({ reklam: 'Reklam', faruk: 'Faruk' }[id] ?? id)
};

test('dünden beri bitenler, takılanlar, seni bekleyenler ve harcama', () => {
  const out = D.buildDailySummary({
    ...base,
    tasks: [
      { id: 't1', title: 'Eski iş', status: 'done' },
      { id: 't2', title: 'Afiş', status: 'done', assignee: 'reklam' },
      { id: 't3', title: 'Logo', status: 'doing', assignee: 'faruk' },
      { id: 't4', title: 'Sözleşme', status: 'blocked' },
      { id: 't5', title: 'Soru', status: 'todo', humanQA: { open: true } }
    ],
    prevDoneIds: ['t1'],
    approvals: [{ id: 'a', title: 'Reklam bütçesi', from: 'reklam', status: 'bekliyor' }],
    reviewCount: 2
  });
  assert.match(out.title, /Günlük özet/);
  assert.match(out.body, /Seni bekleyen 4 şey var: 1 soru, 1 onay, 2 inceleme/);
  assert.match(out.body, /Dünden beri biten: 1\n  • Afiş — Reklam/);
  assert.match(out.body, /Logo — Faruk/);
  assert.match(out.body, /Takılan: 1/);
  assert.match(out.body, /Dünden beri harcama: \$6\.00 · toplam \$10\.00/);
  assert.deepEqual(out.doneIds, ['t1', 't2']);
});

test('ilk özet: yeni bitenleri sayamaz, toplamı söyler', () => {
  const out = D.buildDailySummary({ ...base, costPrev: null, tasks: [{ id: 'x', status: 'done' }], prevDoneIds: null });
  assert.match(out.body, /toplam 1 \(ilk özet/);
  assert.match(out.body, /Toplam harcama: \$10\.00/);
  assert.match(out.body, /Seni bekleyen bir şey yok/);
});

test('zamanlama: saat gelince ve bugün gönderilmediyse; -1 kapalı', () => {
  const nine = new Date(2026, 10, 3, 9, 5);
  const eight = new Date(2026, 10, 3, 8, 59);
  assert.equal(D.summaryDue(nine, 9, null), true);
  assert.equal(D.summaryDue(eight, 9, null), false);
  assert.equal(D.summaryDue(nine, 9, D.localDate(nine)), false, 'bugün zaten gönderildi');
  assert.equal(D.summaryDue(nine, 9, '2026-11-02'), true);
  assert.equal(D.summaryDue(nine, -1, null), false);
});
