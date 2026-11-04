'use strict';

/**
 * Ortak bilgi hafızası (resources/bilgi.cjs): ajanlar araştırmadan önce `bilgi ara`,
 * sonra `bilgi kaydet` kullanır; hafızadan karşılanan araştırmanın maliyeti
 * tahmini token tasarrufu olarak sayılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'resources', 'bilgi.cjs');
const K = require(CLI);

const NOW = Date.UTC(2026, 9, 28, 20, 0, 0);
const H = 3600_000;

test('slugify: Türkçe karakterler sadeleşir', () => {
  assert.equal(K.slugify('EVREN Ağ Geçidi: Eşzamanlı İstek Sınırı!'), 'evren-ag-gecidi-eszamanli-istek-siniri');
  assert.equal(K.slugify('   '), 'not');
});

test('buildNote / parseNote gidiş-dönüş', () => {
  const text = K.buildNote({
    konu: 'NVIDIA NIM gecikmesi', ajan: 'faruk', tarih: '2026-10-28T20:00:00.000Z',
    etiketler: ['nvidia', 'motor'], kaynaklar: ['https://integrate.api.nvidia.com'],
    maliyet: 1234, maliyetKaynagi: 'olcum', ilgili: ['evren-limit'], metin: 'DeepSeek kuyrukta bekliyor.'
  });
  const n = K.parseNote(text);
  assert.equal(n.meta.konu, 'NVIDIA NIM gecikmesi');
  assert.deepEqual(n.meta.etiketler, ['nvidia', 'motor']);
  assert.deepEqual(n.meta.ilgili, ['evren-limit']);
  assert.equal(n.meta.maliyet_token, 1234);
  assert.match(n.body, /DeepSeek kuyrukta bekliyor/);
});

test('keywordSearch: başlık ağırlıklı, eşik altı elenir', () => {
  const notes = [
    { slug: 'a', meta: { konu: 'EVREN eşzamanlı istek sınırı', etiketler: ['evren'] }, body: 'model başına 4 istek' },
    { slug: 'b', meta: { konu: 'Meta reklam bütçesi', etiketler: ['reklam'] }, body: 'günlük bütçe' }
  ];
  const r = K.keywordSearch(notes, 'evren istek sınırı nedir');
  assert.equal(r[0].slug, 'a');
  assert.equal(r.some((x) => x.slug === 'b'), false);
});

test('parseMempalaceOutput: kaynak ve cosine okunur', () => {
  const out = [
    '  [1] bilgi / general',
    '      Source: evren-limit.md',
    '      Match:  cosine_sim=0.512  bm25=3.1',
    '',
    '  [2] god / general',
    '      Source: memory.md',
    '      Match:  cosine_sim=0.300  bm25=1.0'
  ].join('\n');
  assert.deepEqual(K.parseMempalaceOutput(out), [
    { wing: 'bilgi', source: 'evren-limit.md', cosine: 0.512 },
    { wing: 'god', source: 'memory.md', cosine: 0.3 }
  ]);
});

test('agentTokensSince: oturum başına birikimli satırlardan artış', () => {
  const rows = [
    { agent_id: 'x', session_id: 's1', ts: NOW - 5 * H, input: 100, output: 100, cache_creation: 0, cache_read: 9999 },
    { agent_id: 'x', session_id: 's1', ts: NOW - 1 * H, input: 400, output: 300, cache_creation: 300, cache_read: 99999 },
    { agent_id: 'x', session_id: 's2', ts: NOW - 30 * 60_000, input: 50, output: 50, cache_creation: 0, cache_read: 0 },
    { agent_id: 'y', session_id: 's3', ts: NOW - 1 * H, input: 9e6, output: 0, cache_creation: 0, cache_read: 0 }
  ];
  // s1: 1000 − 200 (2 saat önceki taban) = 800; s2 tamamen pencerede: 100.
  assert.equal(K.agentTokensSince(rows, 'x', NOW - 2 * H), 900);
  assert.equal(K.agentTokensSince(rows, 'z', NOW - 2 * H), 0);
});

test('relatedSlugs: ortak etiket ya da iki ortak başlık terimi', () => {
  const notes = [
    { slug: 'evren-limit', meta: { konu: 'EVREN istek sınırı', etiketler: ['evren'] } },
    { slug: 'nvidia-gecikme', meta: { konu: 'NVIDIA gecikme', etiketler: ['nvidia'] } },
    { slug: 'reklam', meta: { konu: 'Reklam bütçesi', etiketler: [] } }
  ];
  assert.deepEqual(K.relatedSlugs({ konu: 'EVREN model listesi', etiketler: ['evren'] }, notes), ['evren-limit']);
  assert.deepEqual(K.relatedSlugs({ konu: 'NVIDIA gecikme ölçümü', etiketler: [] }, notes), ['nvidia-gecikme']);
});

test('creditSavings: aynı ajan + not 24 saatte bir kez sayılır', () => {
  const usage = [{ kind: 'isabet', ajan: 'faruk', not: 'evren-limit', tasarruf: 500, ts: NOW - 2 * H }];
  const hits = [{ slug: 'evren-limit', maliyet: 500 }, { slug: 'nvidia-gecikme', maliyet: 300 }];
  const credited = K.creditSavings(usage, 'faruk', hits, NOW);
  assert.deepEqual(credited.map((c) => c.not), ['nvidia-gecikme']);
  assert.equal(K.creditSavings(usage, 'faruk', hits, NOW + 25 * H).length, 2);
  assert.equal(K.creditSavings(usage, 'tester', hits, NOW).length, 2);
});

test('summarize: arama, isabet ve tahmini tasarruf toplamı', () => {
  const s = K.summarize([
    { kind: 'ara', ajan: 'a', ts: 1 },
    { kind: 'ara', ajan: 'b', ts: 2 },
    { kind: 'isabet', ajan: 'b', not: 'n1', tasarruf: 700, ts: 2 },
    { kind: 'isabet', ajan: 'b', not: 'n2', tasarruf: 300, ts: 2 },
    { kind: 'kaydet', ajan: 'a', not: 'n1', maliyet: 700, ts: 3 }
  ]);
  assert.deepEqual(s, { aramalar: 2, isabetliAramalar: 1, tasarrufToken: 1000, kayitlar: 1, ajanlar: { b: 1000 } });
});

test('CLI uçtan uca: kaydet → ara isabet + tasarruf → graf', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgi-'));
  fs.writeFileSync(path.join(root, 'cost-ledger.jsonl'), [
    { agent_id: 'arastirma', session_id: 's', ts: Date.now() - 60_000, input: 1000, output: 1000, cache_creation: 0, cache_read: 0 }
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const env = { ...process.env, HIVE_ROOT: root, AGENT_ID: 'arastirma', BILGI_MEMPALACE: '0' };
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: 'utf8' });

  const k = run(['kaydet', '--konu', 'EVREN eşzamanlı istek sınırı', '--etiket', 'evren,motor', '--kaynak', 'https://evren-llmapi.ssyz.org.tr'], 'Hesap başına model başına en fazla 4 eşzamanlı istek.');
  assert.equal(k.status, 0, k.stderr);
  assert.match(k.stdout, /evren-eszamanli-istek-siniri/);
  const note = fs.readFileSync(path.join(root, 'bilgi', 'notlar', 'evren-eszamanli-istek-siniri.md'), 'utf8');
  assert.match(note, /maliyet_token: 2000/);

  const a = spawnSync(process.execPath, [CLI, 'ara', 'evren istek sınırı'], { env: { ...env, AGENT_ID: 'faruk' }, encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /EVREN eşzamanlı istek sınırı/);
  const usage = fs.readFileSync(path.join(root, 'bilgi', 'kullanim.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(K.summarize(usage), { aramalar: 1, isabetliAramalar: 1, tasarrufToken: 2000, kayitlar: 1, ajanlar: { faruk: 2000 } });

  const g = run(['graf']);
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /evren-eszamanli-istek-siniri/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('main özeti (src/shared/bilgiOzet.ts) CLI summarize ile aynı sonucu verir', () => {
  const loadTs = require('./load-ts.cjs');
  const { summarizeBilgiUsage } = loadTs('src/shared/bilgiOzet.ts');
  const rows = [
    { kind: 'ara', ajan: 'a', ts: 1 }, { kind: 'isabet', ajan: 'a', not: 'n', tasarruf: 40, ts: 1 },
    { kind: 'kaydet', ajan: 'b', not: 'n', maliyet: 40, ts: 2 }
  ];
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\nbozuk satır\n';
  assert.deepEqual(summarizeBilgiUsage(jsonl), K.summarize(rows));
});

test('--proje: not projeyle etiketlenir, aramada aynı projenin notu öne çıkar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgi-proje-'));
  const env = { ...process.env, HIVE_ROOT: root, AGENT_ID: 'dev', BILGI_MEMPALACE: '0' };
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  assert.equal(run(['kaydet', '--konu', 'Ödeme sağlayıcı seçimi', '--proje', 'glenda', '--metin', 'Glenda için ödeme sağlayıcı: ikas yerleşik.']).status, 0);
  assert.equal(run(['kaydet', '--konu', 'Ödeme sağlayıcı karşılaştırması', '--proje', 'ilanveral', '--metin', 'ilanveral ödeme sağlayıcı: iyzico pazaryeri.']).status, 0);
  assert.match(fs.readFileSync(path.join(root, 'bilgi', 'notlar', 'odeme-saglayici-secimi.md'), 'utf8'), /proje: "glenda"/);
  const out = run(['ara', 'ödeme sağlayıcı', '--proje', 'ilanveral']).stdout;
  assert.ok(out.indexOf('[ilanveral]') >= 0 && out.indexOf('[ilanveral]') < out.indexOf('[glenda]'), out);
  fs.rmSync(root, { recursive: true, force: true });
});
