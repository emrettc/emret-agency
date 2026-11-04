'use strict';

/**
 * Hızlı yerel motor (src/main/localServer.ts) ve sıra görevlisinin ajan belleği:
 * ajan değişince önce eskisi kaydedilir, sonra yenisi geri yüklenir; aynı ajan
 * tekrar girince hiçbir şey yapılmaz; aynı anda >1 ajanda bellek kapalıdır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { LocalModelGate } = loadTs('src/main/localGate.ts');
const { slotFileName, filesToPrune, serverArgs } = loadTs('src/main/localServer.ts');

function fakeStore(saved = new Set()) {
  const calls = [];
  return {
    calls,
    async save(id) { calls.push(`kaydet:${id}`); saved.add(id); return true; },
    async restore(id) { calls.push(`yukle:${id}`); return saved.has(id); }
  };
}

test('ajan değişince önce eskisi kaydedilir, sonra yenisi geri yüklenir', async () => {
  const store = fakeStore();
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, slotStore: () => store });
  await g.switchTo('a');
  await g.switchTo('a');
  await g.switchTo('b');
  await g.switchTo('a');
  assert.deepEqual(store.calls, ['yukle:a', 'kaydet:a', 'yukle:b', 'kaydet:b', 'yukle:a']);
  assert.equal(g.status().slotOwner, 'a');
});

test('aynı anda iki istek: geçiş bir kez yapılır', async () => {
  const store = fakeStore();
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, slotStore: () => store });
  await g.switchTo('a');
  await Promise.all([g.switchTo('b'), g.switchTo('b')]);
  assert.deepEqual(store.calls, ['yukle:a', 'kaydet:a', 'yukle:b']);
});

test('aynı anda birden fazla ajan ya da depo yoksa bellek kullanılmaz', async () => {
  const store = fakeStore();
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 2, slotStore: () => store });
  await g.switchTo('a');
  await g.switchTo('b');
  assert.deepEqual(store.calls, []);
  const g2 = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, slotStore: () => null });
  await g2.switchTo('a');
  assert.equal(g2.status().slotOwner, null);
});

test('kaydetme hatası ajanı durdurmaz', async () => {
  const store = { async save() { throw new Error('disk dolu'); }, async restore() { return false; } };
  const logs = [];
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, slotStore: () => store, log: (m) => logs.push(m) });
  await g.switchTo('a');
  await g.switchTo('b');
  assert.equal(g.status().slotOwner, 'b');
  assert.ok(logs.some((m) => m.includes('kaydedilemedi')));
});

test('slotFileName, filesToPrune, serverArgs', () => {
  assert.equal(slotFileName('worker-ui'), 'worker-ui.bin');
  assert.equal(slotFileName('../x:y'), '___x_y.bin');
  const files = [
    { name: 'eski.bin', size: 4, mtime: 1 },
    { name: 'orta.bin', size: 4, mtime: 2 },
    { name: 'yeni.bin', size: 4, mtime: 3 }
  ];
  assert.deepEqual(filesToPrune(files, 8), ['eski.bin']);
  assert.deepEqual(filesToPrune(files, 4, 'eski.bin'), ['orta.bin', 'yeni.bin']);
  assert.deepEqual(filesToPrune(files, 100), []);
  const a = serverArgs({ enabled: true, binPath: 'x', modelPath: 'm.gguf', alias: 'genel', port: 8090, ctx: 65536, slotDir: 'D:/b', extraArgs: ['--temp', '1'] });
  assert.deepEqual(a.slice(0, 4), ['-m', 'm.gguf', '--alias', 'genel']);
  assert.ok(a.includes('--slot-save-path') && a.includes('D:/b') && a.includes('-np') && a.at(-1) === '1');
  assert.equal(a[a.indexOf('-ctk') + 1], 'q8_0', 'önbellek varsayılanı q8');
  const f16 = serverArgs({ enabled: true, binPath: 'x', modelPath: 'm', alias: 'g', port: 1, ctx: 2, slotDir: 'd', extraArgs: ['-ctk', 'f16'] });
  assert.equal(f16.filter((x) => x === '-ctk').length, 1, 'kullanıcının seçimi geçer');
});
