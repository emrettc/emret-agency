'use strict';

/**
 * Taşma (src/main/localGate.ts + src/shared/localSpill.ts): yerel sırada fazla
 * bekleyen işçinin isteği önce ücretsiz, sonra ücretli API'ye gider; hata veren
 * motor atlanır; hiçbiri olmazsa ajan yerel sırada bekler. Yönetici otomatik
 * geçişten her zaman muaftır (ücretli motorun %40'ı ona kalır).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const loadTs = require('./load-ts.cjs');

const { LocalModelGate, spillWireOf, spillUrl, spillShouldFailover } = loadTs('src/main/localGate.ts');
const { spillOrder, spillFailure } = loadTs('src/shared/localSpill.ts');
const B = loadTs('src/shared/byokEndpoints.ts');

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); });

function post(url, key, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'content-length': Buffer.byteLength(data) } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('spillOrder: önce ücretsiz, sonra ücretli; kapalıysa boş', () => {
  assert.deepEqual(spillOrder({ enabled: true, order: ['kimi', 'evren', 'chatgpt', 'evren'], free: ['evren', 'chatgpt'] }), ['evren', 'chatgpt', 'kimi']);
  assert.deepEqual(spillOrder({ enabled: false, order: ['evren'] }), []);
  assert.deepEqual(spillOrder(undefined), []);
});

test('spillWireOf / spillUrl / spillShouldFailover / spillFailure', () => {
  assert.equal(spillWireOf('/v1/chat/completions'), 'openai');
  assert.equal(spillWireOf('/v1/messages?beta=true'), 'anthropic');
  assert.equal(spillWireOf('/v1/models'), null);
  assert.equal(spillUrl({ base: 'https://e/v1/' }, 'openai', '/v1/chat/completions'), 'https://e/v1/chat/completions');
  assert.equal(spillUrl({ base: 'https://k/anthropic' }, 'anthropic', '/v1/messages?beta=true'), 'https://k/anthropic/v1/messages?beta=true');
  for (const s of [400, 401, 402, 429, 500, 503]) assert.equal(spillShouldFailover(s), true);
  for (const s of [200, 201]) assert.equal(spillShouldFailover(s), false);
  assert.equal(spillFailure(429, 'çok istek', 0).reason, 'rate');
  assert.equal(spillFailure(402, '', 0).untilMs, 6 * 3600_000);
  assert.equal(spillFailure(429, 'You have no credits remaining. Add credits', 0).reason, 'credits');
  assert.equal(spillFailure(429, 'Your account is suspended due to insufficient balance', 0).untilMs, 6 * 3600_000);
  assert.equal(spillFailure(429, 'Model şu an yoğun; en fazla 4 eşzamanlı istek', 0).untilMs, 60_000);
});

test('yerel sıra doluyken bekleyen ajan API\'ye taşar; ilk motor kotada ise ikinciye geçer', async (t) => {
  const local = await server(async (req, res) => { await readBody(req); res.end('yerel'); });
  const seen = [];
  const free = await server(async (req, res) => { seen.push(['free', JSON.parse(await readBody(req)).model, req.headers.authorization]); res.statusCode = 429; res.end('kota'); });
  const paid = await server(async (req, res) => { seen.push(['paid', JSON.parse(await readBody(req)).model, req.headers.authorization]); res.end('ücretli-yanıt'); });
  const failures = [];
  const g = new LocalModelGate({
    resolveTarget: () => local.url,
    concurrency: () => 1,
    spill: {
      afterMs: () => 50,
      targets: () => [{ id: 'evren', base: `${free.url}/v1`, model: 'gemma-4-31b', key: 'K1' }, { id: 'kimi', base: `${paid.url}/v1`, model: 'kimi-k3', key: 'K2' }],
      onFailure: (id, status) => failures.push([id, status])
    }
  });
  const port = await g.start();
  t.after(() => { g.stop(); local.s.close(); free.s.close(); paid.s.close(); });
  const base = `http://127.0.0.1:${port}/e/yerel/v1/chat/completions`;
  await g.acquire('a'); // a modelde (yer dolu)
  const r = await post(base, 'gate-b', { model: 'emrettc-genel', messages: [] });
  assert.equal(r.body, 'ücretli-yanıt');
  assert.deepEqual(seen, [['free', 'gemma-4-31b', 'Bearer K1'], ['paid', 'kimi-k3', 'Bearer K2']]);
  assert.deepEqual(failures, [['evren', 429]]);
  const st = g.status();
  assert.deepEqual(st.spilled.map((x) => [x.agentId, x.engine]), [['b', 'kimi']]);
  assert.equal(st.recent.at(-1).engine, 'kimi');
  assert.equal(st.waiting.length, 0, 'taşan ajan yerel sıradan çıktı');
});

test('API yoksa ajan yerelden devam eder', async (t) => {
  const local = await server(async (req, res) => { await readBody(req); res.end('yerel'); });
  const g = new LocalModelGate({ resolveTarget: () => local.url, concurrency: () => 1, idleReleaseMs: 10, spill: { afterMs: () => 30, targets: () => [] } });
  const port = await g.start();
  t.after(() => { g.stop(); local.s.close(); });
  await g.acquire('a');
  const p = post(`http://127.0.0.1:${port}/e/yerel/v1/chat/completions`, 'gate-b', { model: 'm', messages: [] });
  setTimeout(() => g.sweep(Date.now() + 1000), 120); // a'nın yeri boşalır
  assert.equal((await p).body, 'yerel');
});

test('yönetici otomatik geçişten her zaman muaf; işçi Claude azalınca yerel motora döner', () => {
  const eps = B.normalizeEndpoints([
    { id: 'ollama-general', label: 'Y', baseUrl: 'http://127.0.0.1:8090/v1', anthropicBaseUrl: 'http://127.0.0.1:8090', defaultModel: 'emrettc-genel' },
    { id: 'evren', label: 'E', baseUrl: 'https://evren/v1', anthropicBaseUrl: 'https://evren', defaultModel: 'gemma-4-31b' }
  ]);
  const failover = B.normalizeQuotaFailover({ enabled: false, auto: true, agents: ['*'], exempt: [], fallbackOrder: ['ollama-general', 'evren'] });
  const run = (agent) => B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: eps, pins: {}, failover, hasKey: () => true, isDown: (id) => id === 'claude' });
  assert.equal(run({ id: 'god', isGod: true }), null, 'yönetici Claude\'da kalır');
  assert.equal(run({ id: 'reklam' }).endpoint.id, 'ollama-general', 'işçi önce yerele');
});

test('istem yerel bağlama sığmazsa beklemeden API\'ye gider; API yoksa hata ajana döner', async (t) => {
  const { isContextOverflow } = loadTs('src/main/localGate.ts');
  assert.equal(isContextOverflow('{"error":{"message":"request (173275 tokens) exceeds the available context size (65536 tokens)"}}'), true);
  assert.equal(isContextOverflow('{"error":"bad json"}'), false);
  const local = await server(async (req, res) => { await readBody(req); res.statusCode = 400; res.end('{"error":{"message":"request (99999 tokens) exceeds the available context size (65536 tokens)"}}'); });
  const api = await server(async (req, res) => { await readBody(req); res.end('api-yanıt'); });
  let targets = [{ id: 'evren', base: `${api.url}/v1`, model: 'gemma-4-31b', key: 'K' }];
  const g = new LocalModelGate({ resolveTarget: () => local.url, concurrency: () => 1, spill: { afterMs: () => 60_000, targets: () => targets } });
  const port = await g.start();
  t.after(() => { g.stop(); local.s.close(); api.s.close(); });
  const url = `http://127.0.0.1:${port}/e/yerel/v1/messages`;
  const r = await post(url, 'gate-a', { model: 'm', messages: [] });
  assert.equal(r.body, 'api-yanıt');
  targets = [];
  const r2 = await post(url, 'gate-a', { model: 'm', messages: [] });
  assert.equal(r2.status, 400);
  assert.match(r2.body, /exceeds the available context size/);
});

test('günlük sayaçlar: yerel istek ve taşma sayılır', async (t) => {
  const local = await server(async (req, res) => { await readBody(req); res.end('yerel'); });
  const api = await server(async (req, res) => { await readBody(req); res.end('api'); });
  const g = new LocalModelGate({ resolveTarget: () => local.url, concurrency: () => 1, spill: { afterMs: () => 40, targets: () => [{ id: 'evren', base: `${api.url}/v1`, model: 'm', key: 'K' }] } });
  const port = await g.start();
  t.after(() => { g.stop(); local.s.close(); api.s.close(); });
  const url = `http://127.0.0.1:${port}/e/yerel/v1/chat/completions`;
  assert.equal((await post(url, 'gate-a', { model: 'm', messages: [] })).body, 'yerel');
  assert.equal((await post(url, 'gate-b', { model: 'm', messages: [] })).body, 'api', 'a yerde, b taşar');
  const days = Object.values(g.dailyAll());
  assert.equal(days.length, 1);
  assert.equal(days[0].requests, 1);
  assert.deepEqual(days[0].spills, { evren: 1 });
  g.seedDaily({ '2000-01-01': { requests: 5, errors: 0, totalMs: 0, waitMs: 0, spills: {}, overflow: 0, restores: 0 } });
  assert.equal(Object.keys(g.dailyAll()).length, 2, 'diskten gelen eski gün eklenir, bugünkü korunur');
});
