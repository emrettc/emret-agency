/**
 * Applies `--profile=<id>` before anything else in the main process reads
 * userData. MUST be the first import of src/main/index.ts: config.ts, db.ts and
 * the single-instance lock all resolve `app.getPath('userData')`, and a module
 * that captured the Merkez path first would write one project's state into
 * another's folder.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { parseProfileArg } from '../shared/profile';

function applyProfile(): string | null {
  let id: string | null;
  try {
    id = parseProfileArg(process.argv);
  } catch (e) {
    // A malformed id must not fall back to the Merkez profile: refuse to start.
    console.error(`[profile] ${e instanceof Error ? e.message : String(e)} — quitting`);
    app.exit(2);
    return null;
  }
  if (!id) return null;
  const base = app.getPath('userData');
  app.setPath('userData', join(base, 'profiles', id));
  console.log(`[profile] ${id} → ${app.getPath('userData')}`);
  return id;
}

/** The project profile this instance runs, or null for the Merkez instance. */
export const PROFILE_ID: string | null = applyProfile();

/** The Merkez instance's userData folder, from any instance. */
export function merkezUserData(): string {
  const current = app.getPath('userData');
  return PROFILE_ID ? join(current, '..', '..') : current;
}
