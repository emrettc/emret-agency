/**
 * Günlük özet — her sabah tek sayfalık ofis raporu (saf; zamanlama main'de).
 *
 * Görev panosunda "bitti" zamanı tutulmadığı için "dünden beri biten" bir önceki
 * özette bitmiş görülen kimliklere göre bulunur; harcama da bir önceki özetteki
 * toplam maliyete göre fark olarak hesaplanır.
 */

export interface SummaryTask { id?: unknown; title?: unknown; status?: unknown; assignee?: unknown; humanQA?: unknown }
export interface SummaryApproval { id: string; title: string; from: string; status: string }
export interface SummaryInboxItem { id: string; kind: string; title: string; from: string; read?: boolean }

export interface SummaryInput {
  now: Date;
  tasks: SummaryTask[];
  /** Bir önceki özette "bitti" görülen görevler. null = ilk özet. */
  prevDoneIds: string[] | null;
  approvals: SummaryApproval[];
  inbox: SummaryInboxItem[];
  /** İnceleme Masası'nda bekleyen iş sayısı. */
  reviewCount: number;
  /** Şu anki toplam harcama ($) ve bir önceki özetteki (yoksa null). */
  costNow: number;
  costPrev: number | null;
  /** Yanıt bekleyen soru açık mı? (shared/humanQA.openHumanAsk) */
  isOpenAsk: (raw: unknown) => boolean;
  nameOf: (agentId: string) => string;
}

export interface SummaryOutput { title: string; body: string; doneIds: string[] }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function buildDailySummary(inp: SummaryInput): SummaryOutput {
  const date = inp.now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const tasks = inp.tasks.filter((t) => t && typeof t.id === 'string');
  const doneIds = tasks.filter((t) => str(t.status) === 'done').map((t) => t.id as string);
  const prev = new Set(inp.prevDoneIds ?? []);
  const newlyDone = inp.prevDoneIds === null ? [] : tasks.filter((t) => str(t.status) === 'done' && !prev.has(t.id as string));
  const doing = tasks.filter((t) => str(t.status) === 'doing');
  const todo = tasks.filter((t) => str(t.status) === 'todo');
  const blocked = tasks.filter((t) => str(t.status) === 'blocked');
  const asks = tasks.filter((t) => inp.isOpenAsk(t.humanQA));
  const approvals = inp.approvals.filter((a) => a.status === 'bekliyor');
  const unread = inp.inbox.filter((i) => !i.read && i.kind !== 'giden');
  const who = (t: SummaryTask): string => (str(t.assignee) ? ` — ${inp.nameOf(str(t.assignee))}` : '');
  const list = (items: SummaryTask[], max = 8): string[] =>
    [...items.slice(0, max).map((t) => `  • ${str(t.title) || String(t.id)}${who(t)}`), ...(items.length > max ? [`  • … ve ${items.length - max} tane daha`] : [])];

  const lines: string[] = [];
  const needYou = asks.length + approvals.length + inp.reviewCount;
  lines.push(needYou > 0
    ? `Seni bekleyen ${needYou} şey var: ${[asks.length && `${asks.length} soru`, approvals.length && `${approvals.length} onay`, inp.reviewCount && `${inp.reviewCount} inceleme`].filter(Boolean).join(', ')}.`
    : 'Seni bekleyen bir şey yok.');
  lines.push('');
  if (inp.prevDoneIds === null) lines.push(`✅ Biten görevler: toplam ${doneIds.length} (ilk özet — yarından itibaren yalnız yeni bitenler listelenir)`);
  else {
    lines.push(`✅ Dünden beri biten: ${newlyDone.length}`);
    lines.push(...list(newlyDone));
  }
  lines.push(`🔨 Üzerinde çalışılan: ${doing.length} · sırada bekleyen: ${todo.length}`);
  lines.push(...list(doing, 5));
  if (blocked.length) {
    lines.push(`⛔ Takılan: ${blocked.length}`);
    lines.push(...list(blocked));
  }
  if (asks.length) {
    lines.push(`❓ Yanıtını bekleyen sorular: ${asks.length} (Bana Sor)`);
    lines.push(...list(asks, 5));
  }
  if (approvals.length) {
    lines.push(`🖊 Onay bekleyen: ${approvals.length}`);
    lines.push(...approvals.slice(0, 5).map((a) => `  • ${a.title} — ${inp.nameOf(a.from)}`));
  }
  if (inp.reviewCount) lines.push(`🔍 İnceleme Masası'nda bekleyen iş: ${inp.reviewCount}`);
  if (unread.length) lines.push(`📬 Okunmamış mesaj: ${unread.length}`);
  lines.push('');
  const spent = inp.costPrev === null ? null : Math.max(0, inp.costNow - inp.costPrev);
  lines.push(spent === null
    ? `💰 Toplam harcama: $${inp.costNow.toFixed(2)} (yerel modeller $0 sayılır)`
    : `💰 Dünden beri harcama: $${spent.toFixed(2)} · toplam $${inp.costNow.toFixed(2)} (yerel modeller $0 sayılır)`);

  return { title: `Günlük özet — ${date}`, body: lines.join('\n'), doneIds };
}

/** Bugünün özeti gönderilmeli mi? (saat geldi ve bugün henüz gönderilmedi) */
export function summaryDue(now: Date, hour: number, lastDate: string | null): boolean {
  if (hour < 0 || hour > 23) return false;
  const today = localDate(now);
  return now.getHours() >= hour && lastDate !== today;
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
