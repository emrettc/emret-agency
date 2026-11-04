import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PixelButton } from '@/components/PixelButton';
import { loadTheme, resolveSceneMap, resolveThemeMap, themeTilesetUrls } from './themeLoader';
import type { ThemeId } from './themeRegistry';
import {
  addSeat, clearRegion, COLLISION_LAYER, BLOCK_GID, isSeatName, moveSpawn, PAINT_LAYERS, pointTile,
  removeSeat, setTile, shiftRegion, spawnPoints, tileAt, type EditMap, type TileRect
} from '@shared/officeMapEdit';

/**
 * Ofis Düzenleyici — piksel ofisin haritasını görsel olarak düzenler.
 *
 * Araçlar: seç/taşı (eşya + engel + oturma yeri birlikte), boya (paletten tek
 * karo ya da sürükleyerek seçilen çok karolu damga), sil, engel (yürünemez
 * alan) ve oturma yeri. Harita 2D canvas'ta çizilir (Pixi sahnesine dokunmaz);
 * kaydedince userData/office-maps/<tema>.tmj'ye yazılır ve ofis yeniden kurulur.
 * Bütün düzenleme mantığı shared/officeMapEdit.ts'teki saf fonksiyonlarda.
 */

type Tool = 'select' | 'paint' | 'erase' | 'block' | 'seat';
type PaintLayer = typeof PAINT_LAYERS[number];

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const GID_MASK = 0x1fffffff;
const DRAW_LAYERS: readonly string[] = PAINT_LAYERS;
const PALETTE_SCALE = 2;

interface TilesetInfo { firstgid: number; columns: number; tilecount: number; img: HTMLImageElement; }
/** Paletten seçilen damga: w×h gid (0 = o hücreye dokunma). */
interface Stamp { w: number; h: number; gids: number[]; }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function tilesetFor(sets: TilesetInfo[], gid: number): TilesetInfo | undefined {
  for (let i = sets.length - 1; i >= 0; i--) if (gid >= sets[i].firstgid) return sets[i];
  return undefined;
}

/** Bir karoyu, TiledMapRenderer'ın döndürme/çevirme kurallarıyla çizer. */
function drawTile(ctx: CanvasRenderingContext2D, sets: TilesetInfo[], raw: number, dx: number, dy: number, ts: number, z: number): void {
  const gid = raw & GID_MASK;
  if (!gid) return;
  const set = tilesetFor(sets, gid);
  if (!set) return;
  const local = gid - set.firstgid;
  const sx = (local % set.columns) * ts;
  const sy = Math.floor(local / set.columns) * ts;
  const h = (raw & FLIP_H) !== 0, v = (raw & FLIP_V) !== 0, d = (raw & FLIP_D) !== 0;
  const size = ts * z;
  if (!h && !v && !d) { ctx.drawImage(set.img, sx, sy, ts, ts, dx, dy, size, size); return; }
  ctx.save();
  ctx.translate(dx + size / 2, dy + size / 2);
  if (d) {
    if (h && !v) ctx.rotate(Math.PI / 2);
    else if (!h && v) ctx.rotate(-Math.PI / 2);
    else if (h && v) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); }
    else { ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); }
  } else {
    ctx.scale(h ? -1 : 1, v ? -1 : 1);
  }
  ctx.drawImage(set.img, sx, sy, ts, ts, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function normRect(a: { x: number; y: number }, b: { x: number; y: number }): TileRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

function inRect(t: { x: number; y: number }, r: TileRect | null): boolean {
  return !!r && t.x >= r.x && t.y >= r.y && t.x < r.x + r.w && t.y < r.y + r.h;
}

/** Fare sürüklemesinin ara durumu (yalnız ref'te tutulur, her olayda render tetiklemez). */
type Drag =
  | { kind: 'rect'; from: { x: number; y: number } }
  | { kind: 'move'; from: { x: number; y: number } }
  | { kind: 'stroke' }
  | { kind: 'block'; value: number }
  | { kind: 'seat'; name: string }
  | null;

export function OfficeEditor({ themeId, onClose, onSaved }: { themeId: ThemeId; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const p = (k: string, o?: Record<string, unknown>): string => t(`officeEditor.${k}`, o ?? {});

  const [base, setBase] = useState<EditMap | null>(null);
  const [map, setMap] = useState<EditMap | null>(null);
  const [saved, setSaved] = useState<EditMap | null>(null);
  const [sets, setSets] = useState<TilesetInfo[]>([]);
  const [loadError, setLoadError] = useState('');
  const [past, setPast] = useState<EditMap[]>([]);
  const [future, setFuture] = useState<EditMap[]>([]);

  const [tool, setTool] = useState<Tool>('select');
  const [layer, setLayer] = useState<PaintLayer>('furniture-below');
  const [zoom, setZoom] = useState(3);
  const [showGrid, setShowGrid] = useState(true);
  const [showBlock, setShowBlock] = useState(true);
  const [copyMode, setCopyMode] = useState(false);
  const [sel, setSel] = useState<TileRect | null>(null);
  /** Taşıma önizlemesi: seçimin sürüklendiği ofset. */
  const [moveBy, setMoveBy] = useState<{ dx: number; dy: number } | null>(null);
  const [seatDrag, setSeatDrag] = useState<{ name: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [paletteSet, setPaletteSet] = useState(0);
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag>(null);
  const paletteDrag = useRef<{ x: number; y: number } | null>(null);
  const [paletteSel, setPaletteSel] = useState<TileRect | null>(null);

  // ── Yükleme: temanın temel haritası, kayıtlı düzenleme ve tileset görselleri ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const theme = await loadTheme(themeId);
        const b = resolveThemeMap(theme) as unknown as EditMap;
        const current = (await resolveSceneMap(theme)) as unknown as EditMap;
        const imgs = await Promise.all(themeTilesetUrls(theme).map(loadImage));
        if (!alive) return;
        setSets(b.tilesets.map((ts, i) => {
          const img = imgs[i];
          const tw = (ts.tilewidth as number | undefined) ?? b.tilewidth;
          const columns = (ts.columns as number | undefined) ?? Math.floor(img.width / tw);
          const tilecount = (ts.tilecount as number | undefined) ?? columns * Math.floor(img.height / tw);
          return { firstgid: ts.firstgid, columns, tilecount, img };
        }));
        setBase(b);
        setMap(current);
        setSaved(current);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [themeId]);

  const dirty = !!map && map !== saved;

  // Geri al yığını: her işlem öncesi harita olduğu gibi saklanır (işlemler saf,
  // girdiyi değiştirmez). State güncelleyicilerinin içinde başka state
  // değiştirilmez — React dev'de güncelleyiciyi iki kez çalıştırır.
  const commit = useCallback((next: EditMap) => {
    if (!map || next === map) return;
    setPast((ps) => [...ps.slice(-99), map]);
    setFuture([]);
    setMap(next);
  }, [map]);

  const undo = useCallback(() => {
    if (!past.length || !map) return;
    setFuture((fs) => [map, ...fs]);
    setMap(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }, [map, past]);

  const redo = useCallback(() => {
    if (!future.length || !map) return;
    setPast((ps) => [...ps, map]);
    setMap(future[0]);
    setFuture(future.slice(1));
  }, [map, future]);

  // Çizilecek harita: taşıma/oturma yeri sürüklenirken canlı önizleme.
  const shown = useMemo(() => {
    if (!map) return null;
    if (sel && moveBy && (moveBy.dx || moveBy.dy)) return shiftRegion(map, sel, moveBy.dx, moveBy.dy, copyMode ? 'copy' : 'move');
    if (seatDrag) return moveSpawn(map, seatDrag.name, seatDrag.x, seatDrag.y);
    return map;
  }, [map, sel, moveBy, copyMode, seatDrag]);

  // ── Harita çizimi ──
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !shown || !sets.length) return;
    const ts = shown.tilewidth;
    const cell = ts * zoom;
    cv.width = shown.width * cell;
    cv.height = shown.height * cell;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1320';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const name of DRAW_LAYERS) {
      const l = shown.layers.find((x) => x.name === name && x.type === 'tilelayer');
      if (!l?.data) continue;
      ctx.globalAlpha = (tool === 'paint' || tool === 'erase') && name !== layer ? 0.55 : 1;
      for (let y = 0; y < shown.height; y++) {
        for (let x = 0; x < shown.width; x++) {
          const raw = l.data[y * shown.width + x];
          if (raw) drawTile(ctx, sets, raw, x * cell, y * cell, ts, zoom);
        }
      }
    }
    ctx.globalAlpha = 1;
    if (showBlock || tool === 'block') {
      ctx.fillStyle = 'rgba(217, 72, 72, 0.32)';
      for (let y = 0; y < shown.height; y++) {
        for (let x = 0; x < shown.width; x++) {
          if (tileAt(shown, COLLISION_LAYER, x, y)) ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= shown.width; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, cv.height); }
      for (let y = 0; y <= shown.height; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(cv.width, y * cell + 0.5); }
      ctx.stroke();
    }
    // Oturma yerleri ve özel noktalar
    ctx.font = `${Math.max(9, Math.round(cell * 0.28))}px Inter, sans-serif`;
    ctx.textBaseline = 'top';
    for (const o of spawnPoints(shown)) {
      const tt = pointTile(shown, o);
      const cx = tt.x * cell + cell / 2;
      const cy = tt.y * cell + cell / 2;
      const seat = isSeatName(o.name);
      ctx.fillStyle = o.name === 'desk-ceo' ? '#dcab3c' : seat ? '#4f9faf' : '#a199ab';
      ctx.strokeStyle = '#1a1320';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, cell * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (tool === 'seat' || zoom >= 3) {
        ctx.fillStyle = 'rgba(26,19,32,0.75)';
        const w = ctx.measureText(o.name).width + 6;
        ctx.fillRect(cx - w / 2, cy + cell * 0.28, w, Math.max(11, cell * 0.32));
        ctx.fillStyle = '#fff';
        ctx.fillText(o.name, cx - w / 2 + 3, cy + cell * 0.3);
      }
    }
    // Seçim
    const r = sel && moveBy ? { ...sel, x: sel.x + moveBy.dx, y: sel.y + moveBy.dy } : sel;
    if (r) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x * cell + 1, r.y * cell + 1, r.w * cell - 2, r.h * cell - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 211, 77, 0.10)';
      ctx.fillRect(r.x * cell, r.y * cell, r.w * cell, r.h * cell);
    }
    // Fırça/damga önizlemesi
    if (hover && tool === 'paint' && stamp) {
      ctx.globalAlpha = 0.6;
      for (let y = 0; y < stamp.h; y++) {
        for (let x = 0; x < stamp.w; x++) {
          const g = stamp.gids[y * stamp.w + x];
          if (g) drawTile(ctx, sets, g, (hover.x + x) * cell, (hover.y + y) * cell, ts, zoom);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (hover && tool !== 'select') {
      const w = tool === 'paint' && stamp ? stamp.w : 1;
      const h = tool === 'paint' && stamp ? stamp.h : 1;
      ctx.strokeStyle = tool === 'erase' ? '#e08c82' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * cell + 1, hover.y * cell + 1, w * cell - 2, h * cell - 2);
    }
  }, [shown, sets, zoom, showGrid, showBlock, tool, layer, sel, moveBy, hover, stamp]);

  // ── Palet çizimi ──
  const pset = sets[paletteSet];
  useEffect(() => {
    const cv = paletteRef.current;
    if (!cv || !pset || !base) return;
    const ts = base.tilewidth;
    const rows = Math.ceil(pset.tilecount / pset.columns);
    cv.width = pset.columns * ts * PALETTE_SCALE;
    cv.height = rows * ts * PALETTE_SCALE;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#2a2430';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(pset.img, 0, 0, pset.img.width, pset.img.height, 0, 0, pset.img.width * PALETTE_SCALE, pset.img.height * PALETTE_SCALE);
    if (paletteSel) {
      const c = ts * PALETTE_SCALE;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2;
      ctx.strokeRect(paletteSel.x * c + 1, paletteSel.y * c + 1, paletteSel.w * c - 2, paletteSel.h * c - 2);
    }
    // tool: the palette canvas only mounts with the paint/erase tools, so it must
    // be redrawn when one of them opens it.
  }, [pset, base, paletteSel, tool]);

  const tileFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const cv = canvasRef.current;
    if (!cv || !map) return null;
    const rect = cv.getBoundingClientRect();
    const cell = map.tilewidth * zoom;
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
  };

  const applyStamp = (m: EditMap, at: { x: number; y: number }): EditMap => {
    if (!stamp) return m;
    let out = m;
    for (let y = 0; y < stamp.h; y++) {
      for (let x = 0; x < stamp.w; x++) {
        const g = stamp.gids[y * stamp.w + x];
        if (g) out = setTile(out, layer, at.x + x, at.y + y, g);
      }
    }
    return out;
  };

  const seatAt = (m: EditMap, at: { x: number; y: number }): string | null => {
    const hit = spawnPoints(m).find((o) => { const tt = pointTile(m, o); return tt.x === at.x && tt.y === at.y; });
    return hit?.name ?? null;
  };

  // Fırça darbesi boyunca harita doğrudan güncellenir; geri al için darbe
  // başındaki kopya bir kez yığına konur.
  const strokeAt = (at: { x: number; y: number }) => {
    setMap((cur) => {
      if (!cur) return cur;
      if (tool === 'paint') return applyStamp(cur, at);
      if (tool === 'erase') return setTile(cur, layer, at.x, at.y, 0);
      if (tool === 'block' && drag.current?.kind === 'block') return setTile(cur, COLLISION_LAYER, at.x, at.y, drag.current.value);
      return cur;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!map) return;
    const at = tileFromEvent(e);
    if (!at) return;
    if (e.button === 2) {
      // sağ tık: boya/sil aracında damlalık, oturma aracında noktayı sil
      if (tool === 'paint' || tool === 'erase') {
        const g = tileAt(map, layer, at.x, at.y);
        if (g) { setStamp({ w: 1, h: 1, gids: [g] }); setPaletteSel(null); setTool('paint'); setStatus(p('picked', { gid: g & GID_MASK })); }
      } else if (tool === 'seat') {
        const name = seatAt(map, at);
        if (name) { const next = removeSeat(map, name); if (next === map) setStatus(p('protectedSeat')); else commit(next); }
      }
      return;
    }
    if (tool === 'select') {
      if (inRect(at, sel)) { drag.current = { kind: 'move', from: at }; setMoveBy({ dx: 0, dy: 0 }); }
      else { drag.current = { kind: 'rect', from: at }; setSel({ x: at.x, y: at.y, w: 1, h: 1 }); }
      return;
    }
    if (tool === 'seat') {
      const name = seatAt(map, at);
      if (name) { drag.current = { kind: 'seat', name }; setSeatDrag({ name, x: at.x, y: at.y }); }
      else commit(addSeat(map, at.x, at.y));
      return;
    }
    if (tool === 'paint' && !stamp) { setStatus(p('pickFirst')); return; }
    setPast((ps) => [...ps.slice(-99), map]);
    setFuture([]);
    if (tool === 'block') drag.current = { kind: 'block', value: tileAt(map, COLLISION_LAYER, at.x, at.y) ? 0 : BLOCK_GID };
    else drag.current = { kind: 'stroke' };
    strokeAt(at);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const at = tileFromEvent(e);
    setHover(at);
    const d = drag.current;
    if (!d || !at) return;
    if (d.kind === 'rect') setSel(normRect(d.from, at));
    else if (d.kind === 'move') setMoveBy({ dx: at.x - d.from.x, dy: at.y - d.from.y });
    else if (d.kind === 'seat') setSeatDrag({ name: d.name, x: at.x, y: at.y });
    else strokeAt(at);
  };

  const finishDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !map) return;
    if (d.kind === 'move' && sel && moveBy) {
      if (moveBy.dx || moveBy.dy) {
        commit(shiftRegion(map, sel, moveBy.dx, moveBy.dy, copyMode ? 'copy' : 'move'));
        setSel({ ...sel, x: sel.x + moveBy.dx, y: sel.y + moveBy.dy });
      }
      setMoveBy(null);
    } else if (d.kind === 'seat' && seatDrag) {
      commit(moveSpawn(map, seatDrag.name, seatDrag.x, seatDrag.y));
      setSeatDrag(null);
    }
  };

  // ── Klavye: geri al/yinele, sil, ok tuşlarıyla seçimi kaydır ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (!map || !sel || tool !== 'select') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(clearRegion(map, sel)); return; }
      if (e.key === 'Escape') { setSel(null); return; }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const a = arrows[e.key];
      if (a) {
        e.preventDefault();
        commit(shiftRegion(map, sel, a[0], a[1], copyMode ? 'copy' : 'move'));
        setSel({ ...sel, x: sel.x + a[0], y: sel.y + a[1] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, sel, tool, copyMode, undo, redo, commit]);

  // ── Palet etkileşimi: tıkla = tek karo, sürükle = çok karolu damga ──
  const paletteTile = (e: React.MouseEvent): { x: number; y: number } | null => {
    const cv = paletteRef.current;
    if (!cv || !pset || !base) return null;
    const r = cv.getBoundingClientRect();
    const c = base.tilewidth * PALETTE_SCALE * (r.width / cv.width);
    const x = Math.floor((e.clientX - r.left) / c);
    const y = Math.floor((e.clientY - r.top) / c);
    if (x < 0 || y < 0 || x >= pset.columns || y * pset.columns + x >= pset.tilecount) return null;
    return { x, y };
  };
  const pickPalette = (rect: TileRect) => {
    if (!pset) return;
    const gids: number[] = [];
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const idx = (rect.y + y) * pset.columns + (rect.x + x);
        gids.push(idx < pset.tilecount ? pset.firstgid + idx : 0);
      }
    }
    setStamp({ w: rect.w, h: rect.h, gids });
    setPaletteSel(rect);
    setTool('paint');
  };

  const save = async () => {
    if (!map) return;
    setBusy(true);
    const r = await window.cth.officeMapSet(themeId, JSON.stringify(map)).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!r.ok) { setStatus(p('saveFailed', { error: r.error ?? '' })); return; }
    setSaved(map);
    setStatus(p('savedNote'));
    onSaved();
  };

  const reset = async () => {
    if (!base || !window.confirm(p('resetConfirm'))) return;
    setBusy(true);
    await window.cth.officeMapReset(themeId).catch(() => undefined);
    setBusy(false);
    commit(base);
    setSaved(base);
    setSel(null);
    setStatus(p('resetNote'));
    onSaved();
  };

  const close = () => {
    if (dirty && !window.confirm(p('unsavedConfirm'))) return;
    onClose();
  };

  // ── Görünüm ──
  const bar: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    padding: '8px 12px', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 -1px 0 var(--cth-ink-300)'
  };
  const sep: CSSProperties = { width: 1, alignSelf: 'stretch', background: 'var(--cth-ink-100)', margin: '0 4px' };
  const hint: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)' };
  const selectStyle: CSSProperties = {
    height: 28, padding: '0 8px', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
    border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 'var(--cth-radius-sm, 2px)'
  };
  const check = (on: boolean, set: (v: boolean) => void, label: string) => (
    <label style={{ ...hint, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  const TOOLS: Tool[] = ['select', 'paint', 'erase', 'block', 'seat'];

  return createPortal(
    <div
      role="dialog"
      aria-label={p('title')}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column',
        background: 'var(--cth-cream-100)', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)'
      }}
    >
      <div style={bar}>
        <strong style={{ fontSize: 14, marginRight: 8 }}>✎ {p('title')}</strong>
        {TOOLS.map((k) => (
          <PixelButton key={k} size="sm" variant={tool === k ? 'primary' : 'secondary'} onClick={() => { setTool(k); setStatus(''); }}>
            {p(`tool.${k}`)}
          </PixelButton>
        ))}
        <span style={sep} />
        {(tool === 'paint' || tool === 'erase') && (
          <select value={layer} onChange={(e) => setLayer(e.target.value as PaintLayer)} style={selectStyle} aria-label={p('layer')}>
            {PAINT_LAYERS.map((l) => <option key={l} value={l}>{p(`layers.${l}`)}</option>)}
          </select>
        )}
        {tool === 'select' && (
          <>
            {check(copyMode, setCopyMode, p('copyMode'))}
            <PixelButton size="sm" variant="secondary" disabled={!sel} onClick={() => map && sel && commit(clearRegion(map, sel))}>{p('deleteSel')}</PixelButton>
          </>
        )}
        {check(showGrid, setShowGrid, p('grid'))}
        {check(showBlock, setShowBlock, p('showBlock'))}
        <span style={sep} />
        <PixelButton size="sm" variant="ghost" disabled={!past.length} onClick={undo}>↶ {p('undo')}</PixelButton>
        <PixelButton size="sm" variant="ghost" disabled={!future.length} onClick={redo}>↷ {p('redo')}</PixelButton>
        <PixelButton size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(1, z - 1))}>−</PixelButton>
        <span style={{ ...hint, width: 28, textAlign: 'center' }}>{zoom}×</span>
        <PixelButton size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(6, z + 1))}>+</PixelButton>
        <span style={{ flex: 1 }} />
        <PixelButton size="sm" variant="secondary" disabled={busy || !base} onClick={reset}>{p('reset')}</PixelButton>
        <PixelButton size="sm" variant="primary" disabled={busy || !dirty} onClick={save}>{p('save')}</PixelButton>
        <PixelButton size="sm" variant="secondary" onClick={close}>{p('close')}</PixelButton>
      </div>
      <div style={{ ...bar, paddingTop: 4, paddingBottom: 4 }}>
        <span style={hint}>{p(`help.${tool}`)}</span>
        <span style={{ flex: 1 }} />
        {hover && <span style={{ ...hint, fontFamily: 'var(--cth-font-mono)' }}>{hover.x},{hover.y}</span>}
        {status && <span style={{ ...hint, color: 'var(--cth-ink-900)' }}>{status}</span>}
        {dirty && <span style={{ ...hint, color: 'var(--cth-coral)' }}>● {p('unsaved')}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 16 }}>
          {loadError && <div style={{ color: 'var(--cth-coral)' }}>{p('loadFailed')}: {loadError}</div>}
          {!loadError && !map && <div style={hint}>{p('loading')}</div>}
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={finishDrag}
            onMouseLeave={() => { finishDrag(); setHover(null); }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ display: map ? 'block' : 'none', imageRendering: 'pixelated', cursor: tool === 'select' ? 'default' : 'crosshair' }}
          />
        </div>
        {(tool === 'paint' || tool === 'erase') && sets.length > 0 && (
          <div style={{
            width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12,
            background: 'var(--cth-paper-100)', boxShadow: 'inset 1px 0 0 var(--cth-ink-300)'
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--cth-ink-700)' }}>{p('palette')}</div>
            <select value={paletteSet} onChange={(e) => { setPaletteSet(Number(e.target.value)); setPaletteSel(null); }} style={selectStyle}>
              {sets.map((_, i) => <option key={i} value={i}>{p(`tilesets.${i}`)}</option>)}
            </select>
            <div style={hint}>{p('paletteHint')}</div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <canvas
                ref={paletteRef}
                style={{ width: '100%', imageRendering: 'pixelated', cursor: 'pointer', display: 'block' }}
                onMouseDown={(e) => { const at = paletteTile(e); if (at) { paletteDrag.current = at; setPaletteSel({ x: at.x, y: at.y, w: 1, h: 1 }); } }}
                onMouseMove={(e) => { const at = paletteTile(e); if (at && paletteDrag.current) setPaletteSel(normRect(paletteDrag.current, at)); }}
                onMouseUp={(e) => {
                  const from = paletteDrag.current;
                  paletteDrag.current = null;
                  const at = paletteTile(e) ?? from;
                  if (from && at) pickPalette(normRect(from, at));
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
