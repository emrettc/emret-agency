'use strict';

/**
 * One instance per workspace. With project profiles each instance has its own
 * single-instance lock, so this file lock is the only thing stopping two
 * instances from driving the same hive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { acquireLock, lockOwner, touchLock, releaseLock, describeOwner, LOCK_FILE, STALE_MS } = loadTs('src/main/hiveLock.ts');

function home(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'md-lock-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// The parent of this test runner is alive for the whole run: a stand-in for
// "another live instance".
const OTHER_LIVE_PID = process.ppid;
// A pid that existed and is gone.
const DEAD_PID = spawnSync(process.execPath, ['-e', '0']).pid;

test('a free workspace is acquired and written atomically', (t) => {
  const h = home(t);
  assert.deepEqual(acquireLock(h, null), { ok: true });
  const info = JSON.parse(fs.readFileSync(path.join(h, LOCK_FILE), 'utf8'));
  assert.equal(info.pid, process.pid);
  assert.equal(info.profile, null);
  assert.deepEqual(fs.readdirSync(h).filter((f) => f.endsWith('.tmp')), [], 'no temp file left behind');
});

test('a workspace held by another live instance is refused', (t) => {
  const h = home(t);
  acquireLock(h, 'musteri-portali', OTHER_LIVE_PID);
  const res = acquireLock(h, null);
  assert.equal(res.ok, false);
  assert.equal(res.owner.profile, 'musteri-portali');
  assert.match(describeOwner(res.owner), /"musteri-portali" projesi/);
});

test('re-acquiring our own lock is fine', (t) => {
  const h = home(t);
  acquireLock(h, null);
  assert.equal(acquireLock(h, null).ok, true);
  assert.equal(lockOwner(h), null, 'our own lock is not a foreign owner');
});

test('a dead owner does not hold the workspace', (t) => {
  const h = home(t);
  acquireLock(h, 'eski', DEAD_PID);
  assert.equal(lockOwner(h), null);
  assert.equal(acquireLock(h, null).ok, true);
});

test('a live pid with a stale heartbeat does not hold it (recycled PID / hung owner)', (t) => {
  const h = home(t);
  acquireLock(h, 'eski', OTHER_LIVE_PID);
  const old = new Date(Date.now() - STALE_MS - 5_000);
  fs.utimesSync(path.join(h, LOCK_FILE), old, old);
  assert.equal(lockOwner(h), null);
});

test('touch refreshes only our own lock; release removes only our own lock', (t) => {
  const h = home(t);
  acquireLock(h, 'baska', OTHER_LIVE_PID);
  const p = path.join(h, LOCK_FILE);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(p, old, old);
  touchLock(h);
  assert.ok(fs.statSync(p).mtimeMs < Date.now() - 50_000, 'touched a lock it does not own');
  releaseLock(h);
  assert.ok(fs.existsSync(p), 'released a lock it does not own');

  const mine = home(t);
  acquireLock(mine, null);
  releaseLock(mine);
  assert.ok(!fs.existsSync(path.join(mine, LOCK_FILE)));
});

test('a corrupt lock file never locks the user out', (t) => {
  const h = home(t);
  fs.writeFileSync(path.join(h, LOCK_FILE), '{not json');
  assert.equal(lockOwner(h), null);
  assert.equal(acquireLock(h, null).ok, true);
});
