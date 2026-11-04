'use strict';

/**
 * Krediler ve kotalar (src/shared/quota.ts): Claude durum satırı yüzdeleri ve
 * harcama kaydının birikimli örneklerinden bugünkü kullanım.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const Q = loadTs('src/shared/quota.ts');
const B = loadTs('src/shared/byokEndpoints.ts');

test('parseRateLimits: yüzde ve sıfırlanma saati; geçersizse null', () => {
  const now = 1_800_000_000_000;
  const q = Q.parseRateLimits({ five_hour: { used_percentage: 42.4, resets_at: 1_800_003_600 }, seven_day: { utilization: 0.61 } }, now);
  assert.deepEqual(q.fiveHour, { pct: 42, resetsAt: 1_800_003_600_000 });
  assert.deepEqual(q.sevenDay, { pct: 61, resetsAt: null });
  assert.equal(Q.parseRateLimits({}, now), null);
  assert.equal(Q.parseRateLimits(null, now), null);
});

test('usageByFamily: birikimli örneklerden bugünkü pay, aileye göre', () => {
  const since = 1000;
  const isFree = (m) => m === 'emrettc-genel';
  const rows = [
    { agent_id: 'a', session_id: 's1', ts: 500, input: 100, output: 0, model: 'claude-opus-5-5', usd: 1 },
    { agent_id: 'a', session_id: 's1', ts: 1500, input: 400, output: 100, model: 'claude-opus-5-5', usd: 3 },
    { agent_id: 'b', session_id: 's2', ts: 1200, input: 1000, output: 0, model: 'emrettc-genel', usd: 0.5 },
    { agent_id: 'c', session_id: 's3', ts: 1300, input: 50, output: 50, model: 'gemini-2.5-pro', usd: 0.2 },
    { agent_id: 'd', session_id: 's4', ts: 1300, input: 7, model: '', usd: 0 }
  ];
  const u = Q.usageByFamily(rows, since, isFree);
  assert.deepEqual(u.map((f) => [f.family, f.tokens, Math.round(f.usd * 100) / 100]), [
    ['local', 1000, 0], ['claude', 400, 2], ['gemini', 100, 0.2]
  ]);
});

test('shortTokens ve Gemini hazır motoru', () => {
  assert.equal(Q.shortTokens(1_234_567), '1,2 M');
  assert.equal(Q.shortTokens(45_600), '46 B');
  assert.equal(Q.shortTokens(12), '12');
  const g = B.ENDPOINT_PRESETS.find((e) => e.id === 'gemini-api');
  assert.ok(g && B.isValidEndpointId(g.id));
  assert.match(g.baseUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(B.isLocalEndpoint(g), false);
});

test('günlük özet bölümü: yerel, Claude, API motorları ve kullanım', () => {
  const G = loadTs('src/main/localGate.ts');
  const local = G.sumDaily([
    { requests: 10, errors: 1, totalMs: 50_000, waitMs: 10_000, spills: { evren: 2 }, overflow: 1, restores: 4 },
    { requests: 10, errors: 0, totalMs: 30_000, waitMs: 10_000, spills: { evren: 1, kimi: 1 }, overflow: 0, restores: 1 },
    undefined
  ]);
  assert.deepEqual(local.spills, { evren: 3, kimi: 1 });
  const md = Q.buildEngineReport({
    period: 'dünden bu yana',
    local,
    localEngine: { label: 'Genel İşler · emrettc-genel', up: true },
    claude: { fiveHour: { pct: 72, resetsAt: 1 }, sevenDay: { pct: 31, resetsAt: null }, at: 0 },
    workerLimitPct: 60,
    engines: [
      { id: 'claude', label: 'Claude', kind: 'paid', down: null },
      { id: 'evren', label: 'EVREN', kind: 'free', down: null },
      { id: 'kimi', label: 'Kimi', kind: 'paid', down: { reason: 'credits', untilMs: 2 } }
    ],
    usage: [{ family: 'local', tokens: 3_100_000, usd: 0, models: [] }, { family: 'claude', tokens: 2_400_000, usd: 1.88, models: [] }],
    labelOf: (id) => id.toUpperCase(),
    fmtTime: () => 'Çar 20:45'
  });
  assert.match(md, /### Motorlar ve kotalar \(dünden bu yana\)/);
  assert.match(md, /20 istek, ortalama 4,0 sn; sırada ortalama 1,0 sn/);
  assert.match(md, /API'ye taşan: 4 \(EVREN 3, KIMI 1\); 1 tanesi yerel bağlama sığmadığı için/);
  assert.match(md, /Ajan belleği diskten 5 kez/);
  assert.match(md, /5 saatlik: %72, sıfırlanma Çar 20:45 — işçiler durdu/);
  assert.match(md, /Haftalık: %31$/m);
  assert.match(md, /Kimi \(ücretli\): kredi yok \(yeniden deneme: Çar 20:45\)/);
  assert.match(md, /Yerel: 3,1 M token \(ücretsiz\)/);
  assert.match(md, /Claude: 2,4 M token · 1\.88 \$/);
  assert.doesNotMatch(md, /^- Claude \(ücretli\)/m, 'Claude abonelik satırında, API listesinde değil');
});

test('yerel motor YANIT VERMİYOR ve istek yoksa da rapor çıkar', () => {
  const G = loadTs('src/main/localGate.ts');
  const md = Q.buildEngineReport({
    period: 'dünden bu yana', local: G.emptyDaily(), localEngine: { label: 'Yerel', up: false },
    claude: null, workerLimitPct: 60, engines: [], usage: [], labelOf: (x) => x, fmtTime: () => ''
  });
  assert.match(md, /Yerel — şu an YANIT VERMİYOR/);
  assert.match(md, /yerel modele istek gelmedi/);
  assert.match(md, /Kullanım yüzdesi henüz bildirilmedi/);
  assert.match(md, /Kayıtlı kullanım yok/);
});
