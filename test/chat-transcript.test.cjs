'use strict';

/** The chat view's transcript reader: bubbles, tool chips, system notes, and
 *  incremental reads that never split a line. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { parseTranscriptLines, readChatChunk, toolLabel } = loadTs('src/main/chatTranscript.ts');

const L = (o) => JSON.stringify(o);
const user = (content, extra = {}) => L({ type: 'user', uuid: `u${Math.random()}`, timestamp: '2026-10-27T10:00:00Z', message: { role: 'user', content }, ...extra });
const asst = (content) => L({ type: 'assistant', uuid: `a${Math.random()}`, timestamp: '2026-10-27T10:00:05Z', message: { role: 'assistant', content } });

test('user text, assistant text and tool calls become entries; noise is skipped', () => {
  const { entries } = parseTranscriptLines([
    L({ type: 'mode', mode: 'normal' }),
    user('merhaba müdür'),
    asst([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Merhaba!' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Testleri çalıştır' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'boom' }]),
    'not json',
    user('gizli', { isSidechain: true })
  ]);
  assert.deepEqual(entries.map((e) => e.role), ['user', 'assistant', 'tool']);
  assert.equal(entries[0].text, 'merhaba müdür');
  assert.equal(entries[2].text, 'Testleri çalıştır');
  assert.equal(entries[2].isError, true, 'a result in the same chunk marks its chip');
});

test('tool results in the same chunk mark the chip; harness text is a system note', () => {
  const { entries, results } = parseTranscriptLines([
    asst([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:/repo/src/a.ts' } }]),
    user([{ type: 'tool_result', tool_use_id: 't2', is_error: false }]),
    user('You have new hive inbox message(s) — at least: x. Read your inbox…'),
    user('<command-name>/clear</command-name>'),
    user('meta', { isMeta: true })
  ]);
  assert.equal(entries[0].text, 'a.ts');
  assert.equal(entries[0].isError, false);
  assert.deepEqual(results, [{ id: 't2', isError: false }]);
  assert.deepEqual(entries.slice(1).map((e) => e.role), ['system', 'system', 'system']);
});

test('MCP tool names read as "server: tool"', () => {
  assert.equal(toolLabel('mcp__claude_ai_Meta_Ads__ads_get_ad_accounts'), 'Meta Ads: ads_get_ad_accounts');
  assert.equal(toolLabel('Bash'), 'Bash');
});

test('incremental reads keep a partial last line for the next read', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 's.jsonl');
  const first = user('bir') + '\n';
  const second = user('iki');
  fs.writeFileSync(f, first + second.slice(0, 10));
  const a = readChatChunk(f, null);
  assert.deepEqual(a.entries.map((e) => e.text), ['bir']);
  assert.equal(a.offset, Buffer.byteLength(first));
  fs.writeFileSync(f, first + second + '\n');
  const b = readChatChunk(f, a.offset);
  assert.deepEqual(b.entries.map((e) => e.text), ['iki']);
  const c = readChatChunk(f, b.offset);
  assert.equal(c.entries.length, 0);
});
