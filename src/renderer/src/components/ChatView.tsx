import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Agent } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { useAppTheme } from '@/design/theme';
import { MessageQueueComposer } from './MessageQueueComposer';

/**
 * Messenger-style view of an agent's session: the Claude Code transcript as
 * chat bubbles (yours on the right, the agent's on the left), the agent's tool
 * work folded into small "did N things" rows, and the same composer the
 * terminal uses. The terminal tab stays for permission prompts and the raw TUI.
 */

type Role = 'user' | 'assistant' | 'tool' | 'system';
interface Entry { id: string; role: Role; text: string; at?: string; tool?: string; isError?: boolean }

const POLL_MS = 1500;
const MAX_ENTRIES = 1500;

const LIGHT = { bg: '#efeae2', mine: '#d9fdd3', theirs: '#ffffff', ink: '#111b21', sub: '#667781', pill: '#fff5c4', tool: 'rgba(255,255,255,0.75)', date: '#ffffff' };
const DARK = { bg: '#0b141a', mine: '#005c4b', theirs: '#202c33', ink: '#e9edef', sub: '#8696a0', pill: '#3b3a2a', tool: 'rgba(32,44,51,0.85)', date: '#182229' };

type Row =
  | { kind: 'msg'; entry: Entry }
  | { kind: 'tools'; id: string; items: Entry[] }
  | { kind: 'date'; id: string; label: string };

function dayKey(at?: string): string {
  return at ? new Date(at).toDateString() : '';
}

function buildRows(entries: Entry[], dayLabel: (at: string) => string): Row[] {
  const rows: Row[] = [];
  let lastDay = '';
  for (const e of entries) {
    const d = dayKey(e.at);
    if (d && d !== lastDay) {
      rows.push({ kind: 'date', id: `date-${d}`, label: dayLabel(e.at!) });
      lastDay = d;
    }
    const prev = rows[rows.length - 1];
    if (e.role === 'tool') {
      if (prev?.kind === 'tools') prev.items.push(e);
      else rows.push({ kind: 'tools', id: `tools-${e.id}`, items: [e] });
    } else {
      rows.push({ kind: 'msg', entry: e });
    }
  }
  return rows;
}

function time(at?: string): string {
  return at ? new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
}

export function ChatView({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const c = theme === 'dark' ? DARK : LIGHT;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [missing, setMissing] = useState(false);
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [openSystem, setOpenSystem] = useState<Record<string, boolean>>({});
  const [atBottom, setAtBottom] = useState(true);
  const cursor = useRef<{ path: string | null; offset: number | null }>({ path: null, offset: null });
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const poll = useCallback(async () => {
    let res;
    try { res = await window.cth.chatRead?.(agent.id, cursor.current.offset, cursor.current.path); } catch { return; }
    if (res === undefined) return; // older build without the handler
    if (!res) { setMissing(true); return; }
    setMissing(false);
    const fresh = cursor.current.path !== res.path;
    cursor.current = { path: res.path, offset: res.offset };
    if (fresh) setTruncated(res.truncated);
    if (!fresh && !res.entries.length && !res.results.length) return;
    setEntries((prev) => {
      const base = fresh ? [] : prev;
      const merged = [...base, ...res.entries];
      if (res.results.length) {
        const r = new Map(res.results.map((x) => [x.id, x.isError]));
        for (let i = 0; i < merged.length; i++) {
          const e = merged[i];
          if (e.role === 'tool' && r.has(e.id) && e.isError === undefined) merged[i] = { ...e, isError: r.get(e.id) };
        }
      }
      return merged.length > MAX_ENTRIES ? merged.slice(-MAX_ENTRIES) : merged;
    });
  }, [agent.id]);

  useEffect(() => {
    cursor.current = { path: null, offset: null };
    setEntries([]); setMissing(false); setTruncated(false);
    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  // Follow new messages only while the reader is at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = bottom;
    setAtBottom(bottom);
  };

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const dayLabel = (at: string) => {
    const d = new Date(at).toDateString();
    if (d === today) return t('chat.today');
    if (d === yesterday) return t('chat.yesterday');
    return new Date(at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const rows = buildRows(entries, dayLabel);
  const busy = agent.status === 'working' || agent.status === 'thinking';

  const bubble = (mine: boolean): CSSProperties => ({
    alignSelf: mine ? 'flex-end' : 'flex-start',
    maxWidth: '82%',
    background: mine ? c.mine : c.theirs,
    color: c.ink,
    borderRadius: mine ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
    padding: '6px 9px 4px',
    boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)',
    fontFamily: 'var(--cth-font-sans, system-ui, sans-serif)',
    fontSize: 14,
    lineHeight: '19px',
    wordBreak: 'break-word'
  });

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(agent.status === 'waiting' || agent.status === 'blocked') && (
        <div style={{ padding: '6px 10px', fontSize: 13, background: c.pill, color: c.ink }}>
          {t('chat.waitingBanner')}
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          ref={scroller}
          onScroll={onScroll}
          style={{ flex: 1, overflowY: 'auto', background: c.bg, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {truncated && (
            <div style={{ alignSelf: 'center', fontSize: 12, color: c.sub, padding: 4 }}>{t('chat.olderHidden')}</div>
          )}
          {missing && (
            <div style={{ alignSelf: 'center', textAlign: 'center', fontSize: 13, color: c.sub, padding: 24 }}>{t('chat.noTranscript')}</div>
          )}
          {!missing && !entries.length && (
            <div style={{ alignSelf: 'center', fontSize: 13, color: c.sub, padding: 24 }}>{t('chat.empty')}</div>
          )}
          {rows.map((row) => {
            if (row.kind === 'date') {
              return (
                <div key={row.id} style={{ alignSelf: 'center', margin: '6px 0', padding: '3px 10px', borderRadius: 8, background: c.date, color: c.sub, fontSize: 12, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                  {row.label}
                </div>
              );
            }
            if (row.kind === 'tools') {
              const open = openTools[row.id] ?? false;
              const errors = row.items.filter((i) => i.isError).length;
              return (
                <div key={row.id} style={{ alignSelf: 'flex-start', maxWidth: '82%' }}>
                  <button
                    type="button"
                    onClick={() => setOpenTools((o) => ({ ...o, [row.id]: !open }))}
                    style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '3px 9px', background: c.tool, color: c.sub, fontSize: 12, textAlign: 'left' }}
                  >
                    ⚙ {t('chat.toolCount', { count: row.items.length })}
                    {errors > 0 && <span style={{ color: '#d9534f' }}> · {t('chat.toolErrors', { count: errors })}</span>}
                    {' '}{open ? '▴' : '▾'}
                  </button>
                  {open && (
                    <div style={{ marginTop: 3, padding: '4px 9px', borderRadius: 8, background: c.tool, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {row.items.map((i) => (
                        <span key={i.id} style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: c.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {i.isError ? '✗' : i.isError === false ? '✓' : '·'} <b>{i.tool}</b>{i.text ? ` — ${i.text}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            const e = row.entry;
            if (e.role === 'system') {
              const nudge = e.text.startsWith('You have new hive inbox message');
              const open = openSystem[e.id] ?? false;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenSystem((o) => ({ ...o, [e.id]: !open }))}
                  style={{ alignSelf: 'center', maxWidth: '86%', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '3px 10px', background: c.pill, color: c.ink, fontSize: 12, textAlign: 'left', whiteSpace: open ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  🔔 {nudge ? t('chat.inboxNudge') : t('chat.systemNote')}{open ? `\n${e.text}` : ''} <span style={{ color: c.sub }}>{time(e.at)}</span>
                </button>
              );
            }
            const mine = e.role === 'user';
            return (
              <div key={e.id} style={bubble(mine)}>
                {mine
                  ? <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
                  : <MarkdownPreview source={e.text} variant="card" />}
                <div style={{ textAlign: 'right', fontSize: 11, color: c.sub, marginTop: 2 }}>
                  {time(e.at)}{mine ? ' ✓✓' : ''}
                </div>
              </div>
            );
          })}
          {busy && (
            <div style={{ ...bubble(false), color: c.sub, fontStyle: 'italic' }}>{t('chat.typing', { name: agent.name })}</div>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setAtBottom(true); } }}
            aria-label={t('chat.toBottom')}
            style={{ position: 'absolute', right: 14, bottom: 12, width: 34, height: 34, borderRadius: 17, border: 'none', cursor: 'pointer', background: c.theirs, color: c.sub, boxShadow: '0 1px 3px rgba(0,0,0,0.3)', fontSize: 16 }}
          >↓</button>
        )}
      </div>
      <MessageQueueComposer agent={agent} />
    </div>
  );
}
