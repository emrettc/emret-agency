'use strict';

/**
 * The human's inbox collects everything addressed to the human — approvals,
 * ASK ME questions, messages to "human" — once each, and carries replies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kutu-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Proje Lideri', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'can-1', name: 'Can', provider: 'claude', cwd: home });
  const seen = [];
  hive.setHumanInboxObserver((i) => seen.push(i));
  const inbox = (id) => {
    const dir = path.join(home, 'hive', 'agents', id, 'inbox');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  };
  return { home, hive, seen, inbox };
}

test('a message to "human" lands in the inbox, notifies, and still reaches the lead', async (t) => {
  const { hive, seen, inbox } = await floor(t);
  hive.send({ to: 'human', act: 'query', subject: 'Hangi renk?', body: 'Mavi mi yeşil mi?' }, 'can-1');
  const [item] = hive.humanInbox();
  assert.equal(item.kind, 'mesaj');
  assert.equal(item.from, 'can-1');
  assert.equal(item.read, false);
  assert.equal(seen.length, 1, 'one notification');
  assert.ok(inbox('god').some((m) => m.subject === 'Hangi renk?'), 'lead still gets it');
});

test('the human replies from the inbox; the agent gets it and the thread keeps it', async (t) => {
  const { hive, seen, inbox } = await floor(t);
  hive.send({ to: 'human', act: 'query', subject: 'Hangi renk?', body: 'x' }, 'can-1');
  const id = hive.humanInbox()[0].id;
  assert.equal(hive.replyFromHuman(id, '  ').ok, false);
  assert.equal(hive.replyFromHuman(id, 'Mavi').ok, true);
  const got = inbox('can-1').find((m) => m.from === 'human');
  assert.equal(got.body, 'Mavi');
  const items = hive.humanInbox();
  assert.equal(items.find((i) => i.id === id).read, true);
  assert.ok(items.some((i) => i.kind === 'giden' && i.to === 'can-1'));
  assert.equal(seen.length, 1, 'the human is not notified of their own reply');
});

test('approvals appear once and turn read when answered', async (t) => {
  const { hive } = await floor(t);
  hive.send({ to: 'onay', act: 'propose', subject: 'Bütçe', body: 'b', cost: '100 TL' }, 'can-1');
  const item = hive.humanInbox().find((i) => i.kind === 'onay');
  assert.match(item.body, /100 TL/);
  assert.equal(hive.replyFromHuman(item.id, 'evet').ok, false, 'approvals are answered on the queue');
  hive.answerApproval(item.approvalId, 'onaylandi', '');
  assert.equal(hive.humanInbox().find((i) => i.id === item.id).read, true);
});

test('open ASK ME questions are mirrored once; answered ones turn read', async (t) => {
  const { hive, home, seen } = await floor(t);
  const tasks = path.join(home, 'hive', 'tasks.json');
  const write = (a) => fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: 't1', title: 'Logo', assignee: 'can-1', status: 'blocked', humanQA: [{ q: 'Hangi logo?', askedAt: '2026-10-27T10:00:00Z', ...(a ? { a } : {}) }] }] }));
  write();
  assert.equal(hive.syncHumanQuestions(), 1);
  assert.equal(hive.syncHumanQuestions(), 0, 'no duplicate');
  assert.equal(seen.length, 1);
  write('A');
  hive.syncHumanQuestions();
  assert.equal(hive.humanInbox()[0].read, true);
});

test('the Slack inbox mirror only posts to an explicit user or channel id', async () => {
  const { postSlackMessage } = loadTs('src/main/slack.ts');
  assert.equal((await postSlackMessage({ botToken: '', channel: 'U0CCPLWKRED', text: 'x' })).ok, false);
  for (const bad of ['', 'genel', 'xapp-1-A0-123', 'https://slack.com/x']) {
    const r = await postSlackMessage({ botToken: 'xoxb-test', channel: bad, text: 'x' });
    assert.equal(r.error, 'invalid target id', bad);
  }
});

test('an ASK ME question can be answered straight from the inbox', async (t) => {
  const { hive, home, inbox } = await floor(t);
  const tasks = path.join(home, 'hive', 'tasks.json');
  fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: 't9', title: 'Logo', status: 'blocked', humanQA: [{ q: 'Hangi logo?', askedAt: '2026-10-27T11:00:00Z' }] }] }));
  hive.syncHumanQuestions();
  const q = hive.humanInbox().find((i) => i.kind === 'soru');
  assert.equal(hive.replyFromHuman(q.id, 'Mavi olan').ok, true);
  const card = JSON.parse(fs.readFileSync(tasks, 'utf8')).tasks[0];
  assert.equal(card.humanQA[0].a, 'Mavi olan', 'answer recorded on the card');
  assert.ok(card.humanQA[0].answeredAt);
  assert.ok(inbox('god').some((m) => /KULLANICI YANITI/.test(m.subject) && /Mavi olan/.test(m.body)), 'lead told');
  assert.equal(hive.humanInbox().find((i) => i.id === q.id).read, true);
  assert.equal(hive.replyFromHuman(q.id, 'tekrar').error, 'already answered');
});

test('a needs_human question to the lead is mirrored and answerable from the inbox', async (t) => {
  const { hive, inbox } = await floor(t);
  hive.send({ to: 'god', act: 'query', subject: 'Bütçe sınırı?', body: 'x', needs_human: true }, 'can-1');
  hive.send({ to: 'god', act: 'inform', subject: 'Rapor', body: 'y' }, 'can-1');
  const items = hive.humanInbox();
  assert.equal(items.length, 1, 'only the needs_human mail is mirrored');
  assert.equal(items[0].kind, 'mesaj');
  assert.equal(hive.replyFromHuman(items[0].id, 'Tamam').ok, true);
  assert.ok(inbox('can-1').some((m) => m.from === 'human' && m.body === 'Tamam'));
});
