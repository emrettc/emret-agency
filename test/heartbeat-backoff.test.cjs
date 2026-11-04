'use strict';

/** Kalp atışı boşta fren: sakin ve değişmeyen ofiste god'u giderek seyrek uyandır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const H = loadTs('src/shared/heartbeatBackoff.ts');

const MIN = 60_000;

test('ilk boş uyanış eskisi gibi (base × 2.5), sonra katlanır, tavan 60 dk', () => {
  const base = 2 * MIN;
  assert.equal(H.quietBackoffMs(base, 1), 5 * MIN);
  assert.equal(H.quietBackoffMs(base, 2), 10 * MIN);
  assert.equal(H.quietBackoffMs(base, 3), 20 * MIN);
  assert.equal(H.quietBackoffMs(base, 4), 40 * MIN);
  assert.equal(H.quietBackoffMs(base, 5), 60 * MIN);
  assert.equal(H.quietBackoffMs(base, 50), 60 * MIN);
  assert.equal(H.quietBackoffMs(base, 0), 5 * MIN);
});

test('base tavandan büyükse kullanıcının aralığı küçültülmez', () => {
  assert.equal(H.quietBackoffMs(60 * MIN, 3), 150 * MIN);
});

test('gerçek olay: ajan/insan mesajı ve görev değişikliği; sistem gürültüsü değil', () => {
  const sys = new Set(['heartbeat', 'scheduler', 'breaker', 'system']);
  assert.equal(H.isRealActivity({ kind: 'message', from: 'faruk-mvpttm6m' }, sys), true);
  assert.equal(H.isRealActivity({ kind: 'message', from: 'human' }, sys), true);
  assert.equal(H.isRealActivity({ kind: 'tasks', count: 3 }, sys), true);
  assert.equal(H.isRealActivity({ kind: 'message', from: 'heartbeat' }, sys), false);
  assert.equal(H.isRealActivity({ kind: 'engine-switch' }, sys), false);
  assert.equal(H.isRealActivity({ kind: 'spawn' }, sys), false);
  assert.equal(H.isRealActivity(null, sys), false);
});
