'use strict';

/**
 * Yerel model sıra görevlisi (src/main/localGate.ts): aynı anda en çok N ajan,
 * giren ajan işi bitene kadar yerini tutar, sıradaki girer; istekler doğru uç
 * noktaya "Bearer ollama" ile aktarılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const loadTs = require('./load-ts.cjs');

const { LocalModelGate } = loadTs('src/main/localGate.ts');

const settled = async (p) => { let done = false; p.then(() => { done = true; }); await new Promise((r) => setImmediate(r)); return done; };

test('aynı anda en çok N ajan; yeri tutan ajan tekrar beklemez; işi biten yer bırakır', async () => {
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 2, idleReleaseMs: 30_000, maxHoldMs: 480_000 });
  assert.equal(await settled(g.acquire('a')), true);
  assert.equal(await settled(g.acquire('b')), true);
  const c = g.acquire('c');
  assert.equal(await settled(c), false, '3. ajan bekler');
  g.begin('a'); g.end('a');
  assert.equal(await settled(g.acquire('a')), true, 'a kendi yerini kullanır');

  const t0 = Date.now();
  g.sweep(t0 + 10_000);
  assert.equal(await settled(c), false, '30 sn dolmadan kimse çıkmaz');
  g.begin('b');                       // b çalışıyor
  g.sweep(t0 + 31_000);               // a 30 sn sustu → çıkar, c girer
  assert.equal(await settled(c), true);
  const st = g.status();
  assert.deepEqual(st.active.map((x) => x.agentId).sort(), ['b', 'c']);
  assert.equal(st.waiting.length, 0);
});

test('adalet: başkası bekliyorsa süresi dolan ajan (o an isteği yoksa) sırasını verir', async () => {
  const g = new LocalModelGate({ resolveTarget: () => null, concurrency: () => 1, idleReleaseMs: 30_000, maxHoldMs: 60_000 });
  await g.acquire('a');
  const b = g.acquire('b');
  const t0 = Date.now();
  g.begin('a');
  g.sweep(t0 + 90_000);
  assert.equal(await settled(b), false, 'isteği süren ajan kesilmez');
  g.end('a');
  // end lastDone'u şimdiye çeker; boşta değil ama süresi doldu ve b bekliyor
  g.sweep(Date.now() + 61_000);
  assert.equal(await settled(b), true);
});

test('HTTP: istek doğru uç noktaya Bearer ollama ile gider, 3. ajan sıraya girer, yanıt aynen döner', async (t) => {
  const seen = [];
  let holdA = null;
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      if (body === 'a-uzun') { holdA = () => res.end('A-bitti'); return; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(`yanıt:${body}`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const gate = new LocalModelGate({
    resolveTarget: (id) => (id === 'ollama-general' ? `http://127.0.0.1:${upPort}` : null),
    concurrency: () => 1, idleReleaseMs: 50, maxHoldMs: 60_000
  });
  const port = await gate.start(0);
  t.after(() => { gate.stop(); upstream.close(); });

  const post = (agent, body, path = '/e/ollama-general/v1/chat/completions') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { authorization: `Bearer gate-${agent}` } }, (res) => {
      let out = ''; res.on('data', (d) => { out += d; }); res.on('end', () => resolve({ status: res.statusCode, out, type: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end(body);
  });

  const a = post('reklam', 'a-uzun');
  await new Promise((r) => setTimeout(r, 50));
  const b = post('faruk', 'b');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen.map((s) => s.body), ['a-uzun'], 'faruk, reklam bitmeden modele ulaşmaz');
  assert.deepEqual(gate.status().waiting.map((w) => w.agentId), ['faruk']);
  holdA();
  assert.equal((await a).out, 'A-bitti');
  const rb = await b;
  assert.equal(rb.out, 'yanıt:b');
  assert.equal(rb.type, 'text/event-stream');
  assert.equal(seen[1].url, '/v1/chat/completions');
  assert.equal(seen[1].auth, 'Bearer ollama', 'ajan anahtarı Ollama\'ya gitmez');

  const unknown = await post('x', 'y', '/e/yok/v1/chat/completions');
  assert.equal(unknown.status, 404);
});
