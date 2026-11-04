'use strict';

/**
 * Devam noktası (src/shared/devam.ts): ajanın kısa "ne yapıyordum / sırada ne
 * var" notu her oturum başında verilir; boş şablon verilmez; çalışırken uzun
 * süre güncellenmezse bir kez hatırlatılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const D = loadTs('src/shared/devam.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

test('boş şablon verilmez, dolu devam noktası <devam> içinde verilir', () => {
  const tpl = D.devamTemplate('Faruk', 'faruk-1');
  assert.equal(D.devamHasContent(tpl), false);
  assert.equal(D.devamContext(tpl), null);
  assert.equal(D.devamContext(''), null);
  const filled = tpl.replace('## Sıradaki adım\n-', '## Sıradaki adım\n- logo.svg rengini düzelt');
  const ctx = D.devamContext(filled);
  assert.match(ctx, /<devam>[\s\S]*logo\.svg rengini düzelt[\s\S]*<\/devam>/);
  assert.match(ctx, /Sıradaki adım/);
  const long = D.devamContext('## Görev\n- ' + 'x'.repeat(D.DEVAM_MAX_CHARS + 500));
  assert.ok(long.length < D.DEVAM_MAX_CHARS + 600);
  assert.match(long, /kısaltıldı/);
});

test('hatırlatma: 20 dk güncellenmeyince bir kez, sonra 20 dk susar', () => {
  const now = 10 * 3600_000;
  assert.equal(D.devamNeedsReminder(now - 5 * 60_000, null, now), false, 'yeni güncellenmiş');
  assert.equal(D.devamNeedsReminder(now - 25 * 60_000, null, now), true);
  assert.equal(D.devamNeedsReminder(now - 25 * 60_000, now - 60_000, now), false, 'az önce hatırlatıldı');
  assert.equal(D.devamNeedsReminder(null, null, now), true, 'dosya yok');
});

function harness(devamText, mtime) {
  const hive = {
    recordSession() {},
    isGod() { return false; },
    devam: () => devamText,
    devamMtime: () => mtime
  };
  const server = new HookServer(hive, () => null, () => ({ notifications: false }));
  return (event) => server.handle({ agent_id: 'a1', hook_event_name: event, session_id: 's1' })?.hookSpecificOutput?.additionalContext ?? '';
}

test('kanca: oturum başında devam noktası verilir; eskiyse araç sonrası bir kez hatırlatılır', () => {
  const fire = harness('## Sıradaki adım\n- testleri çalıştır', Date.now() - 30 * 60_000);
  assert.match(fire('SessionStart'), /<devam>[\s\S]*testleri çalıştır/);
  assert.match(fire('PostToolUse'), /devam\.md/);
  assert.equal(fire('PostToolUse'), '', 'ikinci kez hemen hatırlatılmaz');
  const fresh = harness('## Görev\n- x', Date.now());
  assert.equal(fresh('PostToolUse'), '', 'güncel devam noktası hatırlatılmaz');
  const empty = harness('', null);
  assert.equal(empty('SessionStart'), '', 'devam noktası yoksa bir şey eklenmez');
});
