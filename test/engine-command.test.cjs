'use strict';

/**
 * Ofis hiç durmasın: Claude Code ajanı EVREN/Kimi üzerindeyken o motorun hatası
 * da algılanır, ve god bir motoru elle kapatıp açabilir (motor-komut/*.json).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const H = loadTs('src/shared/engineHealth.ts');
const { EngineFailover } = loadTs('src/main/engineFailover.ts');

const now = new Date('2026-10-29T10:00:00Z');

test('Anthropic teli: son API Error motoru kapatır, yeniden deneme satırı kapatmaz', () => {
  assert.equal(H.detectAnthropicWireError('⎿ API Error (529 Overloaded) · Retrying in 5 seconds… (attempt 2/10)', now), null);
  assert.equal(H.detectAnthropicWireError('  ⎿  API Error: 401 {"error":{"message":"Geçersiz API anahtarı"}}', now).reason, 'auth');
  assert.equal(H.detectAnthropicWireError('API Error: 402 insufficient balance', now).reason, 'credits');
  assert.equal(H.detectAnthropicWireError('API Error: Request timed out.', now).reason, 'timeout');
  assert.equal(H.detectAnthropicWireError('Invalid API key · Please run /login', now).reason, 'auth');
  assert.equal(H.detectAnthropicWireError('API Error: 429 hesabınız bu modelde en fazla 4 eşzamanlı istek açabilir', now), null);
  // Ajanın kendi yazdığı metin içinde geçen ifade alarm vermez.
  assert.equal(H.detectAnthropicWireError('const msg = "API Error: 500";', now), null);
});

test('motor uyarısı: ne yapılacağını söyler', () => {
  const auth = H.engineDownNotice('EVREN LLM Gateway', { reason: 'auth', untilMs: now.getTime() + 3600_000, detail: 'API Error: 401 Geçersiz API anahtarı' }, now);
  assert.equal(auth.title, '⚠️ EVREN LLM Gateway motoru çalışmıyor');
  assert.match(auth.body, /Anahtar geçersiz.*EVREN LLM Gateway anahtarını yenileyin/);
  assert.match(auth.body, /devam ediyor/);
  const credits = H.engineDownNotice('Moonshot Kimi', { reason: 'credits', untilMs: now.getTime() + 3600_000, detail: 'x' }, now);
  assert.match(credits.body, /bakiye/);
  const timeout = H.engineDownNotice('NVIDIA NIM', { reason: 'timeout', untilMs: now.getTime() + 15 * 60_000, detail: 'y' }, now);
  assert.match(timeout.body, /15 dk sonra/);
});

test('uyarı aynı kesintide bir kez gider (süre uzasa da)', () => {
  const notes = [];
  const { fo } = makeFailover({ deps: { notifyDown: (engine, f) => notes.push([engine, f.reason]) } });
  const t = Date.now();
  fo.reportDown('evren', { reason: 'auth', untilMs: t + 60_000, detail: 'a' });
  fo.reportDown('evren', { reason: 'auth', untilMs: t + 120_000, detail: 'b' });
  assert.deepEqual(notes, [['evren', 'auth']]);
});

test('EVREN "model dolu" geçicidir, motoru kapatmaz', () => {
  assert.equal(H.detectAnthropicWireError('API Error: 503 Model şu anda dolu, lütfen kısa bir süre sonra tekrar deneyin.', now), null);
  const line = 'level=ERROR message="stream error" providerID=evren error.error="AI_APICallError: Model şu anda dolu, lütfen kısa bir süre sonra tekrar deneyin."';
  assert.equal(H.parseOpencodeLogLine(line, now), null);
});

test('dalgalanma freni: açıldıktan kısa süre sonra yine düşen motorun süresi katlanır', () => {
  const h = new H.EngineHealth();
  const MIN = 60_000;
  let t = 0;
  const down = () => h.markDown('nvidia', { reason: 'timeout', untilMs: t + 15 * MIN, detail: 'x' }, t);
  down();
  assert.equal(h.snapshot(t)[0].untilMs - t, 15 * MIN);
  t += 15 * MIN; h.expire(t); t += MIN; down();
  assert.equal(h.snapshot(t)[0].untilMs - t, 30 * MIN);
  t = h.snapshot(t)[0].untilMs; h.expire(t); t += MIN; down();
  assert.equal(h.snapshot(t)[0].untilMs - t, 60 * MIN);
  // Tavan 6 saat.
  for (let i = 0; i < 6; i++) { t = h.snapshot(t)[0].untilMs; h.expire(t); t += MIN; down(); }
  assert.equal(h.snapshot(t)[0].untilMs - t, H.FLAP_MAX_DOWN_MS);
  // Uzun süre sağlıklı kaldıktan sonraki düşüş baştan başlar.
  t = h.snapshot(t)[0].untilMs; h.expire(t); t += 2 * H.FLAP_WINDOW_MS; down();
  assert.equal(h.snapshot(t)[0].untilMs - t, 15 * MIN);
  // Limit (kesin sıfırlanma saati) katlanmaz.
  const c = new H.EngineHealth();
  c.markDown('claude', { reason: 'limit', untilMs: 10 * MIN, detail: 'l' }, 0); c.expire(10 * MIN);
  c.markDown('claude', { reason: 'limit', untilMs: 20 * MIN, detail: 'l' }, 11 * MIN);
  assert.equal(c.snapshot(11 * MIN)[0].untilMs, 20 * MIN);
});

function makeFailover(extra = {}) {
  const switches = [];
  const ptys = new Set(['p1']);
  const desired = extra.desired ?? ((t, isDown) => (isDown(t.engine) ? 'kimi' : t.engine));
  const fo = new EngineFailover({
    autoEnabled: () => true,
    desiredEngine: desired,
    alive: (id) => ptys.has(id),
    idleMs: () => Infinity,
    requestSwitch: (ptyId, from, to) => switches.push([ptyId, from, to]),
    log: () => {},
    opencodeLogPath: path.join(os.tmpdir(), 'yok-opencode.log'),
    ...extra.deps
  });
  return { fo, switches };
}

test('EVREN üzerindeki Claude Code ajanı EVREN hatasında Kimi\'ye geçer', () => {
  const { fo, switches } = makeFailover();
  fo.track('p1', { agentId: 'reklam', wire: 'anthropic', engine: 'evren' });
  fo.onPtyData('p1', '\r\n  ⎿  API Error: 401 Geçersiz API anahtarı\r\n');
  assert.equal(fo.isDown('evren'), true);
  assert.deepEqual(switches, [['p1', 'evren', 'kimi']]);
});

test('god komutu: motoru kapatır (ajanlar taşınır), açar; geçersiz komut reddedilir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-komut-'));
  const { fo, switches } = makeFailover({ deps: { commandDir: () => dir } });
  fo.track('p1', { agentId: 'faruk', wire: 'openai', engine: 'nvidia' });
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ motor: 'NVIDIA', durum: 'kapali', dakika: 30, neden: 'yanıt yok' }));
  fs.writeFileSync(path.join(dir, 'b.json'), '{bozuk');
  fo.tick();
  assert.equal(fo.isDown('nvidia'), true);
  assert.deepEqual(switches, [['p1', 'nvidia', 'kimi']]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.done')).sort(), ['a.json', 'b.json']);
  assert.equal(fo.applyCommand({ motor: 'nvidia', durum: 'acik' }), 'nvidia açıldı');
  assert.equal(fo.isDown('nvidia'), false);
  assert.match(fo.applyCommand({ motor: 'nvidia', durum: 'bilmem' }), /geçersiz/);
  assert.match(fo.applyCommand({ durum: 'kapali' }), /geçersiz/);
});
