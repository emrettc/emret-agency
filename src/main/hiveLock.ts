/**
 * One instance per workspace (harnessHome).
 *
 * Before Phase 3 the app-wide single-instance lock guaranteed that only one
 * process ever touched a hive. Project profiles (src/main/profile.ts) give each
 * instance its own lock, so nothing stopped two instances from pointing at the
 * SAME harnessHome — and then both spawn the same agent ids, both run the
 * router, and both write registry.json and commit to the hive repo. This lock
 * closes that gap.
 *
 * The lock is a small JSON file in the workspace root (outside the hive git
 * repo). A lock counts as HELD only while its owner process is alive AND the
 * owner keeps touching the file (heartbeat every 30s, stale after 90s). The
 * heartbeat is what makes a crashed instance's lock expire, and what keeps a
 * recycled Windows PID from looking like a live owner forever.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = '.tutucu-ofis.lock';
export const HEARTBEAT_MS = 30_000;
export const STALE_MS = 90_000;

export interface LockInfo {
  pid: number;
  profile: string | null;
  startedAt: string;
}

export type AcquireResult = { ok: true } | { ok: false; owner: LockInfo };

function lockPath(home: string): string {
  return join(home, LOCK_FILE);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = the process exists but belongs to someone else: still alive.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The live owner of `home`'s lock, or null when it is free, stale, ours, or unreadable. */
export function lockOwner(home: string, now = Date.now(), selfPid = process.pid): LockInfo | null {
  const p = lockPath(home);
  if (!existsSync(p)) return null;
  try {
    const info = JSON.parse(readFileSync(p, 'utf8')) as LockInfo;
    if (info.pid === selfPid) return null;
    if (now - statSync(p).mtimeMs > STALE_MS) return null;
    return pidAlive(info.pid) ? info : null;
  } catch {
    return null; // a torn or foreign file is not a reason to lock the user out
  }
}

/** Claim `home` for this process. Atomic write (temp + rename); never throws. */
export function acquireLock(home: string, profile: string | null, selfPid = process.pid): AcquireResult {
  const owner = lockOwner(home, Date.now(), selfPid);
  if (owner) return { ok: false, owner };
  try {
    mkdirSync(home, { recursive: true });
    const info: LockInfo = { pid: selfPid, profile, startedAt: new Date().toISOString() };
    const tmp = `${lockPath(home)}.${selfPid}.tmp`;
    writeFileSync(tmp, JSON.stringify(info), 'utf8');
    renameSync(tmp, lockPath(home));
  } catch {
    // An unwritable workspace fails loudly elsewhere (mkdir/hive bootstrap);
    // refusing to start over the lock alone would only hide that error.
  }
  return { ok: true };
}

/** Refresh our lock's mtime so peers keep seeing it as live. */
export function touchLock(home: string, selfPid = process.pid): void {
  const p = lockPath(home);
  try {
    const info = JSON.parse(readFileSync(p, 'utf8')) as LockInfo;
    if (info.pid !== selfPid) return;
    const t = new Date();
    utimesSync(p, t, t);
  } catch { /* gone or replaced — the next acquire decides */ }
}

/** Drop our lock (only if it is still ours). */
export function releaseLock(home: string, selfPid = process.pid): void {
  const p = lockPath(home);
  try {
    const info = JSON.parse(readFileSync(p, 'utf8')) as LockInfo;
    if (info.pid === selfPid) unlinkSync(p);
  } catch { /* nothing to release */ }
}

/** Turkish, user-facing explanation of who holds a workspace. */
export function describeOwner(owner: LockInfo): string {
  const who = owner.profile ? `"${owner.profile}" projesi` : 'Merkez';
  return `Bu çalışma alanı şu anda başka bir Emret Agency penceresinde açık (${who}, süreç ${owner.pid}). `
    + 'Aynı çalışma alanı iki pencerede açılamaz; o pencereyi kapatın ya da başka bir klasör seçin.';
}
