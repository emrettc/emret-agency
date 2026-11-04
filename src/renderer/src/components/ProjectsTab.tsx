import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/**
 * PROJELER — tek ofis, ortak ekip, etiketli projeler (src/shared/officeProjects.ts).
 *
 * Emre 2026-10-29: projeler ayrı ofis olarak açılmaz. Aynı ajanlar birden çok
 * projede çalışır; ayrımı görevin `proje` etiketi ve projenin klasörü sağlar.
 * Bu sekme o ayrımı gösterir:
 *  - [Tümü]: proje özet tablosu + tüm ajanlar (hangi projede, ne yapıyor, token).
 *  - [proje]: o projede çalışan ajanlar, boştaki ajanlar, sorular, açık görevler,
 *    projeye dağıtılan (tahmini) token ve maliyet, klasörler.
 *  - [Etiketsiz]: projesi belirsiz görevler ve proje dışı harcama.
 *  - [Düzenle]: proje listesi (ad, renk, klasörler, takma adlar).
 */

interface OfficeProject {
  id: string; name: string; color: string; dir?: string; docs?: string; aliases?: string[]; archived?: boolean;
}
interface TeamAgent {
  id: string; name: string; isGod: boolean; status: string; action?: string; provider?: string; model?: string;
  tokens: number; usd: number; lastTool?: string; lastActiveSecAgo?: number; inboxBacklog: number; onHold: boolean;
  projects: string[];
}
interface OfficeTask { id: string; title: string; status: string; assignee?: string; proje: string | null; question?: string }
interface Overview {
  projects: OfficeProject[];
  spend: Record<string, { tokens: number; usd: number }>;
  spendSince?: string;
  team: TeamAgent[];
  tasks: OfficeTask[];
}

const POLL_MS = 5000;
const TAB_KEY = 'cth.officeProjectsTab';
const ALL = '__tumu';
const UNTAGGED = '__etiketsiz';
const EDIT = '__duzenle';
const GENERAL = 'genel';
const COLORS = ['sky', 'lemon', 'coral', 'mint', 'lilac', 'peach', 'rose', 'teal'];
const EMPTY: Overview = { projects: [], spend: {}, team: [], tasks: [] };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

export function ProjectsTab() {
  const { t } = useTranslation();
  const [o, setO] = useState<Overview>(EMPTY);
  const [sel, setSel] = useState<string>(() => {
    try { return window.localStorage.getItem(TAB_KEY) || ALL; } catch { return ALL; }
  });
  const [draft, setDraft] = useState<OfficeProject[] | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const select = (id: string) => {
    setSel(id);
    setNote(null);
    if (id === EDIT) setDraft(o.projects.map((p) => ({ ...p })));
    try { window.localStorage.setItem(TAB_KEY, id); } catch { /* noop */ }
  };

  const refresh = useCallback(async () => {
    try {
      const res = await window.cth.officeOverview?.();
      if (res) setO(res as Overview);
    } catch { /* older main: empty */ }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const live = o.projects.filter((p) => !p.archived);
  const byId = new Map(o.projects.map((p) => [p.id, p]));
  const view = sel === EDIT || sel === UNTAGGED || sel === ALL || byId.has(sel) ? sel : ALL;
  const open = (task: OfficeTask) => task.status !== 'done';

  // ── küçük yapı taşları ────────────────────────────────────────────────────
  const card: CSSProperties = { background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', display: 'flex', flexDirection: 'column' };
  const head: CSSProperties = { fontFamily: 'var(--cth-font-ui)', fontSize: 13, color: 'var(--cth-ink-900)', padding: '6px 9px', boxShadow: 'inset 0 -1px 0 var(--cth-ink-300)' };
  const cell: CSSProperties = { padding: '4px 6px', fontSize: 12, color: 'var(--cth-ink-900)', verticalAlign: 'top' };
  const th: CSSProperties = { ...cell, color: 'var(--cth-ink-500)', fontWeight: 'normal', textAlign: 'left', boxShadow: 'inset 0 -1px 0 var(--cth-ink-100)' };
  const num: CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };
  const muted: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)' };
  const input: CSSProperties = {
    padding: '4px 6px 2px', background: 'var(--cth-paper-100)', border: 'none',
    boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)', fontSize: 12,
    color: 'var(--cth-ink-900)', outline: 'none', minWidth: 0
  };

  const chip = (p: OfficeProject | undefined, label?: string) => (
    <span style={{
      fontSize: 11, lineHeight: '15px', padding: '0 5px', whiteSpace: 'nowrap',
      background: p ? `var(--cth-${p.color})` : 'var(--cth-paper-200)', color: 'var(--cth-ink-900)',
      boxShadow: p ? 'none' : 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>{label ?? p?.name ?? t('officeProjects.untagged')}</span>
  );
  const ago = (sec?: number): string => {
    if (sec === undefined) return '—';
    if (sec < 60) return t('projects.ago', { value: `${Math.round(sec)} ${t('projects.sec')}` });
    if (sec < 3600) return t('projects.ago', { value: `${Math.round(sec / 60)} ${t('projects.min')}` });
    return t('projects.ago', { value: `${Math.round(sec / 3600)} ${t('projects.hour')}` });
  };
  const agentState = (a: TeamAgent): { label: string; color: string } => {
    if (a.status === 'off') return { label: t('projects.agentOff'), color: 'var(--cth-ink-500)' };
    if (a.onHold) return { label: t('projects.onHold'), color: 'var(--cth-coral)' };
    const label = t(`status.${a.status}`, { defaultValue: a.status });
    const color = a.status === 'working' || a.status === 'thinking' ? '#25a244'
      : a.status === 'blocked' || a.status === 'looping' ? 'var(--cth-coral)'
      : a.status === 'waiting' ? 'var(--cth-lemon)' : 'var(--cth-ink-700)';
    return { label, color };
  };
  const tabBtn = (id: string, label: ReactNode) => (
    <button
      key={id}
      onClick={() => select(id)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer', border: 'none',
        fontFamily: 'var(--cth-font-mono)', fontSize: 13, color: 'var(--cth-ink-900)',
        background: view === id ? 'var(--cth-paper-100)' : 'transparent',
        boxShadow: view === id ? 'inset 0 0 0 1px var(--cth-ink-300), inset 0 -2px 0 var(--cth-ink-900)' : 'none'
      }}
    >{label}</button>
  );

  const teamTable = (team: TeamAgent[], showProjects: boolean) => team.length === 0 ? (
    <div style={{ padding: 9, ...muted }}>{t('officeProjects.noAgentsHere')}</div>
  ) : (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--cth-font-mono)' }}>
        <thead>
          <tr>
            <th style={th}>{t('projects.colAgent')}</th>
            <th style={th}>{t('projects.colStatus')}</th>
            {showProjects && <th style={th}>{t('officeProjects.colProject')}</th>}
            <th style={th}>{t('projects.colDoing')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{t('projects.colInbox')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{t('projects.colTokens')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{t('projects.colCost')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{t('projects.colLast')}</th>
          </tr>
        </thead>
        <tbody>
          {team.map((a) => {
            const st = agentState(a);
            return (
              <tr key={a.id} style={{ boxShadow: 'inset 0 -1px 0 var(--cth-ink-100)' }}>
                <td style={cell}>
                  <div>{a.name}{a.isGod ? ` · ${t('projects.lead')}` : ''}</div>
                  {(a.provider || a.model) && <div style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>{[a.provider, a.model].filter(Boolean).join(' · ')}</div>}
                </td>
                <td style={{ ...cell, color: st.color, whiteSpace: 'nowrap' }}>● {st.label}</td>
                {showProjects && (
                  <td style={cell}>
                    <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>
                      {a.projects.length ? a.projects.map((pid) => <span key={pid}>{chip(byId.get(pid), byId.get(pid)?.name ?? pid)}</span>) : <span style={muted}>—</span>}
                    </span>
                  </td>
                )}
                <td style={{ ...cell, color: 'var(--cth-ink-700)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.action}>
                  {a.action || a.lastTool || '—'}
                </td>
                <td style={{ ...num, color: a.inboxBacklog > 0 ? 'var(--cth-coral)' : 'var(--cth-ink-500)' }}>
                  {a.inboxBacklog > 0 ? t('projects.inboxWaiting', { count: a.inboxBacklog }) : '—'}
                </td>
                <td style={num}>{fmtTokens(a.tokens)}</td>
                <td style={num}>{a.usd > 0 ? `$${a.usd.toFixed(2)}` : '—'}</td>
                <td style={{ ...num, color: 'var(--cth-ink-500)' }}>{ago(a.lastActiveSecAgo)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const taskList = (tasks: OfficeTask[]) => tasks.length === 0 ? (
    <span style={muted}>{t('projects.noTasks')}</span>
  ) : tasks.map((task) => (
    <div key={task.id} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
      <span style={{ width: 62, flexShrink: 0, color: task.status === 'blocked' ? 'var(--cth-coral)' : task.status === 'doing' ? '#25a244' : 'var(--cth-ink-500)' }}>{task.status}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--cth-ink-900)' }}>{task.title}</span>
      <span style={{ flexShrink: 0, color: 'var(--cth-ink-500)' }}>{o.team.find((a) => a.id === task.assignee)?.name ?? task.assignee ?? '—'}</span>
    </div>
  ));

  const questionList = (tasks: OfficeTask[]) => {
    const qs = tasks.filter((x) => x.question && open(x));
    return qs.length === 0 ? <span style={muted}>{t('projects.noQuestions')}</span> : qs.map((q) => (
      <div key={q.id} style={{ fontSize: 12 }}>
        <div style={{ color: 'var(--cth-coral)' }}>{q.title}</div>
        <div style={{ color: 'var(--cth-ink-700)', whiteSpace: 'pre-wrap' }}>{q.question!.length > 400 ? `${q.question!.slice(0, 400)}…` : q.question}</div>
      </div>
    ));
  };

  const spendLine = (key: string) => {
    const s = o.spend[key];
    return (
      <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }} title={t('officeProjects.spendTitle')}>
        Σ <b>{fmtTokens(s?.tokens ?? 0)}</b> {t('projects.tokens')}{(s?.usd ?? 0) > 0 ? ` · $${s!.usd.toFixed(2)}` : ''}
        <span style={muted}> {t('officeProjects.estimated')}</span>
      </span>
    );
  };

  // ── görünümler ────────────────────────────────────────────────────────────
  const projectView = (p: OfficeProject) => {
    const tasks = o.tasks.filter((x) => x.proje === p.id);
    const openTasks = tasks.filter(open);
    const here = o.team.filter((a) => a.projects.includes(p.id));
    const idle = o.team.filter((a) => a.projects.length === 0 && a.status !== 'off');
    return (
      <>
        <div style={card}>
          <div style={{ ...head, display: 'flex', alignItems: 'center', gap: 8 }}>
            {chip(p)}
            <span style={{ flex: 1 }} />
            {p.dir && <PixelButton variant="ghost" size="sm" onClick={() => void window.cth.officeReveal?.(p.dir!)}>{t('officeProjects.openDir')}</PixelButton>}
            {p.docs && p.docs !== p.dir && <PixelButton variant="ghost" size="sm" onClick={() => void window.cth.officeReveal?.(p.docs!)}>{t('officeProjects.openDocs')}</PixelButton>}
          </div>
          <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(p.dir || p.docs) && (
              <span style={muted}>{[p.dir && `${t('officeProjects.dir')}: ${p.dir}`, p.docs && `${t('officeProjects.docs')}: ${p.docs}`].filter(Boolean).join(' · ')}</span>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              {spendLine(p.id)}
              <span style={{ fontSize: 13, color: 'var(--cth-ink-700)' }}>{t('officeProjects.agentsNow')}: <b>{here.length}</b></span>
              <span style={{ fontSize: 13, color: 'var(--cth-ink-700)' }}>{t('projects.openTasks')}: <b>{openTasks.length}</b></span>
              <span style={{ fontSize: 13, color: 'var(--cth-ink-700)' }}>{t('officeProjects.done')}: <b>{tasks.length - openTasks.length}</b></span>
            </div>
          </div>
        </div>
        <div style={card}>
          <div style={head}>{t('officeProjects.workingHere', { count: here.length })}</div>
          {teamTable(here, false)}
        </div>
        <div style={card}>
          <div style={head}>{t('officeProjects.idleAgents', { count: idle.length })}</div>
          <div style={{ padding: 9, ...muted }}>
            {idle.length ? idle.map((a) => a.name).join(' · ') : t('officeProjects.noIdle')}
          </div>
        </div>
        <div style={card}>
          <div style={head}>{t('projects.questionsTitle', { count: tasks.filter((x) => x.question && open(x)).length })}</div>
          <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>{questionList(tasks)}</div>
        </div>
        <div style={card}>
          <div style={head}>{t('projects.tasksTitle', { count: openTasks.length })}</div>
          <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>{taskList(openTasks)}</div>
        </div>
      </>
    );
  };

  const allView = () => {
    const rows = [...live.map((p) => ({ key: p.id, p })), { key: UNTAGGED, p: undefined as OfficeProject | undefined }];
    const tasksOf = (key: string) => o.tasks.filter((x) => (key === UNTAGGED ? !x.proje : x.proje === key));
    const spendOf = (key: string) => o.spend[key === UNTAGGED ? GENERAL : key];
    const total = Object.values(o.spend).reduce((s, v) => ({ tokens: s.tokens + v.tokens, usd: s.usd + v.usd }), { tokens: 0, usd: 0 });
    return (
      <>
        <div style={card}>
          <div style={head}>{t('officeProjects.summaryTitle')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--cth-font-mono)' }}>
              <thead>
                <tr>
                  <th style={th}>{t('officeProjects.colProject')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('officeProjects.agentsNow')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('projects.openTasks')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('projects.questions')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('projects.colTokens')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('projects.colCost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, p }) => {
                  const tasks = tasksOf(key);
                  const s = spendOf(key);
                  const agentsNow = key === UNTAGGED ? 0 : o.team.filter((a) => a.projects.includes(key)).length;
                  return (
                    <tr key={key} style={{ boxShadow: 'inset 0 -1px 0 var(--cth-ink-100)', cursor: 'pointer' }} onClick={() => select(key)}>
                      <td style={cell}>{chip(p)}</td>
                      <td style={num}>{key === UNTAGGED ? '—' : agentsNow}</td>
                      <td style={num}>{tasks.filter(open).length}</td>
                      <td style={{ ...num, color: tasks.some((x) => x.question && open(x)) ? 'var(--cth-coral)' : undefined }}>{tasks.filter((x) => x.question && open(x)).length}</td>
                      <td style={num}>{fmtTokens(s?.tokens ?? 0)}</td>
                      <td style={num}>{(s?.usd ?? 0) > 0 ? `$${s!.usd.toFixed(2)}` : '—'}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...cell, color: 'var(--cth-ink-500)' }}>Σ</td>
                  <td style={num} /><td style={num} /><td style={num} />
                  <td style={num}><b>{fmtTokens(total.tokens)}</b></td>
                  <td style={num}><b>{total.usd > 0 ? `$${total.usd.toFixed(2)}` : '—'}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ padding: '4px 9px 8px', ...muted }}>
            {t('officeProjects.spendNote', { since: o.spendSince ? new Date(o.spendSince).toLocaleString() : '—' })}
          </div>
        </div>
        <div style={card}>
          <div style={head}>{t('officeProjects.teamTitle', { count: o.team.length })}</div>
          {teamTable([...o.team].sort((a, b) => Number(b.isGod) - Number(a.isGod) || b.tokens - a.tokens), true)}
        </div>
      </>
    );
  };

  const untaggedView = () => {
    const tasks = o.tasks.filter((x) => !x.proje);
    return (
      <>
        <div style={{ ...card, padding: 9, gap: 6 }}>
          <span style={muted}>{t('officeProjects.untaggedHint')}</span>
          {spendLine(GENERAL)}
        </div>
        <div style={card}>
          <div style={head}>{t('projects.tasksTitle', { count: tasks.filter(open).length })}</div>
          <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>{taskList(tasks.filter(open))}</div>
        </div>
      </>
    );
  };

  const save = async () => {
    if (!draft) return;
    const res = await window.cth.officeProjectsSave?.(draft);
    if (!res?.ok) { setNote({ text: res?.error ?? t('projects.failed'), error: true }); return; }
    setNote({ text: t('aiEngines.saved'), error: false });
    setDraft(res.projects ?? draft);
    await refresh();
  };
  const patch = (i: number, p: Partial<OfficeProject>) => setDraft((d) => (d ? d.map((x, j) => (j === i ? { ...x, ...p } : x)) : d));

  const editView = () => (
    <div style={card}>
      <div style={head}>{t('officeProjects.editTitle')}</div>
      <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={muted}>{t('officeProjects.editHint')}</span>
        {(draft ?? []).map((p, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', opacity: p.archived ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={p.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder={t('officeProjects.name')} style={{ ...input, flex: 1 }} />
              <select value={p.color} onChange={(e) => patch(i, { color: e.target.value })} style={input}>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {chip(p)}
              <label style={{ ...muted, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={!!p.archived} onChange={(e) => patch(i, { archived: e.target.checked || undefined })} />
                {t('projects.archive')}
              </label>
            </div>
            <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>{t('officeProjects.idLabel', { id: p.id || '—' })}</span>
            <input value={p.dir ?? ''} onChange={(e) => patch(i, { dir: e.target.value || undefined })} placeholder={t('officeProjects.dirPlaceholder')} style={input} />
            <input value={p.docs ?? ''} onChange={(e) => patch(i, { docs: e.target.value || undefined })} placeholder={t('officeProjects.docsPlaceholder')} style={input} />
            <input
              value={(p.aliases ?? []).join(', ')}
              onChange={(e) => patch(i, { aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder={t('officeProjects.aliasesPlaceholder')}
              style={input}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <PixelButton variant="secondary" size="sm" onClick={() => setDraft((d) => [...(d ?? []), { id: '', name: '', color: COLORS[(d?.length ?? 0) % COLORS.length] }])}>
            {t('officeProjects.add')}
          </PixelButton>
          <PixelButton variant="primary" size="sm" onClick={() => void save()}>{t('common.save')}</PixelButton>
        </div>
      </div>
    </div>
  );

  const current = byId.get(view);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--cth-paper-200)', padding: 10, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--cth-font-mono)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, boxShadow: 'inset 0 -1px 0 var(--cth-ink-300)' }}>
        {tabBtn(ALL, t('projects.tabAll'))}
        {live.map((p) => {
          const qs = o.tasks.filter((x) => x.proje === p.id && x.question && open(x)).length;
          const busy = o.team.filter((a) => a.projects.includes(p.id)).length;
          return tabBtn(p.id, <>
            <span style={{ width: 9, height: 9, flexShrink: 0, background: `var(--cth-${p.color})`, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }} />
            {p.name}
            {busy > 0 && <span style={{ fontSize: 11, color: '#25a244' }}>●{busy}</span>}
            {qs > 0 && <span style={{ fontSize: 11, color: 'var(--cth-coral)' }}>?{qs}</span>}
          </>);
        })}
        {o.tasks.some((x) => !x.proje && open(x)) && tabBtn(UNTAGGED, t('officeProjects.untagged'))}
        {tabBtn(EDIT, t('officeProjects.editTab'))}
      </div>

      {note && <div style={{ fontSize: 13, color: note.error ? 'var(--cth-coral)' : 'var(--cth-ink-700)' }}>{note.text}</div>}

      {live.length === 0 && view !== EDIT && (
        <div style={{ textAlign: 'center', padding: '24px 12px', ...muted, fontSize: 13 }}>{t('officeProjects.empty')}</div>
      )}
      {view === ALL && allView()}
      {view === UNTAGGED && untaggedView()}
      {view === EDIT && editView()}
      {current && projectView(current)}
    </div>
  );
}
