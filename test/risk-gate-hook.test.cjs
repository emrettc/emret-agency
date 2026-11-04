'use strict';

/**
 * The hook server turns a risky PreToolUse into `permissionDecision: "ask"` so
 * Claude Code stops for the human's approval even in auto mode.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

async function floor(t, config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-risk-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'can-1', name: 'Can', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ notifications: false, ...config }), undefined, undefined);
  const fire = (tool_name, tool_input) =>
    server.handle({ agent_id: 'can-1', hook_event_name: 'PreToolUse', session_id: 's1', tool_name, tool_input });
  return { home, fire };
}

const decision = (res) => res?.hookSpecificOutput?.permissionDecision;

test('a risky command stops for the human (ask) with a Turkish reason', async (t) => {
  const { fire, home } = await floor(t, {});
  const res = await fire('Bash', { command: 'git push origin main' });
  assert.equal(decision(res), 'ask');
  assert.match(res.hookSpecificOutput.permissionDecisionReason, /uzak depoya gönderiyor/);
  const log = fs.readFileSync(path.join(home, 'hive', 'log.jsonl'), 'utf8');
  assert.match(log, /"kind":"risk-gate"/, 'the gate leaves an audit trail');
});

test('ordinary work passes straight through', async (t) => {
  const { fire } = await floor(t, {});
  assert.equal(decision(await fire('Bash', { command: 'npm test' })), undefined);
  assert.equal(decision(await fire('Edit', { file_path: '/repo/src/a.ts' })), undefined);
});

test('turning the gate off in settings lets the call through', async (t) => {
  const { fire } = await floor(t, { riskGate: false });
  assert.equal(decision(await fire('Bash', { command: 'rm -rf build' })), undefined);
});
