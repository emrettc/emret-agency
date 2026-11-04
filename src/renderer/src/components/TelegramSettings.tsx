import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { pillButton } from './SiteNav';

/**
 * Ayarlar → Bağlantılar → Telegram (main/telegram.ts) ve Ayarlar → Genel →
 * Günlük özet. Bot anahtarı main'de şifreli saklanır, buraya hiç geri gelmez.
 */

type Status = Awaited<ReturnType<typeof window.cth.telegramStatus>>;

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10,
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
};
const title: CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)' };
const desc: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '17px' };
const input: CSSProperties = {
  flex: 1, height: 32, padding: '0 10px', borderRadius: 8, border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-paper-100)',
  color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13
};
const step = (on: boolean): CSSProperties => ({
  width: 22, height: 22, borderRadius: 11, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, background: on ? 'var(--cth-mint)' : 'var(--cth-cream-300)', color: 'var(--cth-on-accent)'
});

export function TelegramSettings() {
  const { t } = useTranslation();
  const g = (k: string, o?: Record<string, unknown>): string => t(`telegram.${k}`, o ?? {});
  const [st, setSt] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => { setSt(await window.cth.telegramStatus().catch(() => null)); }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string): Promise<void> => {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? g('failed') });
    } finally { setBusy(null); void load(); }
  };

  const paired = !!st?.chatId;
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>✈️</span>
        <span style={title}>Telegram</span>
        {st && paired && (
          <span style={{
            fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 600, color: 'var(--cth-on-accent)',
            background: st.running ? 'var(--cth-mint)' : 'var(--cth-cream-300)'
          }}>{st.running ? g('connected') : g('off')}</span>
        )}
        {st?.botName && <span style={desc}>@{st.botName}</span>}
      </div>
      <div style={desc}>{g('intro')}</div>

      {/* 1) Bot anahtarı */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={step(!!st?.hasToken)}>{st?.hasToken ? '✓' : '1'}</span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>
            {g('step1')}{' '}
            <a href="https://t.me/BotFather" onClick={(e) => { e.preventDefault(); void window.cth.openExternal('https://t.me/BotFather'); }}
              style={{ color: 'var(--cth-sky)' }}>@BotFather</a>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={st?.hasToken ? g('tokenStored') : g('tokenPlaceholder')} style={input}
            />
            <button type="button" style={pillButton('outline')} disabled={!token.trim() || !!busy}
              onClick={() => void run('token', async () => {
                const r = await window.cth.telegramSetToken(token);
                if (r.ok) setToken('');
                return r;
              }, g('tokenSaved'))}>
              {busy === 'token' ? g('checking') : g('saveToken')}
            </button>
          </div>
        </div>
      </div>

      {/* 2) Eşleştir */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: st?.hasToken ? 1 : 0.5 }}>
        <span style={step(paired)}>{paired ? '✓' : '2'}</span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>
            {busy === 'pair' ? g('pairWaiting', { bot: st?.botName ? `@${st.botName}` : g('yourBot') }) : paired ? g('paired') : g('step2')}
          </div>
          <div>
            <button type="button" style={pillButton(paired ? 'outline' : 'solid')} disabled={!st?.hasToken || !!busy}
              onClick={() => void run('pair', () => window.cth.telegramPair(), g('pairDone'))}>
              {busy === 'pair' ? g('pairing') : paired ? g('repair') : g('pair')}
            </button>
          </div>
        </div>
      </div>

      {/* 3) Ayarlar */}
      {paired && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={step(!!st?.running)}>3</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--cth-ink-900)' }}>
              <input type="checkbox" checked={!!st?.enabled} onChange={(e) => void run('en', () => window.cth.telegramSetEnabled(e.target.checked), g('saved'))} />
              {g('enabled')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--cth-ink-900)' }}>
              <input type="checkbox" checked={!!st?.notify} onChange={(e) => void run('notify', () => window.cth.telegramSetNotify(e.target.checked), g('saved'))} />
              {g('notify')}
            </label>
            <div style={desc}>{g('commands')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={pillButton('outline')} disabled={!st?.running || !!busy}
                onClick={() => void run('test', () => window.cth.telegramTest(), g('testSent'))}>{g('test')}</button>
              <button type="button" style={pillButton('danger')} disabled={!!busy}
                onClick={() => { if (window.confirm(g('disconnectConfirm'))) void run('dc', () => window.cth.telegramDisconnect(), g('disconnected')); }}>
                {g('disconnect')}
              </button>
            </div>
          </div>
        </div>
      )}
      {st?.error && st.enabled && <div style={{ ...desc, color: 'var(--cth-coral)' }}>⚠ {st.error}</div>}
      {msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--cth-ink-700)' : 'var(--cth-coral)' }}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}
    </div>
  );
}

export function DailySummarySettings({ initialHour }: { initialHour?: number }) {
  const { t } = useTranslation();
  const g = (k: string, o?: Record<string, unknown>): string => t(`dailySummary.${k}`, o ?? {});
  const [hour, setHour] = useState<number>(initialHour ?? 9);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{g('label')}</span>
        <select
          value={hour}
          onChange={(e) => { const h = Number(e.target.value); setHour(h); void window.cth.updateConfig({ dailySummaryHour: h }); }}
          style={{ ...input, flex: 'none', width: 'auto' }}
        >
          <option value={-1}>{g('off')}</option>
          {[6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20].map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
        </select>
        <button type="button" style={pillButton('outline')} disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await window.cth.summaryNow().catch((e) => ({ ok: false, error: String(e) }));
            setBusy(false);
            setNote(r.ok ? g('sent') : (r.error ?? g('failed')));
          }}>{busy ? g('sending') : g('now')}</button>
      </div>
      <div style={desc}>{g('hint')}</div>
      {note && <div style={desc}>{note}</div>}
    </div>
  );
}
