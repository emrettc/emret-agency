'use strict';

/**
 * Capability tags are routing hints: the human sets them in Add/Edit Agent, they
 * persist into the hive registry, and the project lead sees them in its LIVE
 * ROSTER so it can pick a matching owner. These tests pin each hop of that path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { normalizeCapabilities, MAX_CAPABILITIES, CAPABILITY_PRESETS, CAPABILITY_GROUPS } = loadTs('src/shared/capabilities.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-caps-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Proje Lideri', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'can-1', name: 'Can', provider: 'claude', cwd: home });
  return { home, hive };
}

function snapshot(hive, canCaps) {
  hive.writeFleetSnapshot({
    ts: Date.now() - 2000,
    agents: [
      { id: 'god-1', name: 'Proje Lideri', role: 'orchestrator', isGod: true, lastActiveSecAgo: 5 },
      { id: 'can-1', name: 'Can', role: 'agent', lastActiveSecAgo: 30, capabilities: canCaps }
    ]
  });
}

test('normalizeCapabilities trims, de-duplicates case-insensitively and caps the list', () => {
  assert.deepEqual(normalizeCapabilities(['  test ', 'Test', 'kod   yazma', '', 42, null]), ['test', 'kod yazma']);
  assert.deepEqual(normalizeCapabilities('test'), [], 'a non-array is not a tag list');
  const many = Array.from({ length: 20 }, (_, i) => `etiket ${i}`);
  assert.equal(normalizeCapabilities(many).length, MAX_CAPABILITIES);
  assert.equal(normalizeCapabilities(['x'.repeat(100)])[0].length, 40, 'same 40-char cap as the hire importer');
  // Turkish casing: İ/i and I/ı must collapse the way a Turkish reader expects.
  assert.deepEqual(normalizeCapabilities(['İnceleme', 'inceleme']), ['İnceleme']);
});

test('every preset survives normalization unchanged', () => {
  for (const g of CAPABILITY_GROUPS) assert.deepEqual(normalizeCapabilities([...g.tags]), [...g.tags]);
  for (const g of CAPABILITY_GROUPS) assert.ok(g.tags.length <= MAX_CAPABILITIES, `every preset in ${g.key} must be selectable at once`);
});

test('patchAgentCapabilities persists to registry.json and identity.md', async (t) => {
  const { home, hive } = await floor(t);
  const res = hive.patchAgentCapabilities('can-1', ['kod yazma', 'test', 'Test']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.capabilities, ['kod yazma', 'test']);
  const reg = JSON.parse(fs.readFileSync(path.join(home, 'hive', 'registry.json'), 'utf8'));
  assert.deepEqual(reg.agents['can-1'].capabilities, ['kod yazma', 'test']);
  const identity = fs.readFileSync(path.join(home, 'hive', 'agents', 'can-1', 'identity.md'), 'utf8');
  assert.match(identity, /kod yazma, test/);
});

test('patchAgentCapabilities can clear the tags and rejects unknown agents', async (t) => {
  const { hive } = await floor(t);
  hive.patchAgentCapabilities('can-1', ['test']);
  assert.deepEqual(hive.patchAgentCapabilities('can-1', []).capabilities, []);
  assert.equal(hive.patchAgentCapabilities('nobody', ['test']).ok, false);
});

test('the lead sees capabilities in the LIVE ROSTER and is told to route by them', async (t) => {
  const { hive } = await floor(t);
  snapshot(hive, ['kod yazma', 'test']);
  const line = hive.rosterContext();
  assert.match(line, /can-1 "Can" \(agent, capabilities: kod yazma \/ test,/);
  assert.match(line, /prefer the agent whose capabilities match the task/);
  assert.ok(!line.includes('\n'), 'still a single compact line');
});

test('no tags anywhere → no capabilities text in the roster at all', async (t) => {
  const { hive } = await floor(t);
  snapshot(hive, undefined);
  const line = hive.rosterContext();
  assert.ok(!line.includes('capabilities'), 'an untagged floor must not grow the roster');
});
