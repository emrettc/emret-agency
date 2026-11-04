'use strict';

/**
 * İnceleme ve Birleştirme Masası (src/main/reviewDesk.ts) gerçek git üzerinde:
 * ajan worktree'sindeki iş listelenir, test kapısı birleştirmeyi tutar, kirli ana
 * klasör ezilmez, birleştirme ve geri alma çalışır, reddetme dalı siler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { ReviewDesk } = loadTs('src/main/reviewDesk.ts');
const { addWorktree } = loadTs('src/main/git.ts');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function setup(t, { testScript } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-review-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const repo = path.join(home, 'proje');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'bir\n');
  if (testScript) fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: testScript } }));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'ilk');
  const wtRoot = path.join(home, 'worktrees');
  const wt = path.join(wtRoot, 'reklam');
  const r = await addWorktree(repo, wt, 'main');
  assert.equal(r.ok, true, r.error);
  git(wt, 'config', 'user.email', 't@t');
  git(wt, 'config', 'user.name', 't');
  const desk = new ReviewDesk(() => wtRoot, () => path.join(home, 'review-desk.json'));
  return { home, repo, wt, desk };
}

function commitInWorktree(wt, file, text, msg) {
  fs.writeFileSync(path.join(wt, file), text);
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', msg);
}

test('iş yokken masa boş; commit gelince kalem olur, fark görünür', async (t) => {
  const { wt, desk } = await setup(t);
  assert.deepEqual(await desk.list(), []);
  commitInWorktree(wt, 'b.txt', 'yeni\n', 'b ekle');
  const items = await desk.list();
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.branch, 'agent/reklam');
  assert.equal(it.agentId, 'reklam');
  assert.equal(it.baseBranch, 'main');
  assert.equal(it.ahead, 1);
  assert.equal(it.commits[0].subject, 'b ekle');
  assert.deepEqual(it.files.map((f) => f.path), ['b.txt']);
  const d = await desk.diff(it.id);
  assert.ok(d.ok && d.diff.includes('+yeni'));
});

test('birleştirme: kirli ana klasörü ezmez; temizken birleştirir, geri alınabilir', async (t) => {
  const { repo, wt, desk } = await setup(t);
  commitInWorktree(wt, 'b.txt', 'yeni\n', 'b ekle');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'kullanıcının yarım işi\n');
  const refused = await desk.merge('agent/reklam');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /kaydedilmemiş/);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'kullanıcının yarım işi\n', 'yarım iş ezilmedi');
  git(repo, 'checkout', '--', 'a.txt');

  const merged = await desk.merge('agent/reklam');
  assert.equal(merged.ok, true, merged.error);
  assert.ok(fs.existsSync(path.join(repo, 'b.txt')));
  assert.deepEqual(await desk.list(), [], 'birleşen iş masadan düşer');
  assert.equal(desk.merges()[0].sha, merged.sha);

  const undone = await desk.undo(merged.sha);
  assert.equal(undone.ok, true, undone.error);
  assert.ok(!fs.existsSync(path.join(repo, 'b.txt')), 'geri alma değişikliği kaldırdı');
  assert.equal(desk.merges()[0].reverted, true);
});

test('test kapısı: testi olan projede test geçmeden birleştirilmez; force ile geçer', async (t) => {
  const { wt, desk } = await setup(t, { testScript: 'node -e "process.exit(1)"' });
  commitInWorktree(wt, 'b.txt', 'yeni\n', 'b ekle');
  const it = (await desk.list())[0];
  assert.equal(it.hasTestScript, true);
  const noTests = await desk.merge(it.id);
  assert.equal(noTests.ok, false);
  assert.match(noTests.error, /Testler henüz çalıştırılmadı/);
  const run = await desk.runTests(it.id);
  assert.equal(run.ok, false, 'başarısız test');
  assert.equal((await desk.list())[0].tests.ok, false);
  const failed = await desk.merge(it.id);
  assert.match(failed.error, /Testler geçmedi/);
  const forced = await desk.merge(it.id, true);
  assert.equal(forced.ok, true, forced.error);
});

test('reddet: worktree ve dal silinir', async (t) => {
  const { repo, wt, desk } = await setup(t);
  commitInWorktree(wt, 'b.txt', 'yeni\n', 'b ekle');
  const r = await desk.reject('agent/reklam');
  assert.equal(r.ok, true, r.error);
  assert.ok(!fs.existsSync(wt));
  assert.ok(!git(repo, 'branch', '--list', 'agent/reklam'));
});

test('ana dal ilerlese de yalnız ajanın kendi değişiklikleri görünür (ayrılma noktasına göre fark)', async (t) => {
  const { repo, wt, desk } = await setup(t);
  commitInWorktree(wt, 'b.txt', 'ajanın işi\n', 'b ekle');
  // Dal açıldıktan sonra ana dala başka işler girer.
  fs.writeFileSync(path.join(repo, 'c.txt'), 'başkasının işi\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'değişti\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'ana dal ilerledi');
  const it = (await desk.list())[0];
  assert.deepEqual(it.files.map((f) => f.path), ['b.txt'], 'ana dala sonradan girenler ajanın değişikliği sayılmaz');
  const d = await desk.diff(it.id);
  assert.ok(d.diff.includes('+ajanın işi'));
  assert.ok(!d.diff.includes('başkasının işi'));
});
