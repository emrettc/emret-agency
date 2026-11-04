/**
 * Ofis Düzenleyici — Tiled haritası üzerinde saf düzenleme işlemleri.
 *
 * Ofisteki eşyalar ayrı nesneler değil, `furniture-below` / `furniture-above`
 * katmanlarına boyanmış karolar; ajanın oturduğu yer ise `spawn-points`
 * nesne katmanındaki adlı bir nokta (`pc-3`, `desk-ceo`, …) ve yürünemezlik
 * `collision` katmanında. Bir masayı "taşımak" bu yüzden bir dikdörtgendeki
 * eşya + engel karolarını VE içindeki oturma noktalarını birlikte kaydırmak
 * demek. Zemin ve duvar katmanları taşınmaz (masa kalkınca altında zemin kalır).
 *
 * Her işlem yeni bir harita döner, girdiyi değiştirmez — düzenleyicinin geri
 * al yığını eski kopyaları olduğu gibi tutabilsin diye. Yalnız değişen
 * katmanların `data` dizisi kopyalanır.
 */

export interface EditObject {
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  [k: string]: unknown;
}

export interface EditLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  data?: number[];
  objects?: EditObject[];
  [k: string]: unknown;
}

export interface EditMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: EditLayer[];
  tilesets: Array<{ firstgid: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

export interface TileRect { x: number; y: number; w: number; h: number; }

/** Bir bölge taşınırken/kopyalanırken birlikte hareket eden karo katmanları. */
export const MOVABLE_LAYERS = ['furniture-below', 'furniture-above', 'collision'] as const;
/** Fırçayla boyanabilen görünür karo katmanları. */
export const PAINT_LAYERS = ['floor', 'walls', 'furniture-below', 'furniture-above'] as const;
export const COLLISION_LAYER = 'collision';
export const SPAWN_LAYER = 'spawn-points';
/** Collision katmanında "geçilmez" anlamına gelen herhangi bir gid. */
export const BLOCK_GID = 1;
/** Ajanın oturabildiği noktaların ad önekleri (TiledMapRenderer ile aynı). */
const SEAT_PREFIXES = ['desk-', 'pc-'];
/** Silinemeyen noktalar: Genel Müdür'ün masası ve ofis kapısı. */
const PROTECTED_POINTS = new Set(['desk-ceo', 'entrance']);

export function isSeatName(name: string): boolean {
  return SEAT_PREFIXES.some((p) => name.startsWith(p));
}

function layerIndex(m: EditMap, name: string, type: string): number {
  return m.layers.findIndex((l) => l.name === name && l.type === type);
}

/** Haritanın yüzeysel kopyası; yalnız `names` katmanlarının verisi derin kopyalanır. */
function cloneWith(m: EditMap, tileNames: readonly string[], withSpawns: boolean): EditMap {
  return {
    ...m,
    layers: m.layers.map((l) => {
      if (l.type === 'tilelayer' && tileNames.includes(l.name) && l.data) return { ...l, data: [...l.data] };
      if (withSpawns && l.type === 'objectgroup' && l.name === SPAWN_LAYER) {
        return { ...l, objects: (l.objects ?? []).map((o) => ({ ...o })) };
      }
      return l;
    })
  };
}

function inBounds(m: EditMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
}

/** Bir dikdörtgeni harita sınırına kırpar; tamamen dışarıdaysa null. */
export function clampRect(m: EditMap, r: TileRect): TileRect | null {
  const x0 = Math.max(0, Math.min(r.x, r.x + r.w));
  const y0 = Math.max(0, Math.min(r.y, r.y + r.h));
  const x1 = Math.min(m.width, Math.max(r.x, r.x + r.w));
  const y1 = Math.min(m.height, Math.max(r.y, r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function tileAt(m: EditMap, layer: string, x: number, y: number): number {
  const l = m.layers[layerIndex(m, layer, 'tilelayer')];
  if (!l?.data || !inBounds(m, x, y)) return 0;
  return l.data[y * m.width + x] ?? 0;
}

export function spawnPoints(m: EditMap): EditObject[] {
  return m.layers[layerIndex(m, SPAWN_LAYER, 'objectgroup')]?.objects ?? [];
}

/** Noktanın bulunduğu karo (TiledMapRenderer.parseSpawnPoints ile aynı yuvarlama). */
export function pointTile(m: EditMap, o: Pick<EditObject, 'x' | 'y'>): { x: number; y: number } {
  return { x: Math.floor(o.x / m.tilewidth), y: Math.floor(o.y / m.tileheight) };
}

function inRect(t: { x: number; y: number }, r: TileRect): boolean {
  return t.x >= r.x && t.y >= r.y && t.x < r.x + r.w && t.y < r.y + r.h;
}

/** Kopyalanan bir oturma noktası için çakışmayan ad: `pc-3` → `pc-<en büyük+1>`,
 *  diğerleri `<ad>-2`, `<ad>-3`, … */
export function uniqueSeatName(existing: Iterable<string>, base: string): string {
  const names = new Set(existing);
  if (/^pc-\d+$/.test(base)) {
    let max = 0;
    for (const n of names) {
      const mm = /^pc-(\d+)$/.exec(n);
      if (mm) max = Math.max(max, Number(mm[1]));
    }
    return `pc-${max + 1}`;
  }
  const stem = base.replace(/-\d+$/, '');
  for (let i = 2; ; i++) {
    const cand = `${stem}-${i}`;
    if (!names.has(cand)) return cand;
  }
}

/**
 * Bir bölgedeki eşya + engel karolarını ve oturma noktalarını (dx, dy) kadar
 * kaydırır. `copy` iken kaynak yerinde kalır ve oturma noktaları yeni adla
 * çoğaltılır (kapı/kafe gibi oturma olmayan noktalar kopyalanmaz).
 * Hedefte yalnız boş olmayan karolar yazılır: taşınan masanın boş köşeleri,
 * hedefteki mevcut eşyayı silmez. Haritadan taşan karolar düşer.
 */
export function shiftRegion(m: EditMap, rect: TileRect, dx: number, dy: number, mode: 'move' | 'copy'): EditMap {
  const r = clampRect(m, rect);
  if (!r || (dx === 0 && dy === 0)) return m;
  const out = cloneWith(m, MOVABLE_LAYERS, true);
  for (const name of MOVABLE_LAYERS) {
    const l = out.layers[layerIndex(out, name, 'tilelayer')];
    if (!l?.data) continue;
    const block: number[] = [];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (r.y + y) * out.width + (r.x + x);
        block.push(l.data[i]);
        if (mode === 'move') l.data[i] = 0;
      }
    }
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const v = block[y * r.w + x];
        const tx = r.x + x + dx;
        const ty = r.y + y + dy;
        if (!v || !inBounds(out, tx, ty)) continue;
        l.data[ty * out.width + tx] = v;
      }
    }
  }
  const sl = out.layers[layerIndex(out, SPAWN_LAYER, 'objectgroup')];
  if (sl?.objects) {
    const added: EditObject[] = [];
    for (const o of sl.objects) {
      if (!inRect(pointTile(out, o), r)) continue;
      const nx = o.x + dx * out.tilewidth;
      const ny = o.y + dy * out.tileheight;
      if (!inBounds(out, Math.floor(nx / out.tilewidth), Math.floor(ny / out.tileheight))) continue;
      if (mode === 'move') { o.x = nx; o.y = ny; continue; }
      if (!isSeatName(o.name)) continue;
      const name = uniqueSeatName([...sl.objects, ...added].map((p) => p.name), o.name);
      added.push({ ...o, name, x: nx, y: ny });
    }
    sl.objects.push(...added);
  }
  return out;
}

/** Bölgedeki eşya + engel karolarını ve oturma noktalarını siler. Genel
 *  Müdür'ün masası (`desk-ceo`) ve kapı (`entrance`) noktası korunur. */
export function clearRegion(m: EditMap, rect: TileRect): EditMap {
  const r = clampRect(m, rect);
  if (!r) return m;
  const out = cloneWith(m, MOVABLE_LAYERS, true);
  for (const name of MOVABLE_LAYERS) {
    const l = out.layers[layerIndex(out, name, 'tilelayer')];
    if (!l?.data) continue;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) l.data[y * out.width + x] = 0;
    }
  }
  const sl = out.layers[layerIndex(out, SPAWN_LAYER, 'objectgroup')];
  if (sl?.objects) {
    sl.objects = sl.objects.filter((o) => PROTECTED_POINTS.has(o.name) || !isSeatName(o.name) || !inRect(pointTile(out, o), r));
  }
  return out;
}

/** Tek bir karoyu boyar (gid 0 = siler). Değişiklik yoksa aynı haritayı döner. */
export function setTile(m: EditMap, layer: string, x: number, y: number, gid: number): EditMap {
  if (!inBounds(m, x, y) || tileAt(m, layer, x, y) === gid) return m;
  const out = cloneWith(m, [layer], false);
  const l = out.layers[layerIndex(out, layer, 'tilelayer')];
  if (!l?.data) return m;
  l.data[y * out.width + x] = gid;
  return out;
}

/** Bir oturma/özel noktayı karo (tx, ty)'ye taşır; karo içi ofset korunur. */
export function moveSpawn(m: EditMap, name: string, tx: number, ty: number): EditMap {
  if (!inBounds(m, tx, ty)) return m;
  const out = cloneWith(m, [], true);
  const o = spawnPoints(out).find((p) => p.name === name);
  if (!o) return m;
  const offX = o.x - Math.floor(o.x / out.tilewidth) * out.tilewidth;
  const offY = o.y - Math.floor(o.y / out.tileheight) * out.tileheight;
  o.x = tx * out.tilewidth + offX;
  o.y = ty * out.tileheight + offY;
  return out;
}

/** (tx, ty)'ye yeni bir oturma noktası ekler (`pc-<sıradaki>`). */
export function addSeat(m: EditMap, tx: number, ty: number): EditMap {
  if (!inBounds(m, tx, ty)) return m;
  const out = cloneWith(m, [], true);
  const sl = out.layers[layerIndex(out, SPAWN_LAYER, 'objectgroup')];
  if (!sl) return m;
  sl.objects = sl.objects ?? [];
  const name = uniqueSeatName(sl.objects.map((o) => o.name), 'pc-1');
  sl.objects.push({ name, x: tx * out.tilewidth, y: ty * out.tileheight, width: 0, height: 0, point: true, visible: true });
  return out;
}

/** Bir oturma noktasını siler (korunan noktalar hariç). */
export function removeSeat(m: EditMap, name: string): EditMap {
  if (PROTECTED_POINTS.has(name) || !isSeatName(name)) return m;
  const out = cloneWith(m, [], true);
  const sl = out.layers[layerIndex(out, SPAWN_LAYER, 'objectgroup')];
  if (!sl?.objects) return m;
  sl.objects = sl.objects.filter((o) => o.name !== name);
  return out;
}

/** Temanın sabit masa listesinde olmayan, düzenleyiciyle eklenmiş oturma noktaları
 *  (masa kopyalanınca doğan `pc-7`, `desk-…-2` gibi), haritadaki sırayla. */
export function extraSeatNames(m: EditMap, primary: readonly string[]): string[] {
  const known = new Set(primary);
  return spawnPoints(m).map((o) => o.name).filter((n) => isSeatName(n) && !known.has(n));
}

/**
 * Diskten gelen düzenlenmiş haritayı temel haritaya göre doğrular. Boyut, karo
 * ölçüsü ve tileset firstgid'leri tutmuyorsa (tema değişti, dosya bozuk) null
 * döner ve sahne temel haritaya düşer. Tileset metadatası temel haritadan
 * alınır: düzenleyici yalnız katmanları değiştirir.
 */
export function parseEditedMap(raw: string | null | undefined, base: EditMap): EditMap | null {
  if (!raw) return null;
  let m: EditMap;
  try { m = JSON.parse(raw) as EditMap; } catch { return null; }
  if (!m || typeof m !== 'object' || !Array.isArray(m.layers) || !Array.isArray(m.tilesets)) return null;
  if (m.width !== base.width || m.height !== base.height) return null;
  if (m.tilewidth !== base.tilewidth || m.tileheight !== base.tileheight) return null;
  if (m.tilesets.length !== base.tilesets.length) return null;
  if (m.tilesets.some((t, i) => t?.firstgid !== base.tilesets[i].firstgid)) return null;
  for (const bl of base.layers) {
    const l = m.layers.find((x) => x?.name === bl.name && x?.type === bl.type);
    if (!l) return null;
    if (bl.type === 'tilelayer') {
      if (!Array.isArray(l.data) || l.data.length !== base.width * base.height) return null;
      if (l.data.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0)) return null;
    } else if (bl.type === 'objectgroup') {
      if (!Array.isArray(l.objects)) return null;
      if (l.objects.some((o) => !o || typeof o.name !== 'string' || typeof o.x !== 'number' || typeof o.y !== 'number')) return null;
    }
  }
  return { ...m, tilesets: base.tilesets };
}
