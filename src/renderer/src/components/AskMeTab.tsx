import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { PixelBadge } from './PixelBadge';
import { useStore } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { type HiveTask, type HumanQA, openQuestion, waitsOnHuman, parseTasks } from './TasksKanban';
import { compareByNewestAsk } from './askMeOrder';
import { isComposingKey } from '@shared/imeGuard';
import { useRtl } from '@/i18n/useDirection';
import { ApprovalQueue } from './ApprovalQueue';

/**
 * ASK ME — first-class human feedback through the task system.
 *
 * Tasks the god can only move with the human's input sit here. An entry isn't
 * necessarily a question — it can be a TO-DO only the human can perform
 * (create an account, approve a purchase, provide credentials, test on a real
 * device). Each card shows the open ask, a place to respond (an answer, or a
 * "done, here's the result" confirmation), and the CASCADE of downstream
 * tasks stuck waiting on this one — so "why isn't X done?" reads as "ah,
 * because I still owe something here."
 *
 * Sending an answer does two things:
 *   1. writes it into the card's humanQA entry in hive/tasks.json (the
 *      decision is documented ON the task, forever), and
 *   2. mails the god so it picks the answer up, unblocks the card, and the
 *      work continues — no separate HumanQuestion.md side-channel anymore.
 */

const POLL_MS = 5000;

/** All tasks transitively waiting on `id` (dependents chain), cycle-safe. */
function dependentsTree(id: string, all: HiveTask[], seen = new Set<string>()): HiveTask[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const direct = all.filter((t) => Array.isArray(t.dependsOn) && t.dependsOn.includes(id) && t.status !== 'done');
  return direct.flatMap((d) => [d, ...dependentsTree(d.id, all, seen)]);
}

export function AskMeTab() {
  const { t: translate } = useTranslation();
  const rtl = useRtl();
  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  // Drafts live in the STORE (keyed by task id) — switching tabs unmounts this
  // view, and a half-typed answer must survive the round trip.
  const drafts = useStore((s) => s.answerDrafts);
  const setAnswerDraft = useStore((s) => s.setAnswerDraft);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const [sending, setSending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setTasks(parseTasks(await window.cth.hiveTasks())); } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const nameFor = (id?: string): string | undefined =>
    id ? (agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id) : undefined;

  // Newest ask at the top, oldest at the bottom. Before this the board had no
  // comparator at all, so a question's position was an accident of where its
  // card sat in tasks.json. `filter` already returns a fresh array, so sorting
  // in place never touches the store's own ordering. The ask each card is
  // ranked by comes from openQuestion() — the same predicate waitsOnHuman uses
  // — and only this OUTER list is sorted; a card's humanQA history stays
  // chronological (see askMeOrder.ts).
  const waiting = tasks
    .filter(waitsOnHuman)
    .sort((a, b) => compareByNewestAsk(openQuestion(a), openQuestion(b)));

  /**
   * Apply `patch` to the OPEN humanQA entry of one card, on the RAW ledger.
   * Returns whether it landed.
   *
   * Re-reads tasks.json first rather than writing this view's 5s-old snapshot,
   * because `hive:writeTasks` treats the incoming array as the card MEMBERSHIP:
   * writing our snapshot back would delete any card the god added since the last
   * poll. Re-locating the open question by its text also means an answer can
   * never land on a different question the god swapped in underneath us — in
   * that case nothing is written and the draft is kept.
   */

  const sendAnswer = async (task: HiveTask) => {
    const text = (drafts[task.id] ?? '').trim();
    const open = openQuestion(task);
    if (!text || !open || sending) return;
    setSending(task.id);
    try {
      // 1) Document the answer ON the card.
      const next = tasks.map((t) => {
        if (t.id !== task.id) return t;
        const qa = (t.humanQA ?? []).map((e) =>
          e === open || (e.q === open.q && !e.a)
            ? { ...e, a: text, answeredAt: new Date().toISOString() }
            : e
        );
        return { ...t, humanQA: qa };
      });
      const updated = next.find((candidate) => candidate.id === task.id);
      const result = updated
        ? await window.cth.hivePatchTask(task.id, { humanQA: updated.humanQA })
        : { ok: false };
      if (!result.ok) throw new Error('task changed before answer could be saved');
      setTasks(next);
      // 2) Tell the god, so the card gets unblocked and work continues.
      await window.cth.hiveSend({
        to: 'god',
        act: 'inform',
        subject: `KULLANICI YANITI — görev "${task.title}"`,
        body: [
          `Kullanıcı ${task.id} görevindeki ("${task.title}") açık soruyu yanıtladı:`,
          `Soru: ${open.q}`,
          `Yanıt: ${text}`,
          'Yanıt kartın humanQA alanına da kaydedildi. Buna göre hareket et, kartın engelini kaldır ve işe devam et.'
        ].join('\n')
      }, 'human');
      setAnswerDraft(task.id, '');
    } catch { /* leave the draft so the user can retry */ }
    setSending(null);
  };

  // Dismiss the open ask off the ASK ME board WITHOUT answering it. We mark the
  // open humanQA entry `dismissedAt` (no fabricated answer) so openQuestion()
  // stops returning it and the card leaves this view — the question itself stays
  // on the card, so the Q&A history is never dropped (protocol). The task stays
  // blocked on the kanban; the god can re-ask by appending a fresh humanQA entry.
  const dismiss = async (task: HiveTask) => {
    const open = openQuestion(task);
    if (!open || sending === task.id) return;
    const next = tasks.map((t) => {
      if (t.id !== task.id) return t;
      const qa = (t.humanQA ?? []).map((e) =>
        e === open || (e.q === open.q && !e.a && !e.dismissedAt)
          ? { ...e, dismissedAt: new Date().toISOString() }
          : e
      );
      return { ...t, humanQA: qa };
    });
    setTasks(next); // optimistic — the card disappears immediately
    try {
      const updated = next.find((candidate) => candidate.id === task.id);
      const result = updated
        ? await window.cth.hivePatchTask(task.id, { humanQA: updated.humanQA })
        : { ok: false };
      if (!result.ok) throw new Error('task changed before ask could be dismissed');
    } catch {
      setTasks(tasks); // restore on failure so the user can retry
    }
  };

  return (
    // Body text is set in the mono face (VT323) — the same readable font the
    // memory viewer uses. Pixelify Sans (font-ui) is too chunky for prose like
    // questions and answers. Display/badge bits keep their explicit faces.
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--cth-paper-200)', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20, fontFamily: 'var(--cth-font-mono)' }}>
      <ApprovalQueue />
      {waiting.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--cth-ink-500)', fontSize: 14 }}>
          {translate('askMe.emptyTitle')}<br />
          <span style={{ fontSize: 12, color: 'var(--cth-ink-300)', marginTop: 4, display: 'block' }}>
            {translate('askMe.emptySub')}
          </span>
        </div>
      )}
      {waiting.map((t) => {
        const open = openQuestion(t)!;
        const stuck = dependentsTree(t.id, tasks);
        return (
          <div key={t.id} style={{
            background: 'var(--cth-paper-100)',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 0 0 1px var(--cth-ink-100)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            border: '1px solid var(--cth-ink-100)'
          }}>
            {/* header: title + assignee */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'linear-gradient(90deg, var(--cth-lilac-light, #ece2f5), transparent)',
              borderBottom: '1px solid var(--cth-ink-100)',
              fontFamily: 'var(--cth-font-ui)'
            }}>
              <button
                onClick={() => openTaskDetail(t.id)}
                title={translate('askMe.openDetail')}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left',
                  fontSize: 14, fontWeight: '600', color: 'var(--cth-ink-900)',
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {t.title}
              </button>
              {nameFor(t.assignee) && <PixelBadge status="blocked" label={nameFor(t.assignee)!} />}
              <button
                onClick={() => void dismiss(t)}
                disabled={sending === t.id}
                title={translate('askMe.dismissTitle')}
                aria-label={translate('askMe.dismissAria')}
                style={{
                  flexShrink: 0, width: 20, height: 20, padding: 0, marginLeft: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  border: 'none', cursor: sending === t.id ? 'default' : 'pointer',
                  background: 'transparent', color: 'var(--cth-ink-500)',
                  fontSize: 14, borderRadius: '4px'
                }}
                onMouseEnter={(e) => { if (sending !== t.id) e.currentTarget.style.color = 'var(--cth-coral)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cth-ink-500)'; }}
              >✕</button>
            </div>

            <div style={{ padding: '12px 12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* The question, rendered as markdown. The god writes these with
                  emphasis, lists, `code` and links; as plain text the asterisks
                  and backticks were on screen literally. The card variant keeps
                  this card's mono face and turns a single newline into a break, so
                  a question with no markdown in it looks exactly as it did. */}
              <div dir={rtl ? 'auto' : undefined} style={{ fontSize: 15, lineHeight: '19px', color: 'var(--cth-ink-900)' }}>
                <MarkdownPreview source={open.q} variant="card" />
              </div>

              {/* answer box */}
              <textarea
                dir={rtl ? 'auto' : undefined}
                value={drafts[t.id] ?? ''}
                onChange={(e) => setAnswerDraft(t.id, e.target.value)}
                onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAnswer(t); }}
                rows={3}
                placeholder={translate('askMe.answerPlaceholder')}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', resize: 'vertical',
                  background: 'var(--cth-paper-200)', border: '1px solid var(--cth-ink-200)',
                  borderRadius: '8px',
                  fontFamily: 'var(--cth-font-mono)', fontSize: 14, lineHeight: '18px',
                  color: 'var(--cth-ink-900)', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PixelButton
                  variant="primary" size="sm"
                  disabled={!(drafts[t.id] ?? '').trim() || sending === t.id}
                  onClick={() => void sendAnswer(t)}
                >
                  {sending === t.id ? translate('askMe.sending') : translate('askMe.respond')}
                </PixelButton>
                {(t.humanQA?.filter((e) => e.a).length ?? 0) > 0 && (
                  <button
                    onClick={() => openTaskDetail(t.id)}
                    title={translate('askMe.viewAnswersHistory')}
                    style={{
                      border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                      fontSize: 10, color: 'var(--cth-ink-700)', fontFamily: 'var(--cth-font-display)',
                      textDecoration: 'underline'
                    }}
                  >
                    {(() => {
                      const n = t.humanQA!.filter((e) => e.a).length;
                      return n === 1
                        ? translate('askMe.viewAnswers', { count: n })
                        : translate('askMe.viewAnswersPlural', { count: n });
                    })()}
                  </button>
                )}
              </div>

              {/* the cascade: what's stuck behind this answer */}
              {stuck.length > 0 && (
                <div style={{
                  marginTop: 4, padding: '8px', background: 'rgba(255,255,255,0.5)',
                  borderRadius: '6px', border: '1px dashed var(--cth-ink-200)',
                  display: 'flex', flexDirection: 'column', gap: 4
                }}>
                  <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-coral)', fontWeight: 'bold', marginBottom: 2 }}>
                    {stuck.length === 1
                      ? translate('askMe.blockingDownstream', { count: stuck.length })
                      : translate('askMe.blockingDownstreamPlural', { count: stuck.length })}
                  </div>
                  {stuck.slice(0, 6).map((d, i) => (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      paddingLeft: i * 4,
                      fontSize: 12, color: 'var(--cth-ink-700)', opacity: 1 - (i * 0.1)
                    }}>
                      <span style={{ color: 'var(--cth-ink-300)', fontSize: 10 }}>└</span>
                      <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: d.status === 'blocked' ? 'var(--cth-coral)' : 'var(--cth-sky)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.title}</span>
                      {nameFor(d.assignee) && <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', opacity: 0.7 }}>{nameFor(d.assignee)}</span>}
                    </div>
                  ))}
                  {stuck.length > 6 && (
                    <div style={{ paddingLeft: 10, fontSize: 11, color: 'var(--cth-ink-300)', textAlign: 'right' }}>+{stuck.length - 6} more</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
