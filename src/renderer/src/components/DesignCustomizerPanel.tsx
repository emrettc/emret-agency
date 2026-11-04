import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import {
  applyPreset, baseTokenValue, resetDesign, setColor, setCommon, setLayout, setShadow,
  useDesign, useDesignTheme, DEFAULT_LAYOUT, THEME_PRESETS,
  type InboxButtonPlace, type InboxSide, type ThemeKey, type ThemePreset
} from '@/design/customizer';
import { appTheme, setAppTheme } from '@/design/theme';
import { notifyThemeChangeAll } from './terminalPool';

/**
 * Ayarlar > Görünüm — Dinamik Tasarım Paneli (ofis-customizer-01).
 * Her değişiklik anında <html> üzerine --cth-* override olarak yazılır ve
 * localStorage'a kaydedilir (design/customizer.ts). Renkler o anki temaya
 * (açık/koyu) aittir; ölçü, font ve yerleşim iki temada ortaktır.
 */

const COLOR_GROUPS: { key: string; tokens: string[] }[] = [
  { key: 'surfaces', tokens: ['--cth-cream-50', '--cth-cream-100', '--cth-cream-200', '--cth-cream-300', '--cth-paper-100', '--cth-paper-200'] },
  { key: 'ink', tokens: ['--cth-ink-900', '--cth-ink-700', '--cth-ink-500', '--cth-ink-300', '--cth-ink-100'] },
  { key: 'accents', tokens: ['--cth-coral', '--cth-mint', '--cth-sky', '--cth-lemon', '--cth-lilac', '--cth-peach'] }
];

interface Slider { token: string; labelKey: string; min: number; max: number; def: number; unit: string }
const SLIDERS: Slider[] = [
  { token: '--cth-radius', labelKey: 'radiusButton', min: 0, max: 16, def: 6, unit: 'px' },
  { token: '--cth-radius-panel', labelKey: 'radiusPanel', min: 0, max: 16, def: 0, unit: 'px' },
  { token: '--cth-radius-sm', labelKey: 'radiusSmall', min: 0, max: 8, def: 2, unit: 'px' },
  { token: '--cth-text-body-md', labelKey: 'textBody', min: 12, max: 18, def: 14, unit: 'px' },
  { token: '--cth-text-body-sm', labelKey: 'textSmall', min: 11, max: 16, def: 13, unit: 'px' }
];

const FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const FONTS: { id: string; label: string; value: string | null }[] = [
  { id: 'inter', label: 'Inter', value: null },
  { id: 'system', label: 'Segoe UI / Sistem', value: `"Segoe UI", ${FALLBACK}` },
  { id: 'serif', label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'JetBrains Mono', value: '"JetBrains Mono", ui-monospace, monospace' }
];

const head: CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, letterSpacing: 0.4,
  textTransform: 'uppercase', color: 'var(--cth-ink-700)', marginBottom: 8
};
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30 };
const label: CSSProperties = { flex: '0 0 190px', fontSize: 13, color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)' };
const hint: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-500)' };
const select: CSSProperties = {
  height: 28, padding: '0 8px', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
  border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 'var(--cth-radius-sm, 2px)'
};
const resetLink: CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--cth-sky)', padding: 0
};

/** Açık/koyu geçişi — başlık çubuğundaki ☾/☀ düğmesiyle aynı yan etkiler:
 *  çalışan TUI'lere haber ver, yeni ajanlar eşleşen terminal temasıyla açılsın. */
function switchMode(next: ThemeKey): void {
  if (appTheme() === next) return;
  setAppTheme(next);
  notifyThemeChangeAll(next);
  void window.cth.updateConfig({ terminalTheme: next });
}

function choosePreset(preset: ThemePreset): void {
  applyPreset(preset);
  switchMode(preset.mode);
}

function toHex6(v: string): string {
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return '#000000';
}

const LOGO_MAX_BYTES = 512 * 1024;

/** Başlık çubuğundaki logo: dosyadan yükle (en çok 512 KB) ya da varsayılana dön. */
function LogoSection({ p }: { p: (k: string) => string }) {
  const [logo, setLogo] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void window.cth.getConfig().then((c) => setLogo(c.brandLogo || null)).catch(() => { /* noop */ });
  }, []);
  const save = async (value: string | undefined): Promise<void> => {
    try {
      await window.cth.updateConfig({ brandLogo: value });
      setLogo(value ?? null);
      window.dispatchEvent(new CustomEvent('cth:logo-changed'));
      setMsg(value ? p('logoSaved') : p('logoReset'));
    } catch { setMsg(p('logoFailed')); }
  };
  const onFile = (file: File | undefined): void => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg(p('logoNotImage')); return; }
    if (file.size > LOGO_MAX_BYTES) { setMsg(p('logoTooBig')); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') void save(reader.result); };
    reader.onerror = () => setMsg(p('logoFailed'));
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <div style={head}>{p('logo')}</div>
      <div style={{ ...hint, marginBottom: 8 }}>{p('logoHint')}</div>
      <div style={{ ...row, flexWrap: 'wrap' }}>
        <div style={{
          height: 36, minWidth: 60, padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 'var(--cth-radius-sm, 2px)'
        }}>
          {logo
            ? <img src={logo} alt="" style={{ height: 24, maxWidth: 140, objectFit: 'contain' }} />
            : <span style={hint}>{p('logoDefault')}</span>}
        </div>
        <label style={{ display: 'inline-flex' }}>
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" style={{ display: 'none' }}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <span style={{
            padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--cth-font-ui)',
            background: 'var(--cth-cream-100)', color: 'var(--cth-ink-900)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 'var(--cth-radius, 6px)'
          }}>{p('logoChoose')}</span>
        </label>
        {logo && <PixelButton variant="secondary" size="sm" onClick={() => void save(undefined)}>{p('logoResetButton')}</PixelButton>}
        {msg && <span style={hint}>{msg}</span>}
      </div>
    </div>
  );
}

export function DesignCustomizerPanel() {
  const { t } = useTranslation();
  const design = useDesign();
  const theme = useDesignTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const p = (k: string): string => t(`designPanel.${k}`);

  // tokens.css'teki override'sız değerler — tema değişince yeniden okunur.
  const base = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of COLOR_GROUPS) for (const tok of g.tokens) out[tok] = toHex6(baseTokenValue(tok));
    return out;
  }, [theme]);

  const overrides = design.colors[theme];
  const fontNow = FONTS.find((f) => f.value === (design.common['--cth-font-ui'] ?? null))?.id ?? 'inter';
  const layoutChanged = design.layout.inboxSide !== DEFAULT_LAYOUT.inboxSide
    || design.layout.inboxWidth !== DEFAULT_LAYOUT.inboxWidth
    || design.layout.inboxButton !== DEFAULT_LAYOUT.inboxButton;

  return (
    <>
      <div>
        <div style={head}>{p('title')}</div>
        <div style={hint}>{p('intro')}</div>
      </div>

      <LogoSection p={p} />

      {/* TEMA — hazır temalar + açık/koyu */}
      <div>
        <div style={head}>{p('themes')}</div>
        <div style={{ ...row, marginBottom: 10 }}>
          <span style={label}>{p('mode')}</span>
          <PixelButton variant={theme === 'light' ? 'primary' : 'secondary'} size="sm" onClick={() => switchMode('light')}>☀ {p('modeLight')}</PixelButton>
          <PixelButton variant={theme === 'dark' ? 'primary' : 'secondary'} size="sm" onClick={() => switchMode('dark')}>☾ {p('modeDark')}</PixelButton>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {THEME_PRESETS.map((pr) => {
            const active = design.preset === pr.id && theme === pr.mode;
            const [ground, card, ink, accent] = pr.swatch;
            return (
              <button
                key={pr.id}
                type="button"
                onClick={() => choosePreset(pr)}
                aria-pressed={active}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 6, padding: 8, cursor: 'pointer', textAlign: 'left',
                  background: 'var(--cth-paper-100)', border: 'none',
                  borderRadius: 'var(--cth-radius-sm, 2px)',
                  boxShadow: active ? 'inset 0 0 0 2px var(--cth-ink-900)' : 'inset 0 0 0 1px var(--cth-ink-300)'
                }}
              >
                <div style={{
                  height: 44, borderRadius: 'var(--cth-radius-sm, 2px)', background: ground,
                  boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.35)', padding: 6,
                  display: 'flex', flexDirection: 'column', gap: 4
                }}>
                  <div style={{ height: 6, width: '60%', background: ink, borderRadius: 2 }} />
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1, background: card, borderRadius: 2 }} />
                    <div style={{ width: 18, background: accent, borderRadius: 2 }} />
                  </div>
                </div>
                <span style={{ fontSize: 12.5, color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)' }}>
                  {p(`preset.${pr.id}`)}
                </span>
                <span style={{ ...hint, fontSize: 11 }}>{pr.mode === 'dark' ? p('themeDark') : p('themeLight')}{active ? ' · ✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* RENKLER — o anki temaya özel */}
      <div>
        <div style={head}>{p('colors')} · {theme === 'dark' ? p('themeDark') : p('themeLight')}</div>
        <div style={{ ...hint, marginBottom: 8 }}>{p('colorsHint')}</div>
        {COLOR_GROUPS.map((g) => (
          <div key={g.key} style={{ marginBottom: 10 }}>
            <div style={{ ...hint, fontWeight: 600, marginBottom: 4 }}>{p(`group.${g.key}`)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
              {g.tokens.map((tok) => {
                const value = overrides[tok] ?? base[tok];
                const changed = tok in overrides;
                return (
                  <div key={tok} style={{ ...row, gap: 8 }}>
                    <input
                      type="color"
                      aria-label={tok}
                      value={value}
                      onChange={(e) => setColor(theme, tok, e.target.value)}
                      style={{ width: 34, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <span style={{ ...mono, color: changed ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)' }}>
                      {tok.replace('--cth-', '')}
                    </span>
                    {changed && (
                      <button type="button" style={resetLink} onClick={() => setColor(theme, tok, null)} title={p('resetOne')}>↺</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ŞEKİL — radius, yazı boyu, gölge, font */}
      <div>
        <div style={head}>{p('shape')}</div>
        {SLIDERS.map((s) => {
          const raw = design.common[s.token];
          const n = raw ? parseInt(raw, 10) : s.def;
          return (
            <div key={s.token} style={row}>
              <span style={label}>{p(s.labelKey)}</span>
              <input
                type="range" min={s.min} max={s.max} step={1} value={n}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCommon(s.token, v === s.def ? null : `${v}${s.unit}`);
                }}
                style={{ flex: 1, maxWidth: 260 }}
              />
              <span style={{ ...mono, width: 44 }}>{n}{s.unit}</span>
              {raw && <button type="button" style={resetLink} onClick={() => setCommon(s.token, null)} title={p('resetOne')}>↺</button>}
            </div>
          );
        })}
        <div style={row}>
          <span style={label}>{p('shadow')}</span>
          <input
            type="range" min={0} max={100} step={5} value={design.shadow ?? 40}
            onChange={(e) => setShadow(Number(e.target.value))}
            style={{ flex: 1, maxWidth: 260 }}
          />
          <span style={{ ...mono, width: 44 }}>{design.shadow === null ? p('default') : `%${design.shadow}`}</span>
          {design.shadow !== null && <button type="button" style={resetLink} onClick={() => setShadow(null)} title={p('resetOne')}>↺</button>}
        </div>
        <div style={row}>
          <span style={label}>{p('font')}</span>
          <select
            value={fontNow}
            onChange={(e) => {
              const f = FONTS.find((x) => x.id === e.target.value);
              setCommon('--cth-font-ui', f?.value ?? null);
              setCommon('--cth-font-display', f?.value ?? null);
            }}
            style={select}
          >
            {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {/* YERLEŞİM — Human Inbox */}
      <div>
        <div style={head}>{p('layout')}</div>
        <div style={row}>
          <span style={label}>{p('inboxSide')}</span>
          <select value={design.layout.inboxSide} onChange={(e) => setLayout({ inboxSide: e.target.value as InboxSide })} style={select}>
            <option value="right">{p('right')}</option>
            <option value="left">{p('left')}</option>
          </select>
        </div>
        <div style={row}>
          <span style={label}>{p('inboxWidth')}</span>
          <input
            type="range" min={480} max={1400} step={20} value={design.layout.inboxWidth}
            onChange={(e) => setLayout({ inboxWidth: Number(e.target.value) })}
            style={{ flex: 1, maxWidth: 260 }}
          />
          <span style={{ ...mono, width: 56 }}>{design.layout.inboxWidth}px</span>
        </div>
        <div style={row}>
          <span style={label}>{p('inboxButton')}</span>
          <select value={design.layout.inboxButton} onChange={(e) => setLayout({ inboxButton: e.target.value as InboxButtonPlace })} style={select}>
            <option value="start">{p('buttonStart')}</option>
            <option value="end">{p('buttonEnd')}</option>
            <option value="hidden">{p('buttonHidden')}</option>
          </select>
        </div>
        {design.layout.inboxButton === 'hidden' && <div style={hint}>{p('hiddenHint')}</div>}
        {layoutChanged && (
          <button type="button" style={{ ...resetLink, marginTop: 4 }} onClick={() => setLayout({ ...DEFAULT_LAYOUT })}>↺ {p('resetLayout')}</button>
        )}
      </div>

      {/* VARSAYILANA DÖN */}
      <div style={{ ...row, justifyContent: 'flex-end', gap: 8 }}>
        {confirmReset ? (
          <>
            <span style={hint}>{p('resetConfirm')}</span>
            <PixelButton variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>{t('common.cancel')}</PixelButton>
            <PixelButton variant="destructive" size="sm" onClick={() => { resetDesign(); setConfirmReset(false); }}>{p('resetAll')}</PixelButton>
          </>
        ) : (
          <PixelButton variant="secondary" size="sm" onClick={() => setConfirmReset(true)}>{p('resetAll')}</PixelButton>
        )}
      </div>
    </>
  );
}
