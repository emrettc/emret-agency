'use strict';

/**
 * Expertise guides: every capability tag has a Markdown guide in
 * <hive>/uzmanlik/, the agent is pointed at its guides and works under the
 * lead's approval, and the lead is told it supervises every field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { expertiseSlug, expertiseFile, guideFor, BUILTIN_GUIDES } = loadTs('src/shared/expertise.ts');
const { CAPABILITY_PRESETS } = loadTs('src/shared/capabilities.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-exp-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Proje Lideri', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'reklam-1', name: 'Reklamcı', provider: 'claude', cwd: home, capabilities: ['reklam yönetimi', 'Meta pikseli'] });
  return { home, hive, guides: path.join(home, 'hive', 'uzmanlik') };
}

test('slugs are ASCII file names, Turkish letters folded', () => {
  assert.equal(expertiseSlug('reklam yönetimi'), 'reklam-yonetimi');
  assert.equal(expertiseSlug('altyapı / DevOps'), 'altyapi-devops');
  assert.equal(expertiseSlug('İçerik Yazarlığı'), 'icerik-yazarligi');
  assert.equal(expertiseSlug('  !!  '), '');
  assert.equal(expertiseFile('SEO'), 'uzmanlik/seo.md');
});

test('every preset has a built-in guide; unknown tags get a skeleton', () => {
  for (const tag of CAPABILITY_PRESETS) assert.ok(BUILTIN_GUIDES[tag], `missing guide for ${tag}`);
  assert.match(guideFor('Reklam Yönetimi'), /Onay gerektirenler/);
  assert.match(guideFor('Meta pikseli'), /^# Meta pikseli — uzmanlık rehberi/);
});

test('guides are seeded for presets and for custom tags, never overwritten', async (t) => {
  const { hive, guides } = await floor(t);
  assert.ok(fs.existsSync(path.join(guides, 'reklam-yonetimi.md')));
  assert.ok(fs.existsSync(path.join(guides, 'meta-pikseli.md')), 'custom tag gets a skeleton');
  fs.writeFileSync(path.join(guides, 'reklam-yonetimi.md'), 'insanın kuralları', 'utf8');
  hive.ensureExpertiseGuides(['reklam yönetimi']);
  hive.patchAgentCapabilities('reklam-1', ['reklam yönetimi', 'SEO']);
  assert.equal(fs.readFileSync(path.join(guides, 'reklam-yonetimi.md'), 'utf8'), 'insanın kuralları');
});

test('identity.md lists the agent\'s guides', async (t) => {
  const { home } = await floor(t);
  const identity = fs.readFileSync(path.join(home, 'hive', 'agents', 'reklam-1', 'identity.md'), 'utf8');
  assert.match(identity, /Expertise guides/);
  assert.ok(identity.includes(path.join(home, 'hive', 'uzmanlik', 'reklam-yonetimi.md')));
});

test('workers file human-only decisions to the approval queue; the lead supervises but cannot approve them', async (t) => {
  const { hive, home } = await floor(t);
  const reg = hive.registry();
  const worker = hive.injectedPrompt(reg.agents['reklam-1'], path.join(home, 'hive', 'agents', 'reklam-1'), path.join(home, 'hive'), false, false);
  const lead = hive.injectedPrompt(reg.agents.god, path.join(home, 'hive', 'agents', 'god'), path.join(home, 'hive'), false, false);
  assert.match(worker, /EXPERTISE AND SUPERVISION/);
  assert.match(worker, /"act":"propose"/);
  assert.match(worker, /"to":"onay"/);
  assert.match(worker, /Never act before "agree"/);
  assert.match(lead, /SUPERVISOR OF EVERY FIELD/);
  assert.match(lead, /decided by the human ALONE/);
  assert.match(lead, /Never agree to such a step yourself/);
  assert.doesNotMatch(lead, /EXPERTISE AND SUPERVISION/);
  for (const p of [worker, lead]) {
    const line = p.split('\n').find((l) => /SUPERVISOR OF EVERY FIELD|EXPERTISE AND SUPERVISION/.test(l));
    assert.ok(/^[\x20-\x7e]*$/.test(line.replace(home, '')), 'prompt line stays ASCII (cmd.exe argv)');
  }
});
