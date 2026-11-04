'use strict';

/**
 * Tek ofis, ortak ajanlar, etiketli projeler (src/shared/officeProjects.ts):
 * görev → proje (alan ya da başlık öneki), ajan → o an çalıştığı proje,
 * token artışının projelere dağıtılması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const P = loadTs('src/shared/officeProjects.ts');

const PROJECTS = P.normalizeOfficeProjects([
  { id: 'ilanveral', name: 'ilanveral.com', color: 'sky', dir: 'C:\\Users\\Emre\\projects\\ilanveral' },
  { id: 'merge-up', name: 'Merge Up', color: 'lemon', aliases: ['mergeup'] },
  { id: 'glenda', name: 'Glenda', color: 'coral' }
]);

test('normalizeOfficeProjects: geçersizler düşer, renk ve kimlik düzelir', () => {
  const out = P.normalizeOfficeProjects([
    { id: 'a', name: 'A' },
    { id: 'a', name: 'tekrar' },
    { name: 'Kimliksiz Proje' },
    { id: 'x' },
    'çöp'
  ]);
  assert.deepEqual(out.map((p) => p.id), ['a', 'kimliksiz-proje']);
  assert.ok(out.every((p) => typeof p.color === 'string' && p.color));
});

test('projectOfTask: önce proje alanı, sonra başlık öneki (ad ya da takma ad)', () => {
  assert.equal(P.projectOfTask({ proje: 'glenda', title: 'ilanveral.com — X' }, PROJECTS), 'glenda');
  assert.equal(P.projectOfTask({ title: 'ilanveral.com — Sprint 2' }, PROJECTS), 'ilanveral');
  assert.equal(P.projectOfTask({ title: 'Merge Up - iOS portu' }, PROJECTS), 'merge-up');
  assert.equal(P.projectOfTask({ title: 'MergeUp — ASO' }, PROJECTS), 'merge-up');
  assert.equal(P.projectOfTask({ title: 'Genel bakım' }, PROJECTS), null);
  assert.equal(P.projectOfTask({ proje: 'bilinmeyen', title: 'Glenda — rapor' }, PROJECTS), 'glenda');
});

test('currentProjects: ajanın "doing" görevlerinin projeleri', () => {
  const tasks = [
    { id: '1', title: 'ilanveral.com — a', status: 'doing', assignee: 'dev' },
    { id: '2', title: 'Glenda — b', status: 'done', assignee: 'dev' },
    { id: '3', proje: 'merge-up', title: 'c', status: 'doing', assignee: 'tester' },
    { id: '4', title: 'Glenda — d', status: 'doing', assignee: 'tester' }
  ];
  const cur = P.currentProjects(tasks, PROJECTS);
  assert.deepEqual(cur.dev, ['ilanveral']);
  assert.deepEqual(cur.tester, ['merge-up', 'glenda']);
  assert.equal(cur.god, undefined);
});

test('attributeSpend: artış ajanın o anki projesine (birden çoksa eşit), yoksa genel', () => {
  const state = { last: { dev: { tokens: 1000, usd: 1 }, tester: { tokens: 500, usd: 0.5 } }, byProject: {} };
  const fleet = [
    { id: 'dev', tokens: 1600, usd: 1.6 },
    { id: 'tester', tokens: 900, usd: 0.9 },
    { id: 'god', tokens: 50, usd: 0.05 },      // ilk görülüş: taban, dağıtılmaz
    { id: 'reset', tokens: 10, usd: 0 }
  ];
  state.last.reset = { tokens: 99999, usd: 9 }; // sayaç sıfırlanmış: negatif artış sayılmaz
  const next = P.attributeSpend(state, fleet, { dev: ['ilanveral'], tester: ['merge-up', 'glenda'] });
  assert.deepEqual(next.byProject.ilanveral, { tokens: 600, usd: 0.6 });
  assert.deepEqual(next.byProject['merge-up'], { tokens: 200, usd: 0.2 });
  assert.deepEqual(next.byProject.glenda, { tokens: 200, usd: 0.2 });
  assert.equal(next.byProject[P.GENERAL_PROJECT], undefined);
  assert.deepEqual(next.last.god, { tokens: 50, usd: 0.05 });
  assert.deepEqual(next.last.reset, { tokens: 10, usd: 0 });
  // İkinci tur: god görevsiz harcarsa "genel"e.
  const again = P.attributeSpend(next, [{ id: 'god', tokens: 150, usd: 0.15 }], {});
  assert.deepEqual(again.byProject[P.GENERAL_PROJECT], { tokens: 100, usd: 0.1 });
  assert.deepEqual(again.byProject.ilanveral, { tokens: 600, usd: 0.6 }, 'önceki toplamlar korunur');
});

test('OfficeProjectsService: kaydet, örnekle, özet (ajan projesi + görev projesi + soru)', (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { OfficeProjectsService } = loadTs('src/main/officeProjects.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ofis-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = path.join(home, 'hive');
  fs.mkdirSync(hive);
  const svc = new OfficeProjectsService(() => hive);
  assert.equal(svc.save([{ name: 'ilanveral.com', color: 'sky' }, { name: 'Glenda' }]).ok, true);
  assert.deepEqual(svc.list().map((p) => p.id), ['ilanveral', 'glenda']);

  fs.writeFileSync(path.join(hive, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'ilanveral.com — spes', status: 'doing', assignee: 'dev' },
    { id: 't2', proje: 'glenda', title: 'Ölçüm', status: 'blocked', assignee: 'god', humanQA: [{ q: 'İkas mı?' }] }
  ] }));
  fs.writeFileSync(path.join(home, 'roster.json'), JSON.stringify({ agents: [{ id: 'dev', status: 'working' }, { id: 'god', status: 'idle' }] }));
  const fleet = (dev, god) => fs.writeFileSync(path.join(hive, 'fleet.json'), JSON.stringify({ agents: [
    { id: 'dev', name: 'Developer', tokens: dev, usd: dev / 1000 }, { id: 'god', name: 'Lider', isGod: true, tokens: god, usd: 0 }
  ] }));
  fleet(1000, 100); svc.sample();
  fleet(1500, 300); svc.sample();

  const o = svc.overview();
  assert.deepEqual(o.spend.ilanveral, { tokens: 500, usd: 0.5 });
  assert.deepEqual(o.spend.genel, { tokens: 200, usd: 0 }, 'god görevi "doing" değil ⇒ genel');
  assert.deepEqual(o.team.find((a) => a.id === 'dev').projects, ['ilanveral']);
  assert.deepEqual(o.tasks.map((x) => [x.id, x.proje, x.question ?? null]), [['t1', 'ilanveral', null], ['t2', 'glenda', 'İkas mı?']]);
});
