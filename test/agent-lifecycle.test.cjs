'use strict';

/**
 * Ajan yaşam döngüsü (src/shared/agentLifecycle.ts): görevi olmayan ve 1 gün
 * boşta kalan ajan arşivlenir, arşivdeki ajana açık görev atanınca uyanır,
 * yönetici asla arşivlenmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const L = loadTs('src/shared/agentLifecycle.ts');
const HOUR = 3_600_000;
const NOW = 100 * HOUR;

test('açık görev sahipleri: kapalı görevler sayılmaz, owner yedek alan', () => {
  const s = L.openTaskAssignees({
    tasks: [
      { status: 'todo', assignee: 'a' },
      { status: 'done', assignee: 'b' },
      { status: 'doing', owner: 'c' },
      { status: 'cancelled', assignee: 'd' },
      { status: 'blocked', assignee: '' }
    ]
  });
  assert.deepEqual([...s].sort(), ['a', 'c']);
  assert.equal(L.openTaskAssignees(null).size, 0);
  assert.deepEqual([...L.openTaskAssignees([{ status: 'todo', assignee: 'x' }])], ['x']);
});

test('1 günden uzun boşta + görevsiz ajan arşivlenir; görevli, meşgul ve yönetici kalır', () => {
  const d = L.decideLifecycle({
    live: [
      { id: 'god', isGod: true, status: 'idle' },
      { id: 'bos', status: 'idle' },
      { id: 'gorevli', status: 'idle' },
      { id: 'mesgul', status: 'working' },
      { id: 'yeni', status: 'idle' },
      { id: 'kayitsiz', status: 'idle' }
    ],
    archived: [],
    openAssignees: new Set(['gorevli']),
    lastActiveAt: { god: 0, bos: NOW - 25 * HOUR, gorevli: 0, mesgul: 0, yeni: NOW - 2 * HOUR },
    now: NOW,
    idleHours: 24
  });
  assert.deepEqual(d.archive, ['bos']);
  assert.deepEqual(d.revive, []);
});

test('arşivdeki ajana görev gelince uyanır; idleHours=0 otomatik arşivi kapatır', () => {
  const d = L.decideLifecycle({
    live: [{ id: 'bos', status: 'idle' }],
    archived: [{ id: 'eski' }, { id: 'gorevsiz' }],
    openAssignees: new Set(['eski']),
    lastActiveAt: { bos: 0 },
    now: NOW,
    idleHours: 0
  });
  assert.deepEqual(d.archive, []);
  assert.deepEqual(d.revive, ['eski']);
});
