// Office cast — roster metadata + sprite frames.
//
// The `name` keys are appearance ids only (they pick a portrait recipe in
// portraitArt.ts and are persisted on every agent), so they keep their original
// spelling. What the user sees — displayName and blurb — is a neutral Turkish
// default name and a role suggestion; both are freely editable per agent.
//
// Both the static portraits (cards / picker) and the in-scene walking sprites are
// now fully custom-drawn from the same per-character recipes in portraitArt.ts:
// the scene sprite reuses the portrait's exact head/face/clothing and adds legs,
// so an agent on the office floor looks identical to its card. The LimeZu base
// sheets are no longer used for the cast. See assets/ATTRIBUTION.md.

import { Texture } from 'pixi.js';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H } from './portraitArt';

export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. */
export const OFFICE_CAST: CastMember[] = [
  { name: 'michael',  displayName: 'Murat',    shirt: '#5a6b8c', blurb: 'Proje lideri' },
  { name: 'jim',      displayName: 'Can',      shirt: '#6fa8dc', blurb: 'Yazılım geliştirici' },
  { name: 'pam',      displayName: 'Elif',     shirt: '#9caf88', blurb: 'Tasarımcı' },
  { name: 'dwight',   displayName: 'Burak',    shirt: '#b89b3e', blurb: 'Proje yöneticisi' },
  { name: 'kevin',    displayName: 'Kerem',    shirt: '#4a7ab5', blurb: 'Veri analisti' },
  { name: 'angela',   displayName: 'Ayşe',     shirt: '#8a86a6', blurb: 'Finans' },
  { name: 'oscar',    displayName: 'Onur',     shirt: '#7a4b6b', blurb: 'Yazılım mimarı' },
  { name: 'stanley',  displayName: 'Selim',    shirt: '#8c5a4b', blurb: 'Kıdemli geliştirici' },
  { name: 'phyllis',  displayName: 'Fatma',    shirt: '#b08bbf', blurb: 'Satış' },
  { name: 'andy',     displayName: 'Emir',     shirt: '#6fae6f', blurb: 'Ürün yöneticisi' },
  { name: 'kelly',    displayName: 'Zeynep',   shirt: '#d16ba5', blurb: 'Müşteri ilişkileri' },
  { name: 'ryan',     displayName: 'Deniz',    shirt: '#3a3a44', blurb: 'Araştırmacı' },
  { name: 'toby',     displayName: 'Tolga',    shirt: '#9a8c5a', blurb: 'Dokümantasyon' },
  { name: 'creed',    displayName: 'Cemil',    shirt: '#6b7a4b', blurb: 'Kalite güvence' },
  { name: 'meredith', displayName: 'Melek',    shirt: '#b5544a', blurb: 'Tedarik ve operasyon' },
];

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

export const DEFAULT_CHARACTER: OfficeCharacterName = 'jim';

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  paintPortrait(ctx, name, scale);
}
