'use strict';

/**
 * Çoklu BYOK motorları (EVREN, NVIDIA, …): adlandırılmış OpenAI-uyumlu uç
 * noktalar, ajan başına pin ve basit yedek motor bayrağı. Saf çekirdek
 * (src/shared/byokEndpoints.ts) burada sabitlenir. Gerçek anahtar KULLANILMAZ;
 * canlı duman testi yalnız EVREN_TEST_KEY / NVIDIA_TEST_KEY env'i varsa koşar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const B = loadTs('src/shared/byokEndpoints.ts');
const EPS = B.normalizeEndpoints(B.DEFAULT_BYOK_ENDPOINTS);
const FAKE = 'test-placeholder-not-a-key';
const allKeys = () => true;
const noKeys = () => false;

test('ön ayarlar: EVREN, NVIDIA ve Kimi ayrı adlandırılmış uç noktalar, anahtarsız', () => {
  assert.deepEqual(EPS.map((e) => e.id), ['evren', 'nvidia', 'kimi', 'chatgpt']);
  const chatgpt = EPS.find((e) => e.id === 'chatgpt');
  assert.equal(chatgpt.baseUrl, 'https://api.openai.com/v1');
  assert.equal(chatgpt.anthropicBaseUrl, undefined); // Claude Code ajanlarının yedeği olamaz
  const evren = EPS.find((e) => e.id === 'evren');
  const nvidia = EPS.find((e) => e.id === 'nvidia');
  const kimi = EPS.find((e) => e.id === 'kimi');
  assert.equal(kimi.baseUrl, 'https://api.moonshot.ai/v1');
  assert.equal(kimi.anthropicBaseUrl, 'https://api.moonshot.ai/anthropic');
  assert.equal(kimi.defaultModel, 'kimi-k3');
  // Düşünme modu zorunlu model ön ayarda olmamalı (Thinking kapalıyken 400).
  assert.equal(kimi.models.includes('kimi-k2.7-code'), false);
  assert.equal(evren.baseUrl, 'https://evren-llmapi.ssyz.org.tr/v1');
  assert.equal(nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.ok(evren.models.includes('glm-5.3') && evren.models.includes('deepseek-v4.1-flash'));
  assert.ok(nvidia.models.includes('deepseek-ai/deepseek-v4.1-flash') && nvidia.models.includes('google/gemma-4-31b-it'));
  for (const e of B.DEFAULT_BYOK_ENDPOINTS) assert.equal(/key|token/i.test(JSON.stringify(e)), false);
});

test('normalizeEndpoints: geçersiz id/URL ve yinelenenler düşer, sondaki / kırpılır', () => {
  const out = B.normalizeEndpoints([
    { id: 'evren', baseUrl: 'https://a.example/v1/' },
    { id: 'evren', baseUrl: 'https://dup.example/v1' },
    { id: 'openai', baseUrl: 'https://x.example/v1' },
    { id: 'Bad Id', baseUrl: 'https://x.example/v1' },
    { id: 'nourl' },
    { id: 'ftp', baseUrl: 'ftp://x.example' },
    'çöp'
  ]);
  assert.deepEqual(out.map((e) => [e.id, e.baseUrl]), [['evren', 'https://a.example/v1']]);
  assert.deepEqual(B.normalizeEndpoints(null), []);
});

test('normalizeQuotaFailover: varsayılan KAPALI, god+developer muaf, kota alanı yok', () => {
  const d = B.normalizeQuotaFailover(undefined);
  assert.equal(d.enabled, false);
  assert.deepEqual(d.exempt, ['god', 'developer']);
  assert.deepEqual(d.fallbackOrder, ['evren', 'kimi', 'nvidia', 'chatgpt']);
  assert.equal('thresholdPct' in d, false);
  const c = B.normalizeQuotaFailover({ enabled: true, agents: ['worker-*'], fallbackOrder: ['nvidia', 'BAD ID'] });
  assert.equal(c.enabled, true);
  assert.deepEqual(c.fallbackOrder, ['nvidia']);
});

test('pin: iki ajan aynı anda EVREN ve NVIDIA motorlarına ayrı ayrı atanabilir', () => {
  const failover = B.normalizeQuotaFailover(undefined);
  const pins = { a1: { endpointId: 'evren' }, a2: { endpointId: 'nvidia', model: 'google/gemma-4-31b-it' } };
  const r1 = B.resolveAgentEngine({ agent: { id: 'a1' }, wire: 'openai', endpoints: EPS, pins, failover, hasKey: allKeys });
  const r2 = B.resolveAgentEngine({ agent: { id: 'a2' }, wire: 'openai', endpoints: EPS, pins, failover, hasKey: allKeys });
  assert.deepEqual([r1.endpoint.id, r1.model, r1.source], ['evren', 'glm-5.3', 'pin']);
  assert.deepEqual([r2.endpoint.id, r2.model], ['nvidia', 'google/gemma-4-31b-it']);
  assert.equal(B.resolveAgentEngine({ agent: { id: 'a3' }, wire: 'openai', endpoints: EPS, pins, failover, hasKey: allKeys }), null);
});

test('pin: anahtar yoksa ya da tel desteklenmiyorsa varsayılana düşer', () => {
  const failover = B.normalizeQuotaFailover(undefined);
  const pins = { a1: { endpointId: 'nvidia' } };
  assert.equal(B.resolveAgentEngine({ agent: { id: 'a1' }, wire: 'openai', endpoints: EPS, pins, failover, hasKey: noKeys }), null);
  // NVIDIA'nın Anthropic base-URL'i yok: Claude Code ajanı NVIDIA'ya yönlendirilemez.
  assert.equal(B.resolveAgentEngine({ agent: { id: 'a1' }, wire: 'anthropic', endpoints: EPS, pins, failover, hasKey: allKeys }), null);
  const ev = B.resolveAgentEngine({ agent: { id: 'a1' }, wire: 'anthropic', endpoints: EPS, pins: { a1: { endpointId: 'evren' } }, failover, hasKey: allKeys });
  assert.equal(ev.endpoint.id, 'evren');
});

test('yedek motor bayrağı: yalnız açıkken ve kapsamdaki muaf olmayan ajana uygulanır', () => {
  const off = B.normalizeQuotaFailover({ enabled: false, agents: ['worker-*'] });
  const on = B.normalizeQuotaFailover({ enabled: true, agents: ['worker-*', 'g', 'dev-1'], fallbackOrder: ['evren', 'nvidia'] });
  const w = { id: 'worker-x' };
  assert.equal(B.resolveAgentEngine({ agent: w, wire: 'openai', endpoints: EPS, failover: off, hasKey: allKeys }), null);
  const r = B.resolveAgentEngine({ agent: w, wire: 'openai', endpoints: EPS, failover: on, hasKey: allKeys });
  assert.deepEqual([r.endpoint.id, r.source], ['evren', 'failover']);
  // EVREN anahtarı yoksa sıradaki NVIDIA.
  const r2 = B.resolveAgentEngine({ agent: w, wire: 'openai', endpoints: EPS, failover: on, hasKey: (id) => id === 'nvidia' });
  assert.equal(r2.endpoint.id, 'nvidia');
  // god ve developer kapsam listesinde olsalar bile muaf.
  assert.equal(B.resolveAgentEngine({ agent: { id: 'g', isGod: true }, wire: 'openai', endpoints: EPS, failover: on, hasKey: allKeys }), null);
  assert.equal(B.resolveAgentEngine({ agent: { id: 'dev-1', role: 'developer' }, wire: 'openai', endpoints: EPS, failover: on, hasKey: allKeys }), null);
});

test('opencodeProviders: anahtar JSON içine yazılmaz, env ikamesi kullanılır', () => {
  const p = B.opencodeProviders(EPS, allKeys);
  assert.deepEqual(Object.keys(p), ['evren', 'nvidia', 'kimi', 'chatgpt']);
  assert.equal(p.kimi.options.apiKey, '{env:BYOK_KIMI_API_KEY}');
  assert.equal(p.evren.options.apiKey, '{env:BYOK_EVREN_API_KEY}');
  assert.equal(p.nvidia.options.baseURL, 'https://integrate.api.nvidia.com/v1');
  assert.ok('google/gemma-4-31b-it' in p.nvidia.models);
  assert.deepEqual(B.opencodeProviders(EPS, noKeys), {});
});

test('claudeEngineEnv: anahtar yalnız AUTH_TOKEN içinde, tüm model katmanları sabit', () => {
  const eng = { endpoint: EPS[0], model: 'glm-5.3', wire: 'anthropic', source: 'pin' };
  const env = B.claudeEngineEnv(eng, FAKE);
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://evren-llmapi.ssyz.org.tr');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, FAKE);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'glm-5.3');
  assert.equal(Object.values(env).filter((v) => v === FAKE).length, 1);
  assert.deepEqual(B.claudeEngineEnv({ ...eng, wire: 'openai' }, FAKE), {});
});

test('model argümanı ve pin metni ayrıştırma', () => {
  assert.deepEqual(B.withModelArg(['--x', '--model', 'a'], 'b'), ['--x', '--model', 'b']);
  assert.deepEqual(B.withModelArg([], 'b'), ['--model', 'b']);
  assert.deepEqual(B.splitEndpointModel('nvidia/deepseek-ai/deepseek-v4.1-flash', EPS), { endpointId: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' });
  assert.equal(B.splitEndpointModel('openai/gpt-x', EPS), null);
  const { pins, invalid } = B.parsePinLines('# yorum\ndev2 = evren/glm-5.3\nw3 = nvidia\nbozuk\nx = yok/m', EPS);
  assert.deepEqual(pins, { dev2: { endpointId: 'evren', model: 'glm-5.3' }, w3: { endpointId: 'nvidia' } });
  assert.deepEqual(invalid, ['bozuk', 'x = yok/m']);
  assert.equal(B.formatPins(pins), 'dev2 = evren/glm-5.3\nw3 = nvidia');
  assert.equal(B.endpointKeyRef('evren'), 'apikey:endpoint:evren');
});

// ─── Canlı duman testi (isteğe bağlı) ────────────────────────────────────────
// Yalnız env'de anahtar varsa koşar; anahtar asla yazdırılmaz.
for (const [id, envName] of [['evren', 'EVREN_TEST_KEY'], ['nvidia', 'NVIDIA_TEST_KEY']]) {
  const key = process.env[envName];
  test(`canlı: ${id} /models erişilebilir`, { skip: key ? false : `${envName} tanımlı değil` }, async () => {
    const ep = EPS.find((e) => e.id === id);
    const res = await fetch(`${ep.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    assert.equal(res.ok, true, `${id} /models HTTP ${res.status}`);
  });
}

test('yerel uç nokta (Ollama): anahtarsız kullanılabilir, Anthropic adresi /v1 olmadan türetilir', () => {
  const [ol, fixed, remote] = B.normalizeEndpoints([
    { id: 'ollama-genel', label: 'Genel', baseUrl: 'http://localhost:11434/v1', defaultModel: 'emrettc-genel' },
    { id: 'ollav1', label: 'eski', baseUrl: 'http://127.0.0.1:11434/v1', anthropicBaseUrl: 'http://127.0.0.1:11434/v1' },
    { id: 'uzak', label: 'Uzak', baseUrl: 'https://api.example.com/v1' }
  ]);
  assert.equal(ol.anthropicBaseUrl, 'http://localhost:11434');
  assert.equal(fixed.anthropicBaseUrl, 'http://127.0.0.1:11434');
  assert.equal(remote.anthropicBaseUrl, undefined, 'uzak uç noktaya Anthropic teli uydurulmaz');
  assert.equal(B.isLocalEndpoint(ol), true);
  assert.equal(B.isLocalEndpoint(remote), false);
  assert.equal(B.endpointUsable(ol, 'openai', noKeys), true);
  assert.equal(B.endpointUsable(ol, 'anthropic', noKeys), true);
  assert.equal(B.endpointUsable(remote, 'openai', noKeys), false, 'uzak uç nokta yine anahtar ister');
  const eng = B.resolveAgentEngine({
    agent: { id: 'reklam' }, wire: 'openai', endpoints: [ol, remote],
    pins: { reklam: { endpointId: 'ollama-genel' } },
    failover: B.normalizeQuotaFailover({}), hasKey: noKeys
  });
  assert.equal(eng && eng.model, 'emrettc-genel');
  assert.deepEqual(Object.keys(B.opencodeProviders([ol, remote], noKeys)), ['ollama-genel']);
});

test('yerel pinli ajan, yerel motor kapalıyken hiçbir yere geçmez (ne ücretli ne başka yerel model); zaman aşımı uzun', () => {
  const eps = B.normalizeEndpoints([
    { id: 'ollama-genel', label: 'G', baseUrl: 'http://localhost:11434/v1', defaultModel: 'emrettc-genel' },
    { id: 'ollama-agir', label: 'A', baseUrl: 'http://localhost:11434/v1', defaultModel: 'emrettc-analiz' },
    { id: 'evren', label: 'E', baseUrl: 'https://evren.example/v1', defaultModel: 'gemma-4-31b' }
  ]);
  const failover = B.normalizeQuotaFailover({ auto: true, agents: ['*'], exempt: [], fallbackOrder: ['evren', 'ollama-agir'] });
  const run = (down) => B.resolveAgentEngine({
    agent: { id: 'reklam' }, wire: 'openai', endpoints: eps,
    pins: { reklam: { endpointId: 'ollama-genel' } }, failover, hasKey: allKeys, isDown: (id) => down.includes(id)
  });
  assert.equal(run(['ollama-genel']).endpoint.id, 'ollama-genel', 'başka yerel modele geçmez: aynı ekran kartı, daha büyük model sığmaz');
  assert.equal(run(['ollama-genel']).source, 'pin');
  assert.equal(run(['ollama-genel', 'ollama-agir']).endpoint.id, 'ollama-genel', "evren'e de gitmez");
  const prov = B.opencodeProviders(eps, allKeys);
  assert.equal(prov['ollama-genel'].options.headerTimeout, B.LOCAL_HEADER_TIMEOUT_MS);
  assert.equal(prov.evren.options.headerTimeout, B.OPENCODE_HEADER_TIMEOUT_MS);
});
