import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { useDesign, type InboxButtonPlace } from '@/design/customizer';

/**
 * The human's inbox: one place for everything addressed to the human.
 */

interface Item {
  id: string; kind: 'onay' | 'soru' | 'mesaj' | 'giden'; from: string; to?: string;
  title: string; body: string; at: string; read: boolean; conversation?: string;
  approvalId?: string; taskId?: string;
}

const POLL_MS = 10000;

function parse(raw: unknown): Item[] {
  return Array.isArray(raw) ? raw.filter((i): i is Item => !!i && typeof i === 'object' && typeof (i as Item).id === 'string') : [];
}

export function HumanInboxButton({ place = 'start' }: { place?: InboxButtonPlace } = {}) {
  const { t } = useTranslation();
  const layout = useDesign().layout;
  // Başlık çubuğunda iki yuva var (başta/sonda). Yalnızca "sahip" örnek yoklar
  // ve açılma bildirimini dinler; düğme gizliyken sahip 'start' yuvasıdır.
  const owner = layout.inboxButton === place || (layout.inboxButton === 'hidden' && place === 'start');
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setItems(parse(await window.cth.humanInboxList?.())); } catch { /* main not ready / older build */ }
  }, []);

  useEffect(() => {
    if (!owner) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    const offNew = window.cth.onHumanInbox?.(() => { void refresh(); });
    const offOpen = window.cth.onHumanInboxOpen?.((id) => { setFocusId(id); setOpen(true); void refresh(); });
    return () => { clearInterval(timer); offNew?.(); offOpen?.(); };
  }, [refresh, owner]);

  const unread = items.filter((i) => !i.read && i.kind !== 'giden').length;

  // Tasarım Paneli: başlık çubuğunda yalnızca seçilen yerdeki örnek düğmeyi
  // gösterir; 'hidden' iken düğme yok ama çekmece bildirimle yine açılabilir.
  const showButton = layout.inboxButton === place;
  if (!owner || (!showButton && !open)) return null;

  return (
    <>
      {showButton && (
      <button
        className="cth-titlebar-nodrag cth-tip"
        data-tip={t('humanInbox.tip')}
        aria-label={t('humanInbox.title')}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'relative', border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 16, padding: '2px 6px', color: 'var(--cth-ink-900)'
        }}
      >
        📬
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -4, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: 'var(--cth-coral)', color: '#fff', fontSize: 11, lineHeight: '16px',
            fontFamily: 'var(--cth-font-ui)', textAlign: 'center'
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      )}
      {open && createPortal(
        <InboxDrawer items={items} focusId={focusId} onClose={() => { setOpen(false); setFocusId(null); }} onChanged={refresh} />,
        document.body
      )}
    </>
  );
}

function InboxDrawer({ items, focusId, onClose, onChanged }: {
  items: Item[]; focusId: string | null; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  const requestTab = useStore((s) => s.requestCommandCenterTab);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const select = useStore((s) => s.select);
  const [category, setCategory] = useState<'all' | 'unread' | 'pending'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameFor = (id: string): string =>
    id === 'human' ? t('humanInbox.you') : (agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const markRead = async (ids: string[] | 'all') => {
    try { await window.cth.humanInboxMarkRead(ids); await onChanged(); } catch { /* ignore */ }
  };

  const renderBodyWithLinks = (text: string) => {
    const parts = text.split(/(\b[a-z0-9_-]+-[a-z0-9_-]+\b)/gi);
    return parts.map((part, i) => {
      if (/^([a-z0-9_-]+-[a-z0-9_-]+)$/i.test(part)) {
        return (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); openTaskDetail(part); onClose(); }}
            style={{
              background: 'var(--cth-lilac-light)', color: 'var(--cth-ink-900)',
              border: 'none', borderRadius: 4, padding: '0 4px', fontSize: 12,
              cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--cth-font-mono)',
              boxShadow: 'inset 0 0 0 1px var(--cth-lilac)', margin: '0 2px'
            }}
          >
            #{part}
          </button>
        );
      }
      return part;
    });
  };

  const goAskMe = async () => {
    const lead = agents.find((a) => a.isGod);
    if (lead) select(lead.id);
    requestTab('human');
    onClose();
  };

  const answerApproval = async (item: Item, status: 'onaylandi' | 'revize' | 'reddedildi') => {
    if (!item.approvalId) return;
    const note = (drafts[item.id] ?? '').trim();
    if (status === 'revize' && !note) { setError(t('approvals.needNote')); return; }
    setBusy(item.id); setError(null);
    try {
      const res = await window.cth.hiveAnswerApproval(item.approvalId, status, note);
      if (!res.ok) setError(res.error === 'already answered' ? t('humanInbox.alreadyAnswered') : (res.error ?? t('approvals.failed')));
      else setDrafts((d) => { const { [item.id]: _drop, ...rest } = d; return rest; });
      await markRead([item.id]);
    } catch { setError(t('approvals.restartNeeded')); } finally { setBusy(null); }
  };

  const reply = async (item: Item) => {
    const text = (drafts[item.id] ?? '').trim();
    if (!text) return;
    setBusy(item.id); setError(null);
    try {
      const res = await window.cth.humanInboxReply(item.id, text);
      if (!res.ok) setError(res.error === 'already answered' ? t('humanInbox.alreadyAnswered') : (res.error ?? t('humanInbox.replyFailed')));
      else setDrafts((d) => { const { [item.id]: _drop, ...rest } = d; return rest; });
      await onChanged();
    } catch { setError(t('approvals.restartNeeded')); } finally { setBusy(null); }
  };

  const filteredList = items
    .filter((i) => {
      if (category === 'unread') return !i.read && i.kind !== 'giden';
      if (category === 'pending') return !i.read && (i.kind === 'onay' || i.kind === 'soru' || i.kind === 'mesaj');
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  const selectedItem = items.find(i => i.id === selectedId);
  const { inboxSide: side, inboxWidth: width } = useDesign().layout;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, bottom: 0, [side]: 0, width: `min(${width}px, 100vw)`,
          background: 'var(--cth-paper-100)',
          boxShadow: side === 'right'
            ? '-8px 0 25px rgba(0,0,0,0.15), inset 3px 0 0 var(--cth-ink-700)'
            : '8px 0 25px rgba(0,0,0,0.15), inset -3px 0 0 var(--cth-ink-700)',
          display: 'flex', flexDirection: 'column', fontFamily: 'var(--cth-font-ui)', animation: 'slideIn 0.3s cubic-bezier(0.25, 1, 0.5, 1)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--cth-ink-100)', background: 'var(--cth-paper-200)' }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: 'var(--cth-ink-900)' }}>{t('humanInbox.title')}</span>
          <div style={{ display: 'flex', gap: 4, background: 'var(--cth-paper-100)', padding: 3, borderRadius: 6, border: '1px solid var(--cth-ink-100)' }}>
            {(['all', 'unread', 'pending'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: category === cat ? 'var(--cth-ink-900)' : 'transparent',
                  color: category === cat ? 'var(--cth-cream-50)' : 'var(--cth-ink-500)',
                  transition: 'all 0.2s'
                }}
              >
                {cat === 'all' ? t('common.all') : cat === 'unread' ? t('humanInbox.onlyUnread') : t('common.pending')}
              </button>
            ))}
          </div>
          <button
            onClick={() => void markRead('all')}
            style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--cth-ink-300)', background: 'var(--cth-paper-100)', cursor: 'pointer', color: 'var(--cth-ink-700)' }}
          >
            {t('humanInbox.markAll')}
          </button>
          <button onClick={onClose} aria-label={t('humanInbox.close')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: '320px', borderRight: '1px solid var(--cth-ink-100)', overflowY: 'auto', background: 'var(--cth-paper-200)' }}>
            {filteredList.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, fontSize: 13, color: 'var(--cth-ink-500)' }}>{t('humanInbox.empty')}</div>
            )}
            {filteredList.map((i) => {
              const unread = !i.read && i.kind !== 'giden';
              return (
                <div
                  key={i.id}
                  onClick={() => { setSelectedId(i.id); if (unread && i.kind === 'mesaj') void markRead([i.id]); }}
                  style={{
                    padding: '12px', cursor: 'pointer', transition: 'all 0.2s',
                    background: selectedId === i.id ? 'var(--cth-paper-100)' : 'transparent',
                    borderLeft: `4px solid ${unread ? 'var(--cth-coral)' : 'transparent'}`,
                    borderBottom: '1px solid var(--cth-ink-100)',
                    display: 'flex', flexDirection: 'column', gap: 4
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--cth-ink-500)' }}>
                    <b style={{ color: unread ? 'var(--cth-coral)' : 'inherit' }}>{nameFor(i.from)}</b>
                    <span>{new Date(i.at).toLocaleDateString('tr-TR')}</span>
                  </div>
                  <div style={{ fontSize: 14, color: unread ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)', fontWeight: unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {i.title}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-100)' }}>
            {selectedItem ? (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                     <div style={{ flex: 1 }}>
                       <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t(`humanInbox.kind.${selectedItem.kind}`)}</span>
                       <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--cth-ink-900)', margin: '4px 0' }}>{selectedItem.title}</h2>
                       <div style={{ fontSize: 13, color: 'var(--cth-ink-500)' }}>{t('from')}: {nameFor(selectedItem.from)} • {new Date(selectedItem.at).toLocaleString('tr-TR')}</div>
                     </div>
                     {selectedItem.kind === 'onay' && (
                       <div style={{ padding: '4px 8px', background: 'var(--cth-lemon-light)', color: 'var(--cth-ink-900)', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>PENDING APPROVAL</div>
                     )}
                   </div>

                   <div style={{ fontSize: 15, lineHeight: '1.6', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', padding: '16px', background: 'var(--cth-paper-200)', borderRadius: 8, border: '1px solid var(--cth-ink-100)' }}>
                     {renderBodyWithLinks(selectedItem.body)}
                   </div>

                   <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                     {error && <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--cth-coral)', background: 'var(--cth-coral-light)', borderRadius: 6 }}>{error}</div>}

                     {selectedItem.kind === 'onay' && (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                         <textarea
                           value={drafts[selectedItem.id] ?? ''}
                           onChange={(e) => setDrafts((d) => ({ ...d, [selectedItem.id]: e.target.value }))}
                           rows={3}
                           placeholder={t('approvals.notePlaceholder')}
                           style={{ resize: 'vertical', padding: 12, fontFamily: 'var(--cth-font-ui)', fontSize: 14, background: 'var(--cth-paper-200)', border: '1px solid var(--cth-ink-100)', borderRadius: 6, color: 'var(--cth-ink-900)' }}
                         />
                         <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                           <PixelButton variant="ghost" size="sm" onClick={() => void goAskMe()}>{t('humanInbox.openApproval')}</PixelButton>
                           <PixelButton variant="secondary" size="sm" disabled={busy === selectedItem.id} onClick={() => void answerApproval(selectedItem, 'reddedildi')}>{t('approvals.reject')}</PixelButton>
                           <PixelButton variant="secondary" size="sm" disabled={busy === selectedItem.id} onClick={() => void answerApproval(selectedItem, 'revize')}>{t('approvals.revise')}</PixelButton>
                           <PixelButton variant="primary" size="sm" disabled={busy === selectedItem.id} onClick={() => void answerApproval(selectedItem, 'onaylandi')}>{t('approvals.approve')}</PixelButton>
                         </div>
                       </div>
                     )}

                     {(selectedItem.kind === 'mesaj' || selectedItem.kind === 'soru') && (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                         <textarea
                           value={drafts[selectedItem.id] ?? ''}
                           onChange={(e) => setDrafts((d) => ({ ...d, [selectedItem.id]: e.target.value }))}
                           onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void reply(selectedItem); }}
                           rows={4}
                           placeholder={t('humanInbox.replyPlaceholder', { name: nameFor(selectedItem.from) })}
                           style={{ resize: 'vertical', padding: 12, fontFamily: 'var(--cth-font-ui)', fontSize: 14, background: 'var(--cth-paper-200)', border: '1px solid var(--cth-ink-100)', borderRadius: 6, color: 'var(--cth-ink-900)' }}
                         />
                         <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                           {selectedItem.kind === 'soru' && (
                             <PixelButton variant="ghost" size="sm" onClick={() => void goAskMe()}>{t('humanInbox.openQuestion')}</PixelButton>
                           )}
                           <PixelButton variant="primary" size="sm" disabled={busy === selectedItem.id || !(drafts[selectedItem.id] ?? '').trim()} onClick={() => void reply(selectedItem)}>
                             {t('humanInbox.send')}
                           </PixelButton>
                         </div>
                       </div>
                     )}
                   </div>
                </div>

                <div style={{ padding: '12px 24px', borderTop: '1px solid var(--cth-ink-100)', background: 'var(--cth-paper-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--cth-ink-500)' }}>
                   <div>Conv ID: {selectedItem.conversation ?? 'N/A'}</div>
                   <div style={{ display: 'flex', gap: 12 }}>
                     {selectedItem.taskId && (
                       <button onClick={() => { openTaskDetail(selectedItem.taskId!); onClose(); }} style={{ background: 'none', border: 'none', color: 'var(--cth-sky)', cursor: 'pointer', fontWeight: 'bold' }}>
                         Go to Task #{selectedItem.taskId} →
                       </button>
                     )}
                     {selectedItem.from !== 'human' && (
                       <button onClick={() => { select(selectedItem.from); onClose(); }} style={{ background: 'none', border: 'none', color: 'var(--cth-sky)', cursor: 'pointer', fontWeight: 'bold' }}>
                         View Agent Profile →
                       </button>
                     )}
                   </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cth-ink-500)', fontSize: 15 }}>
                {t('humanInbox.selectItemToView')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
