'use strict';

/**
 * The human's approval queue: an agent files a decision with to:"onay", the
 * lead gets a copy but cannot answer it, and the human's verdict reaches both.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-onay-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Proje Lideri', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'reklam-1', name: 'Reklamcı', provider: 'claude', cwd: home, capabilities: ['reklam yönetimi'] });
  const inbox = (id) => {
    const dir = path.join(home, 'hive', 'agents', id, 'inbox');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  };
  return { home, hive, inbox };
}

test('to:"onay" files an approval with cost and files, and copies the lead', async (t) => {
  const { hive, inbox } = await floor(t);
  hive.send({ to: 'onay', act: 'propose', subject: 'Günlük bütçe 300 → 360 TL', body: '**Neden:** ROAS 4,2', cost: 'günlük +60 TL', files: ['C:\k\kare_v1.png', 42] }, 'reklam-1');
  const [a] = hive.approvals();
  assert.equal(a.status, 'bekliyor');
  assert.equal(a.from, 'reklam-1');
  assert.equal(a.cost, 'günlük +60 TL');
  assert.deepEqual(a.files, ['C:\k\kare_v1.png']);
  const lead = inbox('god');
  assert.equal(lead.length, 1);
  assert.match(lead[0].subject, /Onay kuyruğunda/);
  assert.match(lead[0].body, /sen onaylayamazsın/);
});

test('the human answers once; the agent and the lead both hear it', async (t) => {
  const { hive, inbox } = await floor(t);
  hive.send({ to: 'onay', act: 'propose', subject: 'Kampanya aç', body: 'x' }, 'reklam-1');
  const id = hive.approvals()[0].id;
  assert.equal(hive.answerApproval(id, 'tamam', '').ok, false, 'unknown verdicts are refused');
  const res = hive.answerApproval(id, 'revize', 'Görseli değiştir');
  assert.equal(res.ok, true);
  assert.equal(hive.approvals()[0].status, 'revize');
  assert.equal(hive.answerApproval(id, 'onaylandi', '').ok, false, 'an answered item stays answered');
  const toAgent = inbox('reklam-1').find((m) => /REVİZE/.test(m.subject));
  assert.ok(toAgent, 'agent got the verdict');
  assert.equal(toAgent.from, 'human');
  assert.equal(toAgent.act, 'request');
  assert.match(toAgent.body, /Görseli değiştir/);
  assert.ok(inbox('god').some((m) => /REVİZE/.test(m.subject)), 'lead got a copy');
});

test('an outdated generated PROTOCOL.md is replaced with the approval-queue version', async (t) => {
  const { hive, home } = await floor(t);
  const p = path.join(home, 'hive', 'PROTOCOL.md');
  fs.writeFileSync(p, 'old\n- There is NO separate human-approval queue. Human…\n', 'utf8');
  hive.ensureHive();
  assert.match(fs.readFileSync(p, 'utf8'), /HUMAN APPROVAL QUEUE/);
});
