import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';

/**
 * The human's approval queue (hive/onaylar.json), shown at the top of ASK ME.
 *
 * Agents file decisions that belong to the human alone here (to: "onay"):
 * ad spend, live ad-account changes, creatives going public. Each item shows
 * the proposal, its cost and attached creatives; the human approves, asks for a
 * revision, or rejects, with an optional note. The answer goes to the agent
 * that asked and a copy to the project lead (see HiveManager.answerApproval).
 */

type Status = 'bekliyor' | 'onaylandi' | 'revize' | 'reddedildi';
interface Approval {
  id: string; from: string; title: string; body: string; files: string[];
  cost?: string; status: Status; note?: string; createdAt: string; answeredAt?: string;
}

const POLL_MS = 5000;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

function parse(raw: unknown): Approval[] {
  return Array.isArray(raw) ? raw.filter((a): a is Approval => !!a && typeof a === 'object' && typeof (a as Approval).id === 'string') : [];
}

function Thumb({ id, file }: { id: string; file: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void window.cth.hiveApprovalImage?.(id, file).then((u) => { if (live) setSrc(u); }).catch(() => {});
    return () => { live = false; };
  }, [id, file]);
  const name = file.split(/[\\/]/).pop();
  return (
    <button
      type="button"
      onClick={() => { void window.cth.revealPath(file).catch(() => {}); }}
      title={file}
      style={{ border: 'none', padding: 0, background: 'var(--cth-paper-200)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 132 }}
    >
      {src
        ? <img src={src} alt={name} style={{ width: 132, height: 132, objectFit: 'contain', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }} />
        : <div style={{ width: 132, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--cth-ink-500)' }}>📄</div>}
      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', maxWidth: 132, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </button>
  );
}

export function ApprovalQueue() {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  const [items, setItems] = useState<Approval[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const refresh = useCallback(async () => {
    try { setItems(parse(await window.cth.hiveApprovals?.())); } catch { /* keep last good */ }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const nameFor = (id: string): string =>
    agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id;

  const answer = async (item: Approval, status: Exclude<Status, 'bekliyor'>) => {
    const note = (notes[item.id] ?? '').trim();
    if (status === 'revize' && !note) { setError(t('approvals.needNote')); return; }
    setBusy(item.id); setError(null);
    try {
      const res = await window.cth.hiveAnswerApproval(item.id, status, note);
      if (!res.ok) setError(res.error ?? t('approvals.failed'));
      else setNotes((n) => { const { [item.id]: _drop, ...rest } = n; return rest; });
      await refresh();
    } catch {
      setError(t('approvals.restartNeeded'));
    } finally { setBusy(null); }
  };

  const pending = items.filter((a) => a.status === 'bekliyor').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = items.filter((a) => a.status !== 'bekliyor').sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? '')).slice(0, 15);
  if (!pending.length && !done.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)', letterSpacing: 1 }}>
        {t('approvals.title', { count: pending.length })}
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--cth-coral)' }}>{error}</div>}
      {pending.map((a) => (
        <div key={a.id} style={{ background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 2px var(--cth-coral)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', background: 'var(--cth-paper-200)', boxShadow: 'inset 0 -1px 0 var(--cth-ink-700)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{nameFor(a.from)}</span>
          </div>
          <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.cost && <div style={{ fontSize: 14, color: 'var(--cth-ink-900)' }}><b>{t('approvals.cost')}:</b> {a.cost}</div>}
            <div style={{ fontSize: 15, lineHeight: '19px', color: 'var(--cth-ink-900)' }}>
              <MarkdownPreview source={a.body} variant="card" />
            </div>
            {a.files.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {a.files.map((f) => IMAGE_RE.test(f) ? <Thumb key={f} id={a.id} file={f} /> : <Thumb key={f} id="" file={f} />)}
              </div>
            )}
            <textarea
              value={notes[a.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
              rows={2}
              placeholder={t('approvals.notePlaceholder')}
              style={{ resize: 'vertical', padding: 6, fontFamily: 'var(--cth-font-mono)', fontSize: 14, background: 'var(--cth-paper-200)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-900)' }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <PixelButton variant="secondary" size="sm" disabled={busy === a.id} onClick={() => void answer(a, 'reddedildi')}>{t('approvals.reject')}</PixelButton>
              <PixelButton variant="secondary" size="sm" disabled={busy === a.id} onClick={() => void answer(a, 'revize')}>{t('approvals.revise')}</PixelButton>
              <PixelButton variant="primary" size="sm" disabled={busy === a.id} onClick={() => void answer(a, 'onaylandi')}>{t('approvals.approve')}</PixelButton>
            </div>
          </div>
        </div>
      ))}
      {done.length > 0 && (
        <button type="button" onClick={() => setShowDone((v) => !v)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--cth-ink-500)', textDecoration: 'underline' }}>
          {showDone ? t('approvals.hideDone') : t('approvals.showDone', { count: done.length })}
        </button>
      )}
      {showDone && done.map((a) => (
        <div key={a.id} style={{ fontSize: 13, color: 'var(--cth-ink-700)', padding: '4px 9px', background: 'var(--cth-paper-100)' }}>
          <b>{t(`approvals.status.${a.status}`)}</b> · {a.title} · {nameFor(a.from)}{a.note ? ` — ${a.note}` : ''}
        </div>
      ))}
    </div>
  );
}
