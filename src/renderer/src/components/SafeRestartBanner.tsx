import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { pillButton } from '@/components/SiteNav';

/**
 * Güvenli yeniden başlatma (Dosya → Güvenli yeniden başlat): ajanların işini
 * yarıda kesmemek için hepsi BOŞALANA kadar bekler — çalışan/düşünen ajan
 * kalmadıktan sonra 45 sn daha sessizlik — sonra main'e "şimdi" der. Beklerken
 * üstte bir şerit sayar; "Şimdi" ve "Vazgeç" düğmeleri var.
 */

const BUSY = new Set(['thinking', 'working', 'compacting', 'looping']);
const QUIET_MS = 45_000;

export function SafeRestartBanner() {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, unknown>): string => t(`safeRestart.${k}`, o ?? {});
  const agents = useStore((st) => st.agents);
  const [pending, setPending] = useState(false);
  const [dev, setDev] = useState(false);
  const [quietSince, setQuietSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => window.cth.onSafeRestartRequest?.(() => {
    setPending(true);
    void window.cth.safeRestartInfo().then((i) => setDev(i.dev)).catch(() => { /* noop */ });
  }), []);

  const busy = agents.filter((a) => a.status && BUSY.has(a.status));
  useEffect(() => {
    if (!pending) { setQuietSince(null); return; }
    if (busy.length > 0) setQuietSince(null);
    else setQuietSince((q) => q ?? Date.now());
  }, [pending, busy.length]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    if (pending && quietSince !== null && now - quietSince >= QUIET_MS) {
      setPending(false);
      void window.cth.safeRelaunchNow();
    }
  }, [pending, quietSince, now]);

  if (!pending) return null;
  const left = quietSince === null ? null : Math.max(0, Math.ceil((QUIET_MS - (now - quietSince)) / 1000));
  const verb = dev ? s('close') : s('restart');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', flexShrink: 0,
      background: 'var(--cth-lemon-light)', borderBottom: '1px solid var(--cth-ink-300)', fontSize: 13, color: 'var(--cth-ink-900)'
    }}>
      <strong>⟳ {s('title', { verb })}</strong>
      <span>
        {busy.length > 0
          ? s('waiting', { count: busy.length, names: busy.slice(0, 4).map((a) => a.name).join(', '), verb })
          : s('quiet', { seconds: left ?? 0, verb })}
      </span>
      {dev && <span style={{ color: 'var(--cth-ink-500)' }}>{s('devNote')}</span>}
      <span style={{ flex: 1 }} />
      <button type="button" style={pillButton('solid')} onClick={() => { setPending(false); void window.cth.safeRelaunchNow(); }}>{s('now', { verb })}</button>
      <button type="button" style={pillButton('outline')} onClick={() => setPending(false)}>{s('cancel')}</button>
    </div>
  );
}
