import i18n from '@/i18n';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

/**
 * Site menüsü — panellerin web sitesi tarzı üst çubuğu (Komuta Merkezi, ajan
 * detay paneli): solda marka, ortada menü bağlantıları (aktif sayfanın altı
 * vurgu rengiyle çizili), sığmayanlar "Daha fazla" açılır menüsünde, sağda
 * yuvarlak eylem düğmeleri. Altına `PageHeader` yol göstergesi + başlık koyar.
 */

export interface SiteNavItem<K extends string> {
  key: K; label: string; icon: IconName;
  /** Bekleyen bildirim sayısı (soru, onay, inceleme…); 0/boş ⇒ rozet yok. */
  badge?: number;
}

/** İlk harfi dilin kuralıyla büyütür: CSS `capitalize` / `toUpperCase()` Türkçe
 *  "izleme"yi "Izleme", "izler"i "IZLER" yapıyordu; doğrusu "İzleme", "İZLER". */
export function pageTitle(label: string): string {
  return label ? label.charAt(0).toLocaleUpperCase(i18n.language) + label.slice(1) : label;
}

/** Bildirim rozeti: 1 ⇒ kırmızı nokta, 2+ ⇒ kırmızı sayı (99+). */
export function NavBadge({ count, pulse = false }: { count?: number; pulse?: boolean }) {
  if (!count || count <= 0) return null;
  const common: CSSProperties = {
    background: 'var(--cth-coral, #e5484d)', color: '#fff', flexShrink: 0,
    boxShadow: '0 0 0 2px var(--cth-paper-100)',
    animation: pulse ? 'cth-badge-pulse 1.6s ease-in-out infinite' : undefined
  };
  if (count === 1) return <span aria-hidden style={{ ...common, width: 9, height: 9, borderRadius: 5, display: 'inline-block' }} />;
  return (
    <span aria-hidden style={{
      ...common, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, boxSizing: 'border-box',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--cth-font-ui)', fontSize: 11, fontWeight: 700, lineHeight: 1
    }}>{count > 99 ? '99+' : count}</span>
  );
}

const BADGE_KEYFRAMES = '@keyframes cth-badge-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }';

export function pillButton(kind: 'solid' | 'outline' | 'danger'): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
    height: 30, minWidth: 30, padding: '0 12px', borderRadius: 15, cursor: 'pointer',
    fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600, border: 'none',
    background: kind === 'solid' ? 'var(--cth-ink-900)' : kind === 'danger' ? 'var(--cth-coral)' : 'transparent',
    color: kind === 'solid' ? 'var(--cth-paper-100)' : kind === 'danger' ? 'var(--cth-on-accent)' : 'var(--cth-ink-900)',
    boxShadow: kind === 'outline' ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'none'
  };
}

export function SiteNav<K extends string>({ brand, items, active, onSelect, actions, accent, inlineFor, dropdown = false, pinned }: {
  /** Sol taraftaki marka bloğu; `compact` dar ekranda yalnız simgeyi göstermek için. */
  brand: (compact: boolean) => ReactNode;
  items: SiteNavItem<K>[];
  active: K;
  onSelect: (k: K) => void;
  actions?: ReactNode;
  /** Aktif bağlantının alt çizgisi (CSS rengi). */
  accent: string;
  /** Menü genişliğine göre kaç bağlantının menüde kalacağı; kalanlar "Daha fazla"ya. */
  inlineFor?: (width: number) => number;
  /** Bağlantılar yerine açılır menü. `pinned` verilirse o sayfalar (bu sırayla)
   *  menünün solunda sabit bağlantı olur, kalanlar açılır menüde. */
  dropdown?: boolean;
  pinned?: K[];
}) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hover, setHover] = useState<K | null>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setWidth(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && navRef.current?.contains(e.target as Node)) return;
      setMoreOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [moreOpen]);

  const inline = dropdown ? 0 : Math.max(1, (inlineFor ?? defaultInline)(width));
  let shown = dropdown
    ? (pinned ?? []).map((k) => items.find((x) => x.key === k)).filter((x): x is SiteNavItem<K> => !!x)
    : items.slice(0, inline);
  // Aktif sayfa "Daha fazla"da kalmasın: görünür son bağlantının yerine geçer.
  if (!dropdown && !shown.some((x) => x.key === active)) {
    const cur = items.find((x) => x.key === active);
    if (cur) shown = [...shown.slice(0, Math.max(0, inline - 1)), cur];
  }
  const more = items.filter((x) => !shown.includes(x));
  // Açılır menünün düğmesi: açık sayfa menüdeyse onun adı, değilse "Diğer".
  const current = more.find((x) => x.key === active);
  // Menüde gizli kalan sayfalardaki bildirimler: düğmede toplamı yanıp söner.
  const hiddenAlerts = more.filter((x) => (x.badge ?? 0) > 0 && x.key !== active);
  const hiddenTotal = hiddenAlerts.reduce((a, x) => a + (x.badge ?? 0), 0);

  const link = (x: SiteNavItem<K>) => {
    const on = x.key === active;
    return (
      <button
        key={x.key}
        type="button"
        onClick={() => { onSelect(x.key); setMoreOpen(false); }}
        onMouseEnter={() => setHover(x.key)}
        onMouseLeave={() => setHover(null)}
        aria-current={on ? 'page' : undefined}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 52, padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer',
          fontFamily: 'var(--cth-font-ui)', fontSize: 14, fontWeight: on ? 700 : 500, whiteSpace: 'nowrap',
          color: on || hover === x.key ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'
        }}
      >
        <Icon name={x.icon} /> {pageTitle(x.label)}
        <NavBadge count={x.badge} />
        <span aria-hidden style={{
          position: 'absolute', left: 10, right: 10, bottom: 0, height: 3, borderRadius: '3px 3px 0 0',
          background: on ? accent : hover === x.key ? 'var(--cth-ink-100)' : 'transparent'
        }} />
      </button>
    );
  };

  return (
    <div
      ref={navRef}
      role="navigation"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
        height: 52, padding: '0 12px 0 14px', flexShrink: 0,
        background: 'var(--cth-paper-100)', borderBottom: '1px solid var(--cth-ink-300)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0 }}>{brand(width < 560)}</div>
      <div className="cth-tabbar" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0, justifyContent: dropdown ? 'flex-start' : 'center' }}>
        {shown.map(link)}
        {more.length > 0 && (
          <div style={{ position: 'relative', display: 'flex' }}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, height: 52, padding: '0 12px',
                border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'var(--cth-font-ui)', fontSize: 14, fontWeight: 500,
                color: moreOpen ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'
              }}
            >
              {dropdown
                ? <><span aria-hidden style={{ fontSize: 15 }}>☰</span>{current ? <><Icon name={current.icon} /> <strong>{pageTitle(current.label)}</strong></> : t('commandCenter.navOther')}</>
                : t('commandCenter.navMore')}
              <NavBadge count={hiddenTotal} pulse />
              <span style={{ fontSize: 10 }}>{moreOpen ? '▴' : '▾'}</span>
            </button>
            {moreOpen && (
              <div role="menu" style={{
                position: 'absolute', top: 48, ...(dropdown ? { left: 0 } : { right: 0 }), zIndex: 50, minWidth: 240, padding: 6,
                maxHeight: '70vh', overflowY: 'auto',
                background: 'var(--cth-paper-100)', borderRadius: 10,
                boxShadow: '0 10px 30px rgba(0,0,0,0.18), inset 0 0 0 1px var(--cth-ink-100)'
              }}>
                {more.map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    role="menuitem"
                    onClick={() => { onSelect(x.key); setMoreOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
                      border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)',
                      background: x.key === active ? 'var(--cth-cream-200)' : 'transparent'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cth-cream-200)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = x.key === active ? 'var(--cth-cream-200)' : 'transparent'; }}
                  >
                    <Icon name={x.icon} />
                    <span style={{ flex: 1, fontWeight: x.badge ? 700 : undefined }}>{pageTitle(x.label)}</span>
                    {!!x.badge && <span style={{ fontSize: 11, color: 'var(--cth-coral, #e5484d)', whiteSpace: 'nowrap' }}>{t('commandCenter.navPending', { count: x.badge })}</span>}
                    <NavBadge count={x.badge} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {hiddenAlerts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hiddenAlerts.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => { onSelect(x.key); setMoreOpen(false); }}
              className="cth-tip"
              data-tip={t('commandCenter.navAlertTip', { page: pageTitle(x.label), count: x.badge })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 14,
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: 'var(--cth-coral, #e5484d)', color: '#fff',
                fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 700,
                animation: 'cth-badge-pulse 1.6s ease-in-out infinite'
              }}
            >
              🔔 {t('commandCenter.navAlert', { page: pageTitle(x.label), count: x.badge })}
            </button>
          ))}
        </div>
      )}
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
      <style>{BADGE_KEYFRAMES}</style>
    </div>
  );
}

const defaultInline = (w: number): number => (w >= 1250 ? 8 : w >= 1050 ? 6 : w >= 820 ? 4 : w >= 620 ? 3 : 2);

/** Sayfa başlığı: yol göstergesi (`A › B › C`), başlık ve tek satır açıklama.
 *  `compact`: başlık yol göstergesinin son parçası olur, tek satır. */
export function PageHeader({ crumbs, title, desc, compact = false, extra }: {
  crumbs: string[];
  title: string;
  desc?: string;
  compact?: boolean;
  /** Satırın sağında gösterilecek ek içerik (ör. ajanın yetenek etiketleri). */
  extra?: ReactNode;
}) {
  const trail = (
    <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {i > 0 && <span aria-hidden style={{ opacity: 0.6 }}>›</span>}
          <span>{c}</span>
        </span>
      ))}
      {compact && <><span aria-hidden style={{ opacity: 0.6 }}>›</span><strong style={{ color: 'var(--cth-ink-900)' }}>{pageTitle(title)}</strong></>}
    </span>
  );
  return (
    <div style={{
      padding: compact ? '6px 14px' : '10px 16px 8px', background: 'var(--cth-paper-100)',
      borderBottom: '1px solid var(--cth-ink-100)', flexShrink: 0, minWidth: 0
    }}>
      {compact ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {trail}
          {desc && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{desc}</span>}
          {extra && <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{extra}</span>}
        </div>
      ) : (
        <>
          {trail}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 18, lineHeight: '24px', fontWeight: 700, color: 'var(--cth-ink-900)' }}>
              {pageTitle(title)}
            </h2>
            {desc && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', minWidth: 0 }}>{desc}</span>}
          </div>
        </>
      )}
    </div>
  );
}
