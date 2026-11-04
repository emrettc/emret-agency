'use strict';

/**
 * Yerel model öncelik sırası: sıra görevlisi bekleyenlerden listede üstte olanı
 * önce alır; arayüz yardımcıları (sıralama, taşıma, özet) ve nvidia-smi ayrıştırma.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { LocalModelGate } = loadTs('src/main/localGate.ts');
const { orderByPriority, moveItem, summarizeRecent, speedVerdict } = loadTs('src/shared/localPriority.ts');
const { parseNvidiaSmi, ollamaRoot } = loadTs('src/main/localPerf.ts');

const settled = async (p) => { let done = false; p.then(() => { done = true; }); await new Promise((r) => setImmediate(r)); return done; };

test('sıra görevlisi: bekleyenlerden öncelik listesinde üstte olan önce girer', async () => {
  let prio = ['c', 'b'];
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, priority: () => prio, idleReleaseMs: 1000, maxHoldMs: 60_000 });
  await g.acquire('a');
  const b = g.acquire('b');
  const d = g.acquire('d');
  const c = g.acquire('c');
  assert.deepEqual(g.status().waiting.map((w) => w.agentId), ['c', 'b', 'd'], 'durum da öncelik sırasıyla');
  const t0 = Date.now();
  g.sweep(t0 + 2000);                // a boşaldı → c (geç geldiği halde) girer
  assert.equal(await settled(c), true);
  assert.equal(await settled(b), false);
  prio = [];                         // öncelik kalkınca geliş sırası: b, sonra d
  g.sweep(t0 + 4000);
  assert.equal(await settled(b), true);
  assert.equal(await settled(d), false);
});

test('orderByPriority: kayıtlı sıra önce, yeniler sonda; kapalı ajanlar atlanır', () => {
  assert.deepEqual(orderByPriority(['a', 'b', 'c', 'd'], ['c', 'x', 'a']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderByPriority(['a'], []), ['a']);
  assert.deepEqual(orderByPriority(['a', 'b'], ['b', 'b']), ['b', 'a']);
});

test('moveItem: öğe taşınır, sınır dışı değişmez', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b'], 0, 5), ['a', 'b']);
});

test('summarizeRecent: yalnız başarılı istekler, saniye cinsinden ortalama', () => {
  const s = summarizeRecent([
    { waitMs: 1000, firstByteMs: 2000, totalMs: 10_000, status: 200 },
    { waitMs: 3000, firstByteMs: null, totalMs: 20_000, status: 200 },
    { waitMs: 0, firstByteMs: 1, totalMs: 1, status: 500 }
  ]);
  assert.deepEqual(s, { count: 2, avgFirstSec: 2, avgTotalSec: 15, avgWaitSec: 2 });
  assert.equal(summarizeRecent([]).avgTotalSec, null);
  assert.equal(speedVerdict(1500), 'fast');
  assert.equal(speedVerdict(500), 'ok');
  assert.equal(speedVerdict(120), 'slow');
});

test('parseNvidiaSmi ve ollamaRoot', () => {
  assert.deepEqual(parseNvidiaSmi('NVIDIA GeForce RTX 3080, 9765, 10240, 100\r\n'), { name: 'NVIDIA GeForce RTX 3080', usedMb: 9765, totalMb: 10240, utilPct: 100 });
  assert.equal(parseNvidiaSmi(''), null);
  assert.equal(parseNvidiaSmi('bozuk'), null);
  assert.equal(ollamaRoot('http://localhost:11434/v1'), 'http://localhost:11434');
  assert.equal(ollamaRoot('http://localhost:11434/'), 'http://localhost:11434');
});

test('yerel uç noktada OpenCode modelleri bağlam sınırını bilir; uzak uç noktada sınır yazılmaz', () => {
  const { opencodeProviders, LOCAL_CONTEXT_WINDOW } = loadTs('src/shared/byokEndpoints.ts');
  const out = opencodeProviders([
    { id: 'yerel', label: 'Yerel', baseUrl: 'http://localhost:11434/v1', models: ['m'] },
    { id: 'uzak', label: 'Uzak', baseUrl: 'https://api.example.com/v1', models: ['x'] }
  ], () => true);
  assert.deepEqual(out.yerel.models.m.limit, { context: LOCAL_CONTEXT_WINDOW, output: 8192 });
  assert.equal(out.uzak.models.x.limit, undefined);
});
