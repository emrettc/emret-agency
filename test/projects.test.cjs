'use strict';

/** Phase 3.2 project registry: create, status from files, stop request, archive. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { ProjectRegistry, STOP_REQUEST_FILE } = loadTs('src/main/projects.ts');
const { LOCK_FILE } = loadTs('src/main/hiveLock.ts');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-proj-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const merkez = path.join(root, 'userData');
  const projectsRoot = path.join(root, 'Projeler');
  return { root, merkez, reg: new ProjectRegistry(merkez, projectsRoot), projectsRoot };
}

/** Pretend another live process (our parent) runs the project. */
function markRunning(dir) {
  fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, profile: 'x', startedAt: new Date().toISOString() }));
}

test('creating a project makes its folder, profile config and a Turkish-safe id', (t) => {
  const { reg, merkez, projectsRoot } = setup(t);
  const res = reg.create('Glenda Reklam Çalışması');
  assert.equal(res.ok, true);
  const p = res.project;
  assert.equal(p.id, 'glenda-reklam-calismasi');
  assert.equal(p.dir, path.join(projectsRoot, 'Glenda Reklam Çalışması'));
  assert.ok(fs.existsSync(p.dir));
  const cfg = JSON.parse(fs.readFileSync(path.join(merkez, 'profiles', p.id, 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { harnessHome: p.dir }, 'only the workspace is pre-set; the rest starts fresh');
  assert.equal(reg.list().length, 1);
});

test('names are deduplicated, empty names and shared folders refused', (t) => {
  const { reg } = setup(t);
  const a = reg.create('Site');
  const b = reg.create('site', path.join(os.tmpdir(), `md-proj-other-${process.pid}`));
  t.after(() => fs.rmSync(path.join(os.tmpdir(), `md-proj-other-${process.pid}`), { recursive: true, force: true }));
  assert.equal(b.project.id, 'site-2');
  assert.equal(reg.create('  ').ok, false);
  assert.equal(reg.create('!!!').ok, false);
  const clash = reg.create('Başka', a.project.dir);
  assert.equal(clash.ok, false);
  assert.match(clash.error, /Site/);
});

test('status is read from the project files', (t) => {
  const { reg } = setup(t);
  const { project } = reg.create('Durum');
  const hive = path.join(project.dir, 'hive');
  fs.mkdirSync(hive, { recursive: true });
  fs.writeFileSync(path.join(hive, 'fleet.json'), JSON.stringify({ ts: Date.now(), agents: [{ id: 'god', usd: 1.5, lastActiveSecAgo: 10 }, { id: 'a', usd: 0.5, lastActiveSecAgo: 9999 }] }));
  fs.writeFileSync(path.join(hive, 'tasks.json'), JSON.stringify({ tasks: [
    { id: '1', status: 'doing' }, { id: '2', status: 'blocked', humanQA: [{ q: 'Hangi?' }] }, { id: '3', status: 'done' }
  ] }));
  fs.writeFileSync(path.join(hive, 'onaylar.json'), JSON.stringify({ items: [{ id: 'x', status: 'bekliyor' }, { id: 'y', status: 'onaylandi' }] }));
  fs.writeFileSync(path.join(hive, 'insan-kutusu.json'), JSON.stringify({ items: [{ id: 'm', kind: 'mesaj', read: false }, { id: 'g', kind: 'giden', read: true }] }));
  const [s] = reg.status();
  assert.equal(s.running, false);
  assert.equal(s.agents, 2);
  assert.equal(s.activeAgents, 1);
  assert.equal(s.openTasks, 2);
  assert.equal(s.blockedTasks, 1);
  assert.equal(s.questions, 1);
  assert.equal(s.approvals, 1);
  assert.equal(s.unread, 1);
  assert.equal(s.costUsd, 2);
  markRunning(project.dir);
  assert.equal(reg.status()[0].running, true);
});

test('stop asks a running project; archive refuses while it runs', (t) => {
  const { reg } = setup(t);
  const { project } = reg.create('Kapat');
  assert.equal(reg.requestStop(project.id).ok, false, 'a closed project has nothing to stop');
  markRunning(project.dir);
  assert.equal(reg.setArchived(project.id, true).ok, false);
  assert.equal(reg.requestStop(project.id).ok, true);
  assert.ok(fs.existsSync(path.join(project.dir, STOP_REQUEST_FILE)));
  fs.rmSync(path.join(project.dir, LOCK_FILE));
  assert.equal(reg.setArchived(project.id, true).ok, true);
  assert.equal(reg.get(project.id).archived, true);
  assert.equal(reg.setArchived(project.id, false).ok, true);
  assert.equal(reg.get(project.id).archived, undefined);
});

test('detay: ajan listesi (roster durumu + fleet token), açık görevler ve bekleyen sorular', (t) => {
  const { reg } = setup(t);
  const p = reg.create('Detay').project;
  const hive = path.join(p.dir, 'hive');
  fs.mkdirSync(hive, { recursive: true });
  markRunning(p.dir);
  fs.writeFileSync(path.join(hive, 'fleet.json'), JSON.stringify({ ts: Date.now(), agents: [
    { id: 'lider', name: 'Lider', isGod: true, tokens: 820000, usd: 9.1, lastTool: 'Bash', lastActiveSecAgo: 5, inboxBacklog: 0 },
    { id: 'dev', name: 'Developer', tokens: 310000, usd: 3.2, lastActiveSecAgo: 900, inboxBacklog: 2 },
    { id: 'eski', name: 'Eski', tokens: 5, usd: 0, archived: true },
    { id: 'worker-bitti', name: 'Bitmiş worker', tokens: 7, usd: 0 }
  ] }));
  fs.writeFileSync(path.join(p.dir, 'roster.json'), JSON.stringify({ agents: [
    { id: 'lider', status: 'working', action: 'using Bash', provider: 'claude', model: 'claude-opus' },
    { id: 'dev', status: 'idle', action: 'boşta', provider: 'opencode', model: 'evren/glm-5.3' }
  ] }));
  fs.writeFileSync(path.join(hive, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'Ekran spesi', status: 'doing', assignee: 'dev' },
    { id: 't2', title: 'Eski iş', status: 'done' },
    { id: 't3', title: 'Ödeme', status: 'blocked', assignee: 'lider', humanQA: [{ q: 'iyzico mu PayTR mı?' }] }
  ] }));
  const s = reg.status()[0];
  assert.equal(s.tokens, 1130012, 'toplam token tüm fleet satırlarını sayar');
  assert.deepEqual(s.team.map((a) => [a.id, a.status, a.tokens, a.inboxBacklog]), [
    ['lider', 'working', 820000, 0],
    ['dev', 'idle', 310000, 2]
  ], 'arşivli ve roster\'da olmayan (bitmiş) worker listede yok; durum roster.json\'dan');
  assert.equal(s.team[0].action, 'using Bash');
  assert.equal(s.team[1].model, 'evren/glm-5.3');
  assert.deepEqual(s.taskList.map((x) => x.id), ['t1', 't3'], 'yalnız açık görevler');
  assert.deepEqual(s.questionList, [{ taskId: 't3', title: 'Ödeme', q: 'iyzico mu PayTR mı?' }]);
});

test('detay: proje kapalıyken ajanlar "kapalı" görünür', (t) => {
  const { reg } = setup(t);
  const p = reg.create('Kapali').project;
  fs.mkdirSync(path.join(p.dir, 'hive'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, 'hive', 'fleet.json'), JSON.stringify({ agents: [{ id: 'a', name: 'A', tokens: 1 }] }));
  fs.writeFileSync(path.join(p.dir, 'roster.json'), JSON.stringify({ agents: [{ id: 'a', status: 'working' }] }));
  assert.equal(reg.status()[0].team[0].status, 'off');
});
