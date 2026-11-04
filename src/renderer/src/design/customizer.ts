/**
 * Dinamik Tasarım Paneli (ofis-customizer-01) — kullanıcının --cth-* token
 * override'ları ve birkaç yerleşim tercihi.
 *
 * Override'lar <html> üzerine inline style olarak yazılır
 * (document.documentElement.style.setProperty), yani tokens.css'teki hem açık
 * hem koyu değerleri ezer. Renkler TEMA BAŞINA saklanır: açık temada seçilen
 * zemin rengi koyu temayı bozmasın diye. data-cth-theme değişince (theme.ts)
 * bir MutationObserver doğru setin uygulanmasını sağlar.
 *
 * Kalıcılık: localStorage ('cth.designCustom.v1'). Modül import edildiği anda
 * uygulanır (main.tsx), böylece açılışta ilk boyamadan önce devreye girer.
 */
import { useSyncExternalStore } from 'react';

export type ThemeKey = 'light' | 'dark';
export type InboxSide = 'left' | 'right';
export type InboxButtonPlace = 'start' | 'end' | 'hidden';

export interface DesignState {
  /** Tema başına renk override'ları: '--cth-…' -> '#RRGGBB' */
  colors: Record<ThemeKey, Record<string, string>>;
  /** Temadan bağımsız ölçüler/fontlar: '--cth-…' -> CSS değeri */
  common: Record<string, string>;
  /** Gölge yoğunluğu 0..100 (null = token varsayılanı) */
  shadow: number | null;
  /** Son uygulanan hazır tema (THEME_PRESETS id) — yalnız vurgulamak için. */
  preset: string | null;
  layout: {
    inboxSide: InboxSide;
    inboxWidth: number; // px
    inboxButton: InboxButtonPlace;
  };
}

export const DEFAULT_LAYOUT: DesignState['layout'] = { inboxSide: 'right', inboxWidth: 900, inboxButton: 'start' };

const LS_KEY = 'cth.designCustom.v1';

function empty(): DesignState {
  return { colors: { light: {}, dark: {} }, common: {}, shadow: null, preset: null, layout: { ...DEFAULT_LAYOUT } };
}

function load(): DesignState {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<DesignState>;
    const e = empty();
    return {
      colors: { light: { ...(p.colors?.light ?? {}) }, dark: { ...(p.colors?.dark ?? {}) } },
      common: { ...(p.common ?? {}) },
      shadow: typeof p.shadow === 'number' ? p.shadow : null,
      preset: typeof p.preset === 'string' ? p.preset : null,
      layout: { ...e.layout, ...(p.layout ?? {}) }
    };
  } catch { return empty(); }
}

let state: DesignState = load();
/** Şu an <html>'e yazdığımız property'ler — sıfırlarken temizlemek için. */
const applied = new Set<string>();
const subs = new Set<() => void>();

function currentTheme(): ThemeKey {
  try { return document.documentElement.dataset.cthTheme === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

function shadowValue(n: number, theme: ThemeKey): string {
  const k = Math.max(0, Math.min(100, n)) / 100;
  if (k === 0) return 'none';
  const a = (theme === 'dark' ? 0.6 : 0.25) * k;
  const blur = Math.round(2 + 14 * k);
  const y = Math.round(1 + 5 * k);
  return `0 ${y}px ${blur}px 0 rgba(0,0,0,${a.toFixed(3)}), 0 1px 2px -1px rgba(0,0,0,${(a * 0.6).toFixed(3)})`;
}

function apply(): void {
  let root: HTMLElement;
  try { root = document.documentElement; } catch { return; }
  const theme = currentTheme();
  const next: Record<string, string> = { ...state.common, ...state.colors[theme] };
  if (state.shadow !== null) next['--cth-shadow-hard'] = shadowValue(state.shadow, theme);
  for (const k of applied) if (!(k in next)) root.style.removeProperty(k);
  applied.clear();
  for (const [k, v] of Object.entries(next)) {
    if (!k.startsWith('--cth-') || !v) continue;
    root.style.setProperty(k, v);
    applied.add(k);
  }
}

function commit(next: DesignState): void {
  state = next;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* noop */ }
  apply();
  subs.forEach((fn) => fn());
}

// Açılışta uygula + tema değişince doğru renk setine geç.
apply();
try {
  new MutationObserver(() => { apply(); subs.forEach((fn) => fn()); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-cth-theme'] });
} catch { /* test ortamı */ }

export function designState(): DesignState { return state; }

export function setColor(theme: ThemeKey, name: string, value: string | null): void {
  const colors = { ...state.colors, [theme]: { ...state.colors[theme] } };
  if (value === null) delete colors[theme][name]; else colors[theme][name] = value;
  commit({ ...state, colors });
}

export function setCommon(name: string, value: string | null): void {
  const common = { ...state.common };
  if (value === null) delete common[name]; else common[name] = value;
  commit({ ...state, common });
}

export function setShadow(value: number | null): void {
  commit({ ...state, shadow: value });
}

export function setLayout(patch: Partial<DesignState['layout']>): void {
  commit({ ...state, layout: { ...state.layout, ...patch } });
}

/**
 * Hazır temalar: bir mod (açık/koyu) + o modun yüzey/yazı/vurgu override'ları.
 * Boş `colors` = tokens.css'in kendi değerleri. Koyu temalar tokens.css'in koyu
 * bloğunun ÜSTÜNE yazar; ink-300 (her kontrolün kenar çizgisi) zeminine karşı
 * ~3:1'in altına düşmeyecek şekilde seçildi. `swatch`: kartta gösterilen
 * [zemin, kart, yazı, vurgu].
 */
export interface ThemePreset { id: string; mode: ThemeKey; swatch: [string, string, string, string]; colors: Record<string, string> }

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'classicLight', mode: 'light', swatch: ['#FFFFFF', '#F3F4F6', '#1A1320', '#DCAB3C'], colors: {} },
  { id: 'classicDark', mode: 'dark', swatch: ['#17171B', '#26262C', '#DEDBD6', '#CFAA57'], colors: {} },
  {
    id: 'ocean', mode: 'light', swatch: ['#F5F9FC', '#DDEAF2', '#0F2233', '#3B8FB8'],
    colors: {
      '--cth-cream-50': '#F5F9FC', '--cth-cream-100': '#EBF3F8', '--cth-cream-200': '#DDEAF2', '--cth-cream-300': '#C8DBE7',
      '--cth-paper-100': '#FFFFFF', '--cth-paper-200': '#F2F7FB',
      '--cth-ink-900': '#0F2233', '--cth-ink-700': '#2B4459', '--cth-ink-500': '#557086', '--cth-ink-300': '#97B0C3', '--cth-ink-100': '#D1E0EA',
      '--cth-lemon': '#3B8FB8', '--cth-lemon-light': '#CFE5F0'
    }
  },
  {
    id: 'forest', mode: 'light', swatch: ['#F7FAF7', '#E3ECE5', '#14261B', '#4E9A6B'],
    colors: {
      '--cth-cream-50': '#F7FAF7', '--cth-cream-100': '#EEF4EF', '--cth-cream-200': '#E3ECE5', '--cth-cream-300': '#D0DDD3',
      '--cth-paper-100': '#FFFFFF', '--cth-paper-200': '#F4F8F5',
      '--cth-ink-900': '#14261B', '--cth-ink-700': '#2F4A3A', '--cth-ink-500': '#587464', '--cth-ink-300': '#9DB5A6', '--cth-ink-100': '#D3E1D7',
      '--cth-lemon': '#4E9A6B', '--cth-lemon-light': '#D2E7DA'
    }
  },
  {
    id: 'sand', mode: 'light', swatch: ['#FBF7F0', '#EDE3D3', '#2B2118', '#C98B3C'],
    colors: {
      '--cth-cream-50': '#FBF7F0', '--cth-cream-100': '#F5EEE2', '--cth-cream-200': '#EDE3D3', '--cth-cream-300': '#DFD2BD',
      '--cth-paper-100': '#FFFCF7', '--cth-paper-200': '#F8F2E8',
      '--cth-ink-900': '#2B2118', '--cth-ink-700': '#4E3F31', '--cth-ink-500': '#7A6957', '--cth-ink-300': '#B8A68F', '--cth-ink-100': '#E5D9C7',
      '--cth-lemon': '#C98B3C', '--cth-lemon-light': '#F1DFC4'
    }
  },
  {
    id: 'midnight', mode: 'dark', swatch: ['#111827', '#1E2A3F', '#E2E8F0', '#7AA2F7'],
    colors: {
      '--cth-cream-50': '#111827', '--cth-cream-100': '#162032', '--cth-cream-200': '#1E2A3F', '--cth-cream-300': '#2A3850',
      '--cth-paper-100': '#141D2E', '--cth-paper-200': '#1B2638',
      '--cth-ink-900': '#E2E8F0', '--cth-ink-700': '#B4C0D0', '--cth-ink-500': '#8C9AB0', '--cth-ink-300': '#6B7C96', '--cth-ink-100': '#2E3B52',
      '--cth-lemon': '#7AA2F7', '--cth-lemon-light': '#1F2E4D'
    }
  },
  {
    id: 'violet', mode: 'dark', swatch: ['#18141F', '#282133', '#E6DFF0', '#A896E3'],
    colors: {
      '--cth-cream-50': '#18141F', '--cth-cream-100': '#1F1928', '--cth-cream-200': '#282133', '--cth-cream-300': '#342B42',
      '--cth-paper-100': '#1C1724', '--cth-paper-200': '#241D2E',
      '--cth-ink-900': '#E6DFF0', '--cth-ink-700': '#BDB3CC', '--cth-ink-500': '#9A8FAD', '--cth-ink-300': '#7D7191', '--cth-ink-100': '#3A3048',
      '--cth-lemon': '#A896E3', '--cth-lemon-light': '#2B2740'
    }
  },
  {
    id: 'contrast', mode: 'dark', swatch: ['#000000', '#161616', '#FFFFFF', '#FFD34D'],
    colors: {
      '--cth-cream-50': '#000000', '--cth-cream-100': '#0A0A0A', '--cth-cream-200': '#161616', '--cth-cream-300': '#262626',
      '--cth-paper-100': '#050505', '--cth-paper-200': '#111111',
      '--cth-ink-900': '#FFFFFF', '--cth-ink-700': '#E0E0E0', '--cth-ink-500': '#BDBDBD', '--cth-ink-300': '#8A8A8A', '--cth-ink-100': '#3A3A3A',
      '--cth-lemon': '#FFD34D', '--cth-lemon-light': '#3A3110'
    }
  }
];

/** Hazır temanın renklerini kendi moduna yazar (o modun önceki renk
 *  override'larının yerine geçer). Modu değiştirmek çağıranın işi (theme.ts). */
export function applyPreset(preset: ThemePreset): void {
  commit({ ...state, preset: preset.id, colors: { ...state.colors, [preset.mode]: { ...preset.colors } } });
}

export function resetDesign(): void {
  commit(empty());
}

/** Bir token'ın override'sız (tokens.css) değeri — renk seçicinin başlangıcı için. */
export function baseTokenValue(name: string): string {
  try {
    const root = document.documentElement;
    const inline = root.style.getPropertyValue(name);
    if (inline) root.style.removeProperty(name);
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    if (inline) root.style.setProperty(name, inline);
    return v;
  } catch { return ''; }
}

export function useDesign(): DesignState {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    () => state
  );
}

export function useDesignTheme(): ThemeKey {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    currentTheme
  );
}
