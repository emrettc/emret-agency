'use strict';

/**
 * Ofis Düzenleyici'nin saf harita işlemleri (src/shared/officeMapEdit.ts),
 * gerçek ofis haritası (office.tmj) üzerinde: bir masayı taşımak eşya + engel
 * karolarını ve oturma noktasını BİRLİKTE kaydırmalı, kopyalamak yeni adlı bir
 * oturma yeri doğurmalı, bozuk/uyumsuz kayıtlı harita reddedilmeli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const E = loadTs('src/shared/officeMapEdit.ts');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/assets/maps/office.tmj'), 'utf8'));
const seat = (m, name) => E.spawnPoints(m).find((o) => o.name === name);

/** pc-1'in masası: oturma karosu ve üstündeki iki sıra (monitör bloğu). */
function deskRect(m, name) {
  const t = E.pointTile(m, seat(m, name));
  return { x: t.x - 1, y: t.y - 2, w: 3, h: 3 };
}

test('masa taşıma: eşya, engel ve oturma noktası birlikte kayar; kaynak boşalır', () => {
  const r = deskRect(BASE, 'pc-1');
  const before = E.pointTile(BASE, seat(BASE, 'pc-1'));
  const gidTop = E.tileAt(BASE, 'furniture-above', before.x, before.y - 2);
  assert.ok(gidTop > 0, 'test haritasında pc-1 masasının monitörü olmalı');

  const moved = E.shiftRegion(BASE, r, 0, 4, 'move');
  const after = E.pointTile(moved, seat(moved, 'pc-1'));
  assert.deepEqual(after, { x: before.x, y: before.y + 4 });
  assert.equal(E.tileAt(moved, 'furniture-above', after.x, after.y - 2), gidTop);
  assert.equal(E.tileAt(moved, 'furniture-above', before.x, before.y - 2), 0, 'eski yerde monitör kalmamalı');
  // girdi değişmedi (geri al yığını eski kopyayı tutar)
  assert.deepEqual(E.pointTile(BASE, seat(BASE, 'pc-1')), before);
  assert.equal(E.tileAt(BASE, 'furniture-above', before.x, before.y - 2), gidTop);
});

test('masa kopyalama: kaynak kalır, yeni pc-N oturma yeri doğar ve fazlalık sayılır', () => {
  const r = deskRect(BASE, 'pc-1');
  const copied = E.shiftRegion(BASE, r, 0, 4, 'copy');
  assert.ok(seat(copied, 'pc-1'), 'kaynak oturma yeri kalmalı');
  const extras = E.extraSeatNames(copied, ['pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6', 'desk-ceo']);
  assert.ok(extras.includes('pc-7'), `yeni oturma yeri pc-7 olmalı, gelen: ${extras}`);
  const t = E.pointTile(copied, seat(copied, 'pc-7'));
  assert.deepEqual(t, { x: E.pointTile(BASE, seat(BASE, 'pc-1')).x, y: E.pointTile(BASE, seat(BASE, 'pc-1')).y + 4 });
});

test('silme: eşya ve oturma yeri gider, Genel Müdür masası ve kapı korunur', () => {
  const all = { x: 0, y: 0, w: BASE.width, h: BASE.height };
  const cleared = E.clearRegion(BASE, all);
  const names = E.spawnPoints(cleared).map((o) => o.name);
  assert.ok(names.includes('desk-ceo'));
  assert.ok(names.includes('entrance'));
  assert.ok(!names.includes('pc-1'));
  const layer = cleared.layers.find((l) => l.name === 'furniture-below');
  assert.ok(layer.data.every((v) => v === 0));
});

test('karo boyama, nokta taşıma, ekleme ve silme', () => {
  const painted = E.setTile(BASE, 'floor', 0, 0, 800);
  assert.equal(E.tileAt(painted, 'floor', 0, 0), 800);
  assert.equal(E.setTile(painted, 'floor', 0, 0, 800), painted, 'aynı değer yeni harita üretmez');

  const moved = E.moveSpawn(BASE, 'entrance', 2, 2);
  assert.deepEqual(E.pointTile(moved, seat(moved, 'entrance')), { x: 2, y: 2 });

  const added = E.addSeat(BASE, 5, 5);
  assert.ok(seat(added, 'pc-7'));
  const removed = E.removeSeat(added, 'pc-7');
  assert.equal(seat(removed, 'pc-7'), undefined);
  assert.equal(E.removeSeat(BASE, 'desk-ceo'), BASE, 'Genel Müdür masası silinemez');
});

test('kayıtlı harita doğrulaması: uyumlu olan kabul, boyutu/tileset\'i tutmayan red', () => {
  const edited = E.shiftRegion(BASE, deskRect(BASE, 'pc-2'), 0, 3, 'move');
  const ok = E.parseEditedMap(JSON.stringify(edited), BASE);
  assert.ok(ok);
  assert.equal(ok.tilesets, BASE.tilesets, 'tileset metadatası temel haritadan gelir');
  assert.equal(E.parseEditedMap('{bozuk', BASE), null);
  assert.equal(E.parseEditedMap(JSON.stringify({ ...edited, width: 10 }), BASE), null);
  const badTs = { ...edited, tilesets: edited.tilesets.map((t, i) => (i === 1 ? { ...t, firstgid: 999 } : t)) };
  assert.equal(E.parseEditedMap(JSON.stringify(badTs), BASE), null);
  assert.equal(E.parseEditedMap(null, BASE), null);
});

test('uniqueSeatName: pc-N sıradaki sayıyı, diğerleri -2/-3 ekini alır', () => {
  assert.equal(E.uniqueSeatName(['pc-1', 'pc-6', 'desk-ceo'], 'pc-3'), 'pc-7');
  assert.equal(E.uniqueSeatName(['desk-team-lead', 'desk-team-lead-2'], 'desk-team-lead'), 'desk-team-lead-3');
});
