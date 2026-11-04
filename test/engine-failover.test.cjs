'use strict';

/**
 * Otomatik motor geçişi: Claude limiti / BYOK uç nokta hatası algılanınca motor
 * bir süre "kapalı" sayılır, ajanlar sıradaki sağlıklı motora geçer, süre dolunca
 * asıl motora döner. Saf çekirdek: src/shared/engineHealth.ts + resolveAgentEngine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const H = loadTs('src/shared/engineHealth.ts');
const B = loadTs('src/shared/byokEndpoints.ts');
const EPS = B.normalizeEndpoints(B.DEFAULT_BYOK_ENDPOINTS);
const allKeys = () => true;
const auto = B.normalizeQuotaFailover({ auto: true, agents: ['*'], exempt: [] });

// 28 Ekim 2026, 14:00 yerel saat
const NOW = new Date(2026, 9, 28, 14, 0, 0);

test('detectClaudeLimit: limit mesajları ve sıfırlanma saati', () => {
  const a = H.detectClaudeLimit('  ⎿  Claude usage limit reached. Your limit will reset at 7pm (Europe/Istanbul).', NOW);
  assert.equal(a.reason, 'limit');
  assert.equal(new Date(a.untilMs).getHours(), 19);
  const b = H.detectClaudeLimit("You've hit your limit · resets 3:30am (Europe/Istanbul)", NOW);
  const bd = new Date(b.untilMs);
  assert.equal(bd.getDate(), 29); // 03:30 geçmiş saat ⇒ ertesi gün
  assert.equal(bd.getHours(), 3);
  assert.equal(bd.getMinutes(), 30);
  const c = H.detectClaudeLimit('5-hour limit reached ∙ resets 6pm', NOW);
  assert.equal(new Date(c.untilMs).getHours(), 18);
  const w = H.detectClaudeLimit('Weekly limit reached · resets Oct 30, 3pm', NOW);
  const wd = new Date(w.untilMs);
  assert.equal(wd.getMonth(), 9);
  assert.equal(wd.getDate(), 30);
  assert.equal(wd.getHours(), 15);
});

test('detectClaudeLimit: kota azalınca (%60 ve üstü — işçi payı) motor kapanır', () => {
  assert.equal(H.detectClaudeLimit("You've used 59% of your weekly limit · resets Nov 2, 12am (Europe/Istanbul)", NOW), null);
  assert.equal(H.detectClaudeLimit("You've used 81% of your weekly limit · resets Nov 2, 12am (Europe/Istanbul)", NOW).reason, 'low');
  const low = H.detectClaudeLimit("You've used 96% of your session limit · resets 7pm", NOW);
  assert.equal(low.reason, 'low');
  assert.equal(new Date(low.untilMs).getHours(), 19);
  assert.equal(H.detectClaudeLimit("You've used 40% of your weekly limit · resets Oct 30, 3pm", NOW), null);
  assert.equal(H.detectClaudeLimit('Approaching usage limit · resets 7pm', NOW), null);
});

test('detectClaudeLimit: sıfırlanma saati yoksa varsayılan süre, kod satırı yanlış alarm vermez', () => {
  const d = H.detectClaudeLimit('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', NOW);
  assert.equal(d.reason, 'rate');
  assert.ok(d.untilMs > NOW.getTime());
  assert.equal(H.detectClaudeLimit('everything is fine', NOW), null);
  assert.equal(H.detectClaudeLimit("const re = /Claude usage limit reached/i;", NOW), null);
  assert.equal(H.detectClaudeLimit("  'Claude usage limit reached. resets 7pm',", NOW), null);
});

test('stripAnsi: renk ve imleç kodları temizlenir', () => {
  assert.equal(H.stripAnsi('\x1b[38;2;1;2;3mClaude\x1b[0m usage\x1b[2Climit'), 'Claude usage  limit');
  // İmleç atlatmalı TUI çıktısı da algılanır.
  assert.equal(H.detectClaudeLimit('\x1b[2C⎿\x1b[1CClaude\x1b[1Cusage\x1b[3Climit reached\x1b[0m', NOW).reason, 'limit');
});

test('parseOpencodeLogLine: stream error satırı motor + hata türüne çevrilir', () => {
  const line = 'timestamp=2026-10-28T19:07:33.679Z level=ERROR run=16442d35 message="stream error" providerID=nvidia modelID=deepseek-ai/deepseek-v4.1-flash session.id=ses_x small=true error.error="ProviderHeaderTimeoutError: Provider response headers timed out after 300000ms"';
  const r = H.parseOpencodeLogLine(line, NOW);
  assert.equal(r.engine, 'nvidia');
  assert.equal(r.failure.reason, 'timeout');
  assert.equal(H.parseOpencodeLogLine('timestamp=x level=INFO message=stream providerID=nvidia', NOW), null);
  const q = H.parseOpencodeLogLine('level=ERROR message="stream error" providerID=evren error.error="APICallError: 402 insufficient credits"', NOW);
  assert.equal(q.engine, 'evren');
  assert.equal(q.failure.reason, 'credits');
  const rl = H.parseOpencodeLogLine('level=ERROR message="stream error" providerID=evren error.error="429 Too Many Requests"', NOW);
  assert.equal(rl.failure.reason, 'rate');
});

test('EngineHealth: kapat, sorgula, süre dolunca geri aç', () => {
  const h = new H.EngineHealth();
  const t = NOW.getTime();
  assert.equal(h.markDown('nvidia', { reason: 'timeout', untilMs: t + 60_000, detail: 'x' }, t), true);
  assert.equal(h.isDown('nvidia', t + 1), true);
  // Daha kısa bir süreyle tekrar işaretlemek mevcut kaydı kısaltmaz.
  assert.equal(h.markDown('nvidia', { reason: 'rate', untilMs: t + 10_000, detail: 'y' }, t), false);
  assert.deepEqual(h.expire(t + 30_000), []);
  assert.deepEqual(h.expire(t + 60_001), ['nvidia']);
  assert.equal(h.isDown('nvidia', t + 60_002), false);
});

test('otomatik mod: Claude kapalıyken Claude ajanı EVREN\'e, açılınca geri', () => {
  const agent = { id: 'reklam' };
  const up = B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: EPS, failover: auto, hasKey: allKeys, isDown: () => false });
  assert.equal(up, null); // Claude sağlıklı ⇒ varsayılan motor
  const down = B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: EPS, failover: auto, hasKey: allKeys, isDown: (e) => e === 'claude' });
  assert.equal(down.endpoint.id, 'evren');
  assert.equal(down.source, 'failover');
  // EVREN de kapalıysa Kimi'ye geçer (Anthropic teli konuşur).
  const kimi = B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: EPS, failover: auto, hasKey: allKeys, isDown: (e) => e === 'claude' || e === 'evren' });
  assert.equal(kimi.endpoint.id, 'kimi');
  assert.equal(kimi.model, 'kimi-k3');
  // Sıraya yazılmamış ama anahtarlı motor son çare olarak kullanılır.
  const onlyEvren = { ...auto, fallbackOrder: ['evren'] };
  const lastResort = B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: EPS, failover: onlyEvren, hasKey: allKeys, isDown: (e) => e === 'claude' || e === 'evren' });
  assert.equal(lastResort.endpoint.id, 'kimi');
  // Kimi de kapalıysa Claude'da kalır (NVIDIA Anthropic teli konuşmaz).
  assert.equal(B.resolveAgentEngine({ agent, wire: 'anthropic', endpoints: EPS, failover: auto, hasKey: allKeys, isDown: (e) => e === 'claude' || e === 'evren' || e === 'kimi' }), null);
});

test('otomatik mod: pinli uç nokta kapalıysa sıradakine geçer, hepsi kapalıysa pinde kalır', () => {
  const agent = { id: 'faruk' };
  const pins = { faruk: { endpointId: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' } };
  const ok = B.resolveAgentEngine({ agent, wire: 'openai', endpoints: EPS, pins, failover: auto, hasKey: allKeys, isDown: () => false });
  assert.equal(ok.endpoint.id, 'nvidia');
  const fo = B.resolveAgentEngine({ agent, wire: 'openai', endpoints: EPS, pins, failover: auto, hasKey: allKeys, isDown: (e) => e === 'nvidia' });
  assert.equal(fo.endpoint.id, 'evren');
  assert.equal(fo.model, 'glm-5.3');
  const all = B.resolveAgentEngine({ agent, wire: 'openai', endpoints: EPS, pins, failover: auto, hasKey: allKeys, isDown: () => true });
  assert.equal(all.endpoint.id, 'nvidia');
  // Otomatik mod kapalıysa pin her zaman kazanır.
  const manual = B.normalizeQuotaFailover({ auto: false });
  assert.equal(B.resolveAgentEngine({ agent, wire: 'openai', endpoints: EPS, pins, failover: manual, hasKey: allKeys, isDown: () => true }).endpoint.id, 'nvidia');
});

test('otomatik mod: muaf ajan geçmez; varsayılan auto kapalı', () => {
  const ex = B.normalizeQuotaFailover({ auto: true, agents: ['*'], exempt: ['god'] });
  assert.equal(B.resolveAgentEngine({ agent: { id: 'g', isGod: true }, wire: 'anthropic', endpoints: EPS, failover: ex, hasKey: allKeys, isDown: () => true }), null);
  assert.equal(B.normalizeQuotaFailover(undefined).auto, false);
});

test('opencodeProviders: yanıt başlığı zaman aşımı kısaltılır', () => {
  const p = B.opencodeProviders(EPS, allKeys);
  assert.equal(p.nvidia.options.headerTimeout, 90000);
});

test('EngineFailover: Claude limiti → anında EVREN; açılınca yalnız boştayken geri', () => {
  const { EngineFailover } = loadTs('src/main/engineFailover.ts');
  const switches = [];
  let idle = 0;
  const f = new EngineFailover({
    autoEnabled: () => true,
    desiredEngine: (t, isDown) => {
      const r = B.resolveAgentEngine({ agent: { id: t.agentId }, wire: t.wire, endpoints: EPS, failover: auto, hasKey: allKeys, isDown });
      return r ? r.endpoint.id : 'claude';
    },
    alive: () => true,
    idleMs: () => idle,
    requestSwitch: (ptyId, from, to) => switches.push([ptyId, from, to]),
    log: () => {},
    opencodeLogPath: '/yok/opencode.log'
  });
  f.track('pty-a', { agentId: 'reklam', wire: 'anthropic', engine: 'claude' });
  f.onPtyData('pty-a', 'merhaba\r\n');
  assert.deepEqual(switches, []);
  f.onPtyData('pty-a', '\x1b[2C⎿  Claude usage limit reached. Your limit will reset at 11:59pm\r\n');
  assert.deepEqual(switches, [['pty-a', 'claude', 'evren']]);
  // Ajan EVREN'de yeniden başladı; Claude açıldı ama ajan meşgul ⇒ bekle.
  f.track('pty-a', { agentId: 'reklam', wire: 'anthropic', engine: 'evren' });
  f.health.expire(Number.MAX_SAFE_INTEGER);
  f.lastSwitch.clear();
  f.nextSwitchAt = 0;
  f.evaluate();
  assert.equal(switches.length, 1);
  idle = 120_000;
  f.nextSwitchAt = 0;
  f.evaluate();
  assert.deepEqual(switches[1], ['pty-a', 'evren', 'claude']);
  // Hemen ardından tekrar değerlendirme aynı ajanı yeniden başlatmaz (bekleme süresi).
  f.track('pty-a', { agentId: 'reklam', wire: 'anthropic', engine: 'evren' });
  f.evaluate();
  assert.equal(switches.length, 2);
});

test('EngineFailover: otomatik mod kapalıyken hiçbir ajan yeniden başlatılmaz', () => {
  const { EngineFailover } = loadTs('src/main/engineFailover.ts');
  let n = 0;
  const f = new EngineFailover({
    autoEnabled: () => false, desiredEngine: () => 'evren', alive: () => true, idleMs: () => 1e9,
    requestSwitch: () => { n++; }, log: () => {}, opencodeLogPath: '/yok'
  });
  f.track('p', { agentId: 'x', wire: 'anthropic', engine: 'claude' });
  f.onPtyData('p', 'Claude usage limit reached\n');
  assert.equal(n, 0);
  assert.equal(f.isDown('claude'), true); // durum yine de kaydedilir (Ayarlar'da görünür)
});

test('otomatik mod açıkken manuel bayrak sağlıklı Claude ajanını yedeğe zorlamaz', () => {
  const both = B.normalizeQuotaFailover({ enabled: true, auto: true, agents: ['*'], exempt: [] });
  assert.equal(B.resolveAgentEngine({ agent: { id: 'reklam' }, wire: 'anthropic', endpoints: EPS, failover: both, hasKey: allKeys, isDown: () => false }), null);
  assert.equal(B.resolveAgentEngine({ agent: { id: 'reklam' }, wire: 'anthropic', endpoints: EPS, failover: both, hasKey: allKeys, isDown: (e) => e === 'claude' }).endpoint.id, 'evren');
});

test('classifyProviderError: EVREN Türkçe hataları ve tanınmayan hata', () => {
  assert.equal(H.classifyProviderError('AI_APICallError: Geçersiz API anahtarı', NOW).reason, 'auth');
  assert.equal(H.classifyProviderError('Kota aşıldı', NOW).reason, 'credits');
  assert.equal(H.classifyProviderError('AI_APICallError: something odd', NOW).reason, 'unavailable');
});

test('parseOpencodeLogLine: eşzamanlı istek sınırı motoru kapatmaz (OpenCode yeniden dener)', () => {
  const l = 'level=ERROR message="stream error" providerID=evren error.error="AI_APICallError: Model şu an yoğun; hesabınız bu modelde en fazla 4 eşzamanlı istek açabilir."';
  assert.equal(H.parseOpencodeLogLine(l, NOW), null);
});

test('EngineFailover: çoklu geçiş sıraya dizilir, god en son; durum diske yazılıp geri yüklenir', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { EngineFailover } = loadTs('src/main/engineFailover.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-'));
  const statePath = path.join(dir, 'motor-durumu.json');
  const order = [];
  const mk = () => new EngineFailover({
    autoEnabled: () => true,
    desiredEngine: (t, isDown) => (isDown('claude') ? 'evren' : 'claude'),
    alive: () => true, idleMs: () => 0,
    requestSwitch: (ptyId) => order.push([ptyId, Date.now()]),
    log: () => {}, opencodeLogPath: '/yok', statePath: () => statePath
  });
  const f = mk();
  f.track('p-god', { agentId: 'god', isGod: true, wire: 'anthropic', engine: 'claude' });
  f.track('p-a', { agentId: 'a', wire: 'anthropic', engine: 'claude' });
  f.reportDown('claude', { reason: 'low', untilMs: Date.now() + 3600_000, detail: 'x' });
  assert.deepEqual(order.map((o) => o[0]), ['p-a']); // ilki hemen
  await new Promise((r) => setTimeout(r, 5200));
  assert.deepEqual(order.map((o) => o[0]), ['p-a', 'p-god']); // god ~5 sn sonra
  assert.ok(order[1][1] - order[0][1] >= 4900);
  // Yeni süreç: diskten yüklenen durumla Claude hâlâ kapalı.
  assert.equal(mk().isDown('claude'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claudeQuotaFromRateLimits: durum satırındaki yüzde %60 olunca sıfırlanmaya kadar kapalı', () => {
  const reset = Math.floor(NOW.getTime() / 1000) + 3600;
  assert.equal(H.claudeQuotaFromRateLimits({ five_hour: { used_percentage: 59.9, resets_at: reset } }, NOW), null);
  const f = H.claudeQuotaFromRateLimits({ five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 61, resets_at: reset } }, NOW);
  assert.equal(f.reason, 'low');
  assert.equal(f.untilMs, reset * 1000);
  assert.match(f.detail, /haftalık.*%61/);
  const iso = H.claudeQuotaFromRateLimits({ five_hour: { used_percentage: 75, resets_at: new Date(NOW.getTime() + 7200_000).toISOString() } }, NOW);
  assert.equal(iso.untilMs, NOW.getTime() + 7200_000);
  assert.equal(H.claudeQuotaFromRateLimits(null, NOW), null);
  assert.equal(H.claudeQuotaFromRateLimits({ five_hour: 'x' }, NOW), null);
});
