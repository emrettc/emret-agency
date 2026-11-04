'use strict';

/**
 * Phase 3 project profiles: `--profile=<id>` gives a project instance its own
 * userData folder. A bad id must refuse to start rather than fall back to the
 * Merkez profile, and the profile module must run before anything reads
 * userData — both pinned here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { parseProfileArg, isValidProfileId, profileIdFromName } = loadTs('src/shared/profile.ts');
const root = path.join(__dirname, '..');

test('no flag means the Merkez instance', () => {
  assert.equal(parseProfileArg(['electron.exe', '.', '--inspect']), null);
});

test('both flag spellings are accepted', () => {
  assert.equal(parseProfileArg(['x', '--profile=musteri-portali']), 'musteri-portali');
  assert.equal(parseProfileArg(['x', '--profile', 'erp-2']), 'erp-2');
});

test('a malformed id throws instead of silently opening Merkez', () => {
  for (const bad of ['', 'Büyük', '../merkez', 'a/b', '-x', 'x-', 'a'.repeat(41), 'with space']) {
    assert.throws(() => parseProfileArg([`--profile=${bad}`]), /invalid --profile/, `accepted ${JSON.stringify(bad)}`);
  }
  assert.throws(() => parseProfileArg(['--profile']), /invalid --profile/, 'a dangling flag must not be ignored');
});

test('ids are folder-safe', () => {
  assert.ok(isValidProfileId('a'));
  assert.ok(isValidProfileId('proje-1'));
  assert.ok(!isValidProfileId('..'));
  assert.ok(!isValidProfileId('CON'), 'uppercase rejected (and so are reserved-looking names in that form)');
});

test('profileIdFromName folds Turkish letters and punctuation', () => {
  assert.equal(profileIdFromName('Müşteri Portalı'), 'musteri-portali');
  assert.equal(profileIdFromName('  ERP — Çağrı Merkezi!  '), 'erp-cagri-merkezi');
  assert.equal(profileIdFromName('İç Denetim'), 'ic-denetim');
  assert.equal(profileIdFromName('***'), '');
  assert.ok(profileIdFromName('x'.repeat(80)).length <= 40);
});

test('the profile module is the first import of the main entry', () => {
  const src = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  const firstImport = src.split('\n').find((l) => l.startsWith('import '));
  assert.match(firstImport, /^import \{ PROFILE_ID(, \w+)* \} from '\.\/profile';$/,
    'something now runs before --profile is applied and may read the Merkez userData');
});

test('only the Merkez instance registers the protocol handler', () => {
  const src = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  const i = src.indexOf("setAsDefaultProtocolClient('emrettc'");
  const guard = src.lastIndexOf('if (PROFILE_ID)', i);
  assert.ok(guard > 0 && i - guard < 400, 'protocol registration is not guarded by PROFILE_ID');
});
