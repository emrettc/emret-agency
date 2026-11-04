#!/usr/bin/env node
'use strict';
/**
 * bilgi.cjs — ofisin ortak bilgi hafızası (ajan CLI'ı).
 *
 * Ajanlar araştırmadan ÖNCE `ara`, araştırmadan SONRA `kaydet` çalıştırır; böylece
 * aynı konu ikinci kez araştırılıp token harcanmaz. Hafızadan karşılanan her
 * notun ilk araştırma maliyeti TAHMİNİ token tasarrufu olarak deftere yazılır ve
 * ofisin token çubuğunun altında görünür.
 *
 *   node bilgi.cjs ara "<soru>" [--sonuc N]
 *   node bilgi.cjs kaydet --konu "<başlık>" [--proje <id>] [--etiket a,b] [--kaynak URL]... [--metin "…" | stdin]
 *   node bilgi.cjs liste
 *   node bilgi.cjs goster <slug>
 *   node bilgi.cjs graf
 *
 * Saf Node (node:fs + child_process) — kg.cjs / md-slack-reply.cjs gibi asar
 * dışından düz `node` ile çalışır. Ortam (harness spawn'da verir):
 *   HIVE_ROOT  — hive kökü (zorunlu); notlar <HIVE_ROOT>/bilgi/notlar/*.md
 *   AGENT_ID   — kaydeden / arayan ajan
 *   MEMPALACE_PALACE_PATH — varsa anlamsal arama `bilgi` kanadında yapılır
 *   BILGI_MEMPALACE=0 — anlamsal aramayı kapat (testler)
 * Tasarım: docs/superpowers/specs/2026-10-28-ortak-bilgi-hafizasi-design.md
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOUR = 3600_000;
/** Kayıt maliyeti en fazla bu kadar geriye bakılarak ölçülür. */
const COST_WINDOW_MS = 6 * HOUR;
/** Aynı ajan + aynı not bu süre içinde bir kez tasarruf sayılır. */
const CREDIT_DEDUPE_MS = 24 * HOUR;
const MIN_COSINE = 0.35;
const MIN_KEYWORD_SCORE = 0.5;

const STOP = new Set([
  've', 'ile', 'bir', 'bu', 'su', 'ne', 'nedir', 'nasil', 'icin', 'mi', 'mu', 'da', 'de', 'ki',
  'gibi', 'daha', 'en', 'cok', 'var', 'yok', 'olan', 'the', 'a', 'an', 'of', 'to', 'in', 'and',
  'or', 'is', 'what', 'how', 'for', 'on', 'with'
]);

// ─── saf yardımcılar (test edilir) ────────────────────────────────────────────

function fold(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
}

function slugify(s) {
  const out = fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return out || 'not';
}

function terms(s) {
  return fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Türkçe ekler için gevşek eşleşme: biri diğerinin ≥4 harflik önekiyse eşit say. */
function termMatch(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

const hasTerm = (list, t) => list.some((w) => termMatch(w, t));

function yamlList(v) {
  return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
}

function buildNote(n) {
  return [
    '---',
    `konu: ${JSON.stringify(n.konu)}`,
    `ajan: ${JSON.stringify(n.ajan)}`,
    ...(n.proje ? [`proje: ${JSON.stringify(n.proje)}`] : []),
    `tarih: ${JSON.stringify(n.tarih)}`,
    `etiketler: ${yamlList(n.etiketler || [])}`,
    `kaynaklar: ${yamlList(n.kaynaklar || [])}`,
    `maliyet_token: ${Math.max(0, Math.round(n.maliyet || 0))}`,
    `maliyet_kaynagi: ${JSON.stringify(n.maliyetKaynagi || 'tahmin')}`,
    `ilgili: ${yamlList(n.ilgili || [])}`,
    '---',
    '',
    `# ${n.konu}`,
    '',
    String(n.metin || '').trim(),
    ''
  ].join('\n');
}

function parseNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = { konu: '', ajan: '', tarih: '', etiketler: [], kaynaklar: [], maliyet_token: 0, maliyet_kaynagi: 'tahmin', ilgili: [] };
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    let v;
    try { v = JSON.parse(raw); } catch { v = raw; }
    meta[k] = v;
  }
  meta.maliyet_token = Number(meta.maliyet_token) || 0;
  for (const k of ['etiketler', 'kaynaklar', 'ilgili']) if (!Array.isArray(meta[k])) meta[k] = [];
  return { meta, body: m[2] };
}

/** Notlarda anahtar-kelime araması. Skor: eşleşen sorgu terimi oranı (başlık ×2). */
function keywordSearch(notes, query) {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const out = [];
  for (const n of notes) {
    const title = terms(n.meta.konu || '');
    const rest = terms(`${(n.meta.etiketler || []).join(' ')} ${n.body || ''}`);
    let hit = 0;
    let weighted = 0;
    for (const t of q) {
      if (hasTerm(title, t)) { hit++; weighted += 2; } else if (hasTerm(rest, t)) { hit++; weighted += 1; }
    }
    const coverage = hit / q.length;
    if (coverage >= MIN_KEYWORD_SCORE) out.push({ slug: n.slug, score: weighted / (2 * q.length) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** `mempalace search` metin çıktısı → [{ wing, source, cosine }]. */
function parseMempalaceOutput(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^\s*\[\d+\]\s+(\S+)\s*\//.exec(line);
    if (h) { cur = { wing: h[1], source: '', cosine: 0 }; out.push(cur); continue; }
    if (!cur) continue;
    const s = /^\s*Source:\s*(.+?)\s*$/.exec(line);
    if (s) { cur.source = s[1]; continue; }
    const c = /cosine_sim=([0-9.]+)/.exec(line);
    if (c) cur.cosine = Number(c[1]);
  }
  return out;
}

const rowTokens = (r) => (Number(r.input) || 0) + (Number(r.output) || 0) + (Number(r.cache_creation) || 0);

/** cost-ledger satırları oturum başına BİRİKİMLİ toplamdır; `since`ten bu yana artış. */
function agentTokensSince(rows, agentId, since) {
  const bySession = new Map();
  for (const r of rows) {
    if (!r || r.agent_id !== agentId) continue;
    const s = bySession.get(r.session_id) || { base: 0, last: 0, lastTs: -Infinity, baseTs: -Infinity };
    const t = rowTokens(r);
    if (r.ts <= since && r.ts >= s.baseTs) { s.base = t; s.baseTs = r.ts; }
    if (r.ts >= s.lastTs) { s.last = t; s.lastTs = r.ts; }
    bySession.set(r.session_id, s);
  }
  let total = 0;
  for (const s of bySession.values()) if (s.lastTs > since) total += Math.max(0, s.last - s.base);
  return total;
}

/** Ortak etiket ya da ≥2 ortak başlık terimi ⇒ ilgili not (bilgi grafı kenarı). */
function relatedSlugs(note, notes, selfSlug) {
  const tags = new Set((note.etiketler || []).map(fold));
  const title = terms(note.konu || '');
  const out = [];
  for (const n of notes) {
    if (n.slug === selfSlug) continue;
    const otherTags = (n.meta.etiketler || []).map(fold);
    const shared = terms(n.meta.konu || '').filter((t) => hasTerm(title, t)).length;
    if (otherTags.some((t) => tags.has(t)) || shared >= 2) out.push(n.slug);
  }
  return out;
}

/** Bu aramada tasarruf sayılacak isabetler (aynı ajan + not 24 saatte bir kez). */
function creditSavings(usage, ajan, hits, now) {
  const recent = new Set(
    usage.filter((u) => u.kind === 'isabet' && u.ajan === ajan && now - u.ts < CREDIT_DEDUPE_MS).map((u) => u.not)
  );
  return hits
    .filter((h) => !recent.has(h.slug))
    .map((h) => ({ kind: 'isabet', ajan, not: h.slug, tasarruf: Math.max(0, Math.round(h.maliyet || 0)), ts: now }));
}

function summarize(usage) {
  let aramalar = 0;
  let tasarrufToken = 0;
  let kayitlar = 0;
  const hitSearches = new Set();
  const ajanlar = {};
  for (const u of usage) {
    if (u.kind === 'ara') aramalar++;
    else if (u.kind === 'kaydet') kayitlar++;
    else if (u.kind === 'isabet') {
      const t = Number(u.tasarruf) || 0;
      tasarrufToken += t;
      ajanlar[u.ajan] = (ajanlar[u.ajan] || 0) + t;
      hitSearches.add(`${u.ajan}|${u.ts}`);
    }
  }
  return { aramalar, isabetliAramalar: hitSearches.size, tasarrufToken, kayitlar, ajanlar };
}

// ─── disk ─────────────────────────────────────────────────────────────────────

function paths() {
  const root = process.env.HIVE_ROOT;
  if (!root) fail('HIVE_ROOT tanımlı değil (ofis ajanı olarak ya da bilgi.cmd ile çalıştırın)');
  const dir = path.join(root, 'bilgi');
  return { root, dir, notes: path.join(dir, 'notlar'), usage: path.join(dir, 'kullanim.jsonl'), ledger: path.join(root, 'cost-ledger.jsonl') };
}

function readJsonl(p) {
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* bozuk satır */ }
  }
  return out;
}

function loadNotes(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  return files.map((f) => {
    const { meta, body } = parseNote(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { slug: f.slice(0, -3), meta, body };
  });
}

function appendUsage(p, rows) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function fail(msg) {
  process.stderr.write(`bilgi: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      (flags[key] = flags[key] || []).push(val);
    } else pos.push(a);
  }
  const one = (k) => (flags[k] ? flags[k][flags[k].length - 1] : undefined);
  return { pos, flags, one };
}

function semanticHits(query, limit) {
  if (process.env.BILGI_MEMPALACE === '0' || !process.env.MEMPALACE_PALACE_PATH) return [];
  const r = spawnSync('mempalace', ['search', query, '--wing', 'bilgi', '--results', String(limit)], {
    encoding: 'utf8', timeout: 90_000, windowsHide: true
  });
  if (r.status !== 0 || !r.stdout) return [];
  return parseMempalaceOutput(r.stdout).filter((h) => h.wing === 'bilgi' && h.cosine >= MIN_COSINE);
}

// ─── komutlar ─────────────────────────────────────────────────────────────────

function cmdAra(args) {
  const query = args.pos.slice(1).join(' ').trim();
  if (!query) fail('kullanım: bilgi ara "<soru>"');
  const p = paths();
  const ajan = process.env.AGENT_ID || 'bilinmeyen';
  const limit = Math.max(1, Math.min(10, Number(args.one('sonuc')) || 5));
  const notes = loadNotes(p.notes);
  const bySlug = new Map(notes.map((n) => [n.slug, n]));
  const found = new Map();
  for (const h of keywordSearch(notes, query)) found.set(h.slug, h.score);
  for (const h of semanticHits(query, limit)) {
    const slug = path.basename(h.source).replace(/\.md$/, '');
    if (bySlug.has(slug)) found.set(slug, Math.max(found.get(slug) || 0, h.cosine));
  }
  // --proje verilirse o projenin notları öne alınır (diğerleri yine gelir).
  const proje = (args.one('proje') || '').trim().toLowerCase();
  const boost = (slug) => (proje && bySlug.get(slug).meta.proje === proje ? 1 : 0);
  const ranked = [...found.entries()].sort((a, b) => boost(b[0]) - boost(a[0]) || b[1] - a[1]).slice(0, limit).map(([slug]) => bySlug.get(slug));
  const now = Date.now();
  const credited = creditSavings(readJsonl(p.usage), ajan, ranked.map((n) => ({ slug: n.slug, maliyet: n.meta.maliyet_token })), now);
  appendUsage(p.usage, [{ kind: 'ara', ajan, soru: query.slice(0, 200), isabet: ranked.length, ts: now }, ...credited]);

  if (!ranked.length) {
    process.stdout.write(`Ortak bilgide "${query}" ile ilgili kayıt yok. Araştır, sonra sonucu kaydet:\n  bilgi kaydet --konu "<başlık>" --etiket <etiketler> --kaynak <url> --metin "<bulgular>"\n`);
    return;
  }
  process.stdout.write(`Ortak bilgide ${ranked.length} kayıt bulundu — önce bunları kullan, aynı konuyu yeniden araştırma:\n\n`);
  for (const n of ranked) {
    const body = n.body.replace(/^#.*\n/, '').trim().replace(/\s+/g, ' ');
    process.stdout.write(`■ ${n.meta.proje ? `[${n.meta.proje}] ` : ''}${n.meta.konu}  [${n.slug}]\n  ${n.meta.ajan} · ${n.meta.tarih}${n.meta.etiketler.length ? ` · ${n.meta.etiketler.join(', ')}` : ''}\n`);
    process.stdout.write(`  ${body.slice(0, 400)}${body.length > 400 ? '…' : ''}\n`);
    if (n.meta.kaynaklar.length) process.stdout.write(`  kaynak: ${n.meta.kaynaklar.join(' · ')}\n`);
    process.stdout.write(`  tamamı: bilgi goster ${n.slug}\n\n`);
  }
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function cmdKaydet(args) {
  const konu = (args.one('konu') || '').trim();
  if (!konu) fail('kullanım: bilgi kaydet --konu "<başlık>" [--proje <id>] [--etiket a,b] [--kaynak URL] [--metin "…" | stdin]');
  const metin = (args.one('metin') || readStdin()).trim();
  if (!metin) fail('kaydedilecek metin yok (--metin ya da stdin)');
  const p = paths();
  const ajan = process.env.AGENT_ID || 'bilinmeyen';
  const etiketler = (args.flags.etiket || []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const kaynaklar = (args.flags.kaynak || []).map((s) => s.trim()).filter(Boolean);
  const proje = (args.one('proje') || '').trim().toLowerCase() || undefined;
  const now = Date.now();
  const usage = readJsonl(p.usage);
  const last = usage.filter((u) => u.kind === 'kaydet' && u.ajan === ajan).reduce((m, u) => Math.max(m, u.ts), 0);
  const since = Math.max(last, now - COST_WINDOW_MS);
  let maliyet = agentTokensSince(readJsonl(p.ledger), ajan, since);
  let maliyetKaynagi = 'olcum';
  if (!maliyet) { maliyet = Math.ceil(metin.length / 4); maliyetKaynagi = 'tahmin'; }

  fs.mkdirSync(p.notes, { recursive: true });
  const slug = slugify(konu);
  const file = path.join(p.notes, `${slug}.md`);
  const notes = loadNotes(p.notes);
  const ilgili = relatedSlugs({ konu, etiketler }, notes, slug);
  if (fs.existsSync(file)) {
    // Aynı konu: güncelleme olarak ekle, maliyetleri topla.
    const prev = parseNote(fs.readFileSync(file, 'utf8'));
    const merged = buildNote({
      konu: prev.meta.konu || konu, ajan: prev.meta.ajan || ajan, proje: prev.meta.proje || proje, tarih: new Date(now).toISOString(),
      etiketler: [...new Set([...prev.meta.etiketler, ...etiketler])],
      kaynaklar: [...new Set([...prev.meta.kaynaklar, ...kaynaklar])],
      maliyet: prev.meta.maliyet_token + maliyet,
      maliyetKaynagi: prev.meta.maliyet_kaynagi === 'olcum' && maliyetKaynagi === 'olcum' ? 'olcum' : 'tahmin',
      ilgili: [...new Set([...prev.meta.ilgili, ...ilgili])],
      metin: `${prev.body.replace(/^\s*#.*\n/, '').trim()}\n\n## Güncelleme ${new Date(now).toISOString().slice(0, 10)} (${ajan})\n\n${metin}`
    });
    fs.writeFileSync(file, merged, 'utf8');
  } else {
    fs.writeFileSync(file, buildNote({ konu, ajan, proje, tarih: new Date(now).toISOString(), etiketler, kaynaklar, maliyet, maliyetKaynagi, ilgili, metin }), 'utf8');
  }
  appendUsage(p.usage, [{ kind: 'kaydet', ajan, not: slug, maliyet, ts: now }]);
  process.stdout.write(`Kaydedildi: ${slug} (${maliyetKaynagi === 'olcum' ? '' : '~'}${maliyet} token)${ilgili.length ? ` · ilgili: ${ilgili.join(', ')}` : ''}\n${file}\n`);
}

function cmdListe() {
  const notes = loadNotes(paths().notes).sort((a, b) => String(b.meta.tarih).localeCompare(String(a.meta.tarih)));
  if (!notes.length) { process.stdout.write('Henüz kayıtlı bilgi yok.\n'); return; }
  for (const n of notes) process.stdout.write(`${n.slug}  —  ${n.meta.konu}  (${n.meta.ajan}, ${String(n.meta.tarih).slice(0, 10)})\n`);
}

function cmdGoster(args) {
  const slug = args.pos[1];
  if (!slug) fail('kullanım: bilgi goster <slug>');
  const file = path.join(paths().notes, `${slugify(slug)}.md`);
  try { process.stdout.write(fs.readFileSync(file, 'utf8')); } catch { fail(`not bulunamadı: ${slug}`); }
}

/** Bilgi grafı: düğümler = notlar, kenarlar = `ilgili` bağları (iki yönlü). */
function cmdGraf() {
  const notes = loadNotes(paths().notes);
  if (!notes.length) { process.stdout.write('Henüz kayıtlı bilgi yok.\n'); return; }
  const edges = new Set();
  for (const n of notes) for (const r of n.meta.ilgili) edges.add([n.slug, r].sort().join(' — '));
  process.stdout.write(`Bilgi grafı: ${notes.length} not, ${edges.size} bağ\n\n`);
  for (const n of notes) process.stdout.write(`● ${n.slug}: ${n.meta.konu}${n.meta.etiketler.length ? ` [${n.meta.etiketler.join(', ')}]` : ''}\n`);
  if (edges.size) process.stdout.write(`\n${[...edges].map((e) => `  ${e}`).join('\n')}\n`);
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args.pos[0];
  if (cmd === 'ara') return cmdAra(args);
  if (cmd === 'kaydet') return cmdKaydet(args);
  if (cmd === 'liste') return cmdListe();
  if (cmd === 'goster') return cmdGoster(args);
  if (cmd === 'graf') return cmdGraf();
  process.stdout.write('kullanım: bilgi ara "<soru>" | kaydet --konu "<başlık>" … | liste | goster <slug> | graf\n');
  process.exit(cmd ? 1 : 0);
}

module.exports = {
  slugify, buildNote, parseNote, keywordSearch, parseMempalaceOutput,
  agentTokensSince, relatedSlugs, creditSavings, summarize
};

if (require.main === module) main(process.argv.slice(2));
