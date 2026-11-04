import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import type { ReviewItemView, ReviewMergeView } from '../../../preload/index';
import { pillButton } from './SiteNav';
import { Icon } from './Icon';

/**
 * İnceleme ve Birleştirme Masası (main/reviewDesk.ts): ajanların kendi
 * dallarında bitirdiği işler. Her kart: ne değişti, testler, ve karar —
 * birleştir / düzeltme iste / reddet. Son birleştirmeler geri alınabilir.
 */

const REFRESH_MS = 20_000;

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 14,
  background: 'var(--cth-paper-100)', borderRadius: 10,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px var(--cth-ink-100)'
};
const chip = (bg: string, fg = 'var(--cth-on-accent)'): CSSProperties => ({
  fontSize: 11, padding: '1px 8px', borderRadius: 10, background: bg, color: fg, whiteSpace: 'nowrap', fontWeight: 600
});
const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)' };

function timeAgo(iso: string, lng: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' });
  const s = Math.round((t - Date.now()) / 1000);
  if (Math.abs(s) < 60) return rtf.format(s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

function DiffView({ text }: { text: string }) {
  return (
    <pre style={{
      margin: 0, maxHeight: 420, overflow: 'auto', padding: 10, borderRadius: 8,
      background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
      fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '17px'
    }}>
      {text.split('\n').map((l, i) => {
        const add = l.startsWith('+') && !l.startsWith('+++');
        const del = l.startsWith('-') && !l.startsWith('---');
        const head = l.startsWith('@@') || l.startsWith('diff --git');
        return (
          <div key={i} style={{
            background: add ? 'var(--cth-mint-light)' : del ? 'var(--cth-coral-light)' : 'transparent',
            color: head ? 'var(--cth-sky)' : 'var(--cth-ink-900)', fontWeight: l.startsWith('diff --git') ? 700 : 400,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all'
          }}>{l || ' '}</div>
        );
      })}
    </pre>
  );
}

function ReviewCard({ it, onChanged }: { it: ReviewItemView; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const r = (k: string, o?: Record<string, unknown>): string => t(`review.${k}`, o ?? {});
  const agents = useStore((s) => s.agents);
  const archived = useStore((s) => s.archivedAgents);
  const name = [...agents, ...archived].find((a) => a.id === it.agentId)?.name ?? it.agentId;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string): Promise<void> => {
    setBusy(key); setMsg(null);
    try {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? r('failed') });
      if (res.ok) onChanged();
    } finally { setBusy(null); }
  };

  const tests = it.tests;
  const testBadge = !it.hasTestScript ? null
    : !tests ? <span style={chip('var(--cth-cream-300)', 'var(--cth-ink-700)')}>{r('testsNotRun')}</span>
      : tests.ok ? <span style={chip('var(--cth-mint)')}>✓ {r('testsPassed')}</span>
        : <span style={chip('var(--cth-coral)')}>✗ {r('testsFailed')}</span>;
  const canMergeCleanly = !it.hasTestScript || !!tests?.ok;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15, color: 'var(--cth-ink-900)' }}>{name}</strong>
        <span style={{ ...muted, fontFamily: 'var(--cth-font-mono)' }}>{it.repoName} · {it.branch} → {it.baseBranch}</span>
        <span style={{ flex: 1 }} />
        {it.live && <span style={chip('var(--cth-sky-light)', 'var(--cth-ink-900)')}>{r('agentWorking')}</span>}
        {it.dirty && <span style={chip('var(--cth-lemon-light)', 'var(--cth-ink-900)')}>{r('uncommitted')}</span>}
        {testBadge}
        <span style={muted}>{timeAgo(it.updatedAt, i18n.language)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ ...muted, fontWeight: 600, marginBottom: 4 }}>{r('commits', { count: it.ahead })}</div>
          {it.commits.length === 0 && <div style={muted}>{r('noCommits')}</div>}
          {it.commits.slice(0, 6).map((c) => (
            <div key={c.sha} style={{ fontSize: 13, color: 'var(--cth-ink-900)', display: 'flex', gap: 6 }}>
              <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-500)' }}>{c.sha}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...muted, fontWeight: 600, marginBottom: 4 }}>{r('files', { count: it.files.length })}</div>
          {it.files.slice(0, 8).map((f) => (
            <div key={f.path} style={{ fontSize: 12, display: 'flex', gap: 6, fontFamily: 'var(--cth-font-mono)' }}>
              <span style={{ color: 'var(--cth-mint)' }}>+{f.added}</span>
              <span style={{ color: 'var(--cth-coral)' }}>−{f.removed}</span>
              <span style={{ color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
            </div>
          ))}
          {it.files.length > 8 && <div style={muted}>{r('moreFiles', { count: it.files.length - 8 })}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" style={pillButton('outline')} disabled={!!busy}
          onClick={async () => {
            if (diff !== null) { setDiff(null); return; }
            setBusy('diff');
            const d: { ok: boolean; diff?: string; error?: string } = await window.cth.reviewDiff(it.id).catch((e) => ({ ok: false, error: String(e) }));
            setBusy(null);
            if (d.ok) setDiff(d.diff ?? ''); else setMsg({ ok: false, text: d.error ?? r('failed') });
          }}>
          <Icon name="code" /> {diff !== null ? r('hideDiff') : busy === 'diff' ? r('loading') : r('showDiff')}
        </button>
        <button type="button" style={pillButton('outline')} disabled={!!busy}
          onClick={async () => {
            setBusy('test'); setMsg(null);
            const res: { ok: boolean; output?: string; skipped?: boolean; error?: string } = await window.cth.reviewTest(it.id).catch((e) => ({ ok: false, error: String(e) }));
            setBusy(null);
            setTestOut(res.output ?? res.error ?? '');
            setMsg({ ok: res.ok, text: res.skipped ? r('testsNone') : res.ok ? r('testsPassed') : r('testsFailed') });
            onChanged();
          }}>
          <Icon name="check" /> {busy === 'test' ? r('testsRunning') : r('runTests')}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" style={pillButton('outline')} disabled={!!busy} onClick={() => setAsking((v) => !v)}>
          {r('requestChanges')}
        </button>
        <button type="button" style={pillButton('danger')} disabled={!!busy || it.live}
          title={it.live ? r('rejectLive') : undefined}
          onClick={() => {
            if (!window.confirm(r('rejectConfirm', { name, branch: it.branch }))) return;
            void act('reject', () => window.cth.reviewReject(it.id), r('rejected'));
          }}>
          {r('reject')}
        </button>
        <button type="button" style={pillButton('solid')} disabled={!!busy || it.ahead === 0}
          title={it.ahead === 0 ? r('nothingToMerge') : undefined}
          onClick={() => {
            const force = !canMergeCleanly;
            if (force && !window.confirm(tests ? r('forceFailedConfirm') : r('forceUntestedConfirm'))) return;
            void act('merge', () => window.cth.reviewMerge(it.id, force), r('merged', { base: it.baseBranch }));
          }}>
          <Icon name="check" /> {busy === 'merge' ? r('merging') : canMergeCleanly ? r('merge') : r('mergeAnyway')}
        </button>
      </div>

      {asking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={r('notePlaceholder')}
            style={{
              flex: 1, padding: 8, borderRadius: 8, border: 'none', resize: 'vertical',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-paper-100)',
              color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13
            }}
          />
          <button type="button" style={pillButton('solid')} disabled={!note.trim() || !!busy}
            onClick={() => void act('ask', async () => {
              const res = await window.cth.reviewRequestChanges(it.id, note);
              if (res.ok) { setNote(''); setAsking(false); }
              return res;
            }, r('changesSent', { name }))}>
            {r('send')}
          </button>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--cth-ink-700)' : 'var(--cth-coral)' }}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}
      {testOut !== null && (
        <pre style={{
          margin: 0, maxHeight: 200, overflow: 'auto', padding: 8, borderRadius: 8, fontSize: 11,
          background: 'var(--cth-cream-100)', fontFamily: 'var(--cth-font-mono)', whiteSpace: 'pre-wrap'
        }}>{testOut}</pre>
      )}
      {diff !== null && <DiffView text={diff || r('emptyDiff')} />}
    </div>
  );
}

export function ReviewDeskTab() {
  const { t, i18n } = useTranslation();
  const r = (k: string, o?: Record<string, unknown>): string => t(`review.${k}`, o ?? {});
  const [items, setItems] = useState<ReviewItemView[] | null>(null);
  const [merges, setMerges] = useState<ReviewMergeView[]>([]);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [list, m] = await Promise.all([
      window.cth.reviewList().catch(() => [] as ReviewItemView[]),
      window.cth.reviewMerges().catch(() => [] as ReviewMergeView[])
    ]);
    setItems(list);
    setMerges(m);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--cth-cream-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={muted}>{r('intro')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={pillButton('outline')} onClick={() => void load()}>↻ {r('refresh')}</button>
      </div>

      {items === null && <div style={muted}>{r('loading')}</div>}
      {items && items.length === 0 && (
        <div style={{ ...card, alignItems: 'center', textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 28 }}>✓</div>
          <strong style={{ color: 'var(--cth-ink-900)' }}>{r('emptyTitle')}</strong>
          <span style={muted}>{r('emptyBody')}</span>
        </div>
      )}
      {items?.map((it) => <ReviewCard key={it.id} it={it} onChanged={() => void load()} />)}

      {merges.length > 0 && (
        <div style={card}>
          <strong style={{ fontSize: 14, color: 'var(--cth-ink-900)' }}>{r('recentMerges')}</strong>
          {merges.slice(0, 10).map((m) => (
            <div key={m.sha} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-500)' }}>{m.sha.slice(0, 8)}</span>
              <span style={{ color: 'var(--cth-ink-900)', textDecoration: m.reverted ? 'line-through' : 'none' }}>{m.branch} → {m.base}</span>
              <span style={muted}>{timeAgo(m.at, i18n.language)}</span>
              <span style={{ flex: 1 }} />
              {m.reverted
                ? <span style={muted}>{r('reverted')}</span>
                : (
                  <button type="button" style={pillButton('outline')}
                    onClick={async () => {
                      if (!window.confirm(r('undoConfirm', { branch: m.branch }))) return;
                      const res = await window.cth.reviewUndo(m.sha);
                      setNote(res.ok ? r('undone') : res.error ?? r('failed'));
                      void load();
                    }}>↶ {r('undo')}</button>
                )}
            </div>
          ))}
          {note && <div style={muted}>{note}</div>}
        </div>
      )}
    </div>
  );
}
