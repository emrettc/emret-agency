/**
 * Project registry (Phase 3.2, docs/FAZ3-TASARIM.md §4.3).
 *
 * The Merkez instance keeps `projeler.json` in its userData folder: one entry
 * per project, each of which runs as its own app instance (`--profile=<id>`)
 * against its own folder. Per the decisions in §7 every project is set up from
 * scratch (own settings, own API keys): creating one only writes the folder
 * and a minimal profile config pointing at it.
 *
 * Status is read from the project's files, never written: the workspace lock
 * says whether it runs, fleet.json / tasks.json / onaylar.json /
 * insan-kutusu.json say what it is doing. A stop is a request file the running
 * instance picks up and answers with its own normal quit.
 *
 * Pure node (no electron) so it is unit-testable; the caller passes paths.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockOwner } from './hiveLock';
import { profileIdFromName } from '../shared/profile';
import { openHumanAsk } from '../shared/humanQA';

export const PROJECTS_FILE = 'projeler.json';
/** Dropped into a project's folder to ask its running instance to quit. */
export const STOP_REQUEST_FILE = '.tutucu-ofis.stop';

export interface Project {
  id: string;
  name: string;
  dir: string;
  createdAt: string;
  archived?: boolean;
}

export interface ProjectStatus extends Project {
  running: boolean;
  pid?: number;
  agents: number;
  activeAgents: number;
  openTasks: number;
  blockedTasks: number;
  questions: number;
  approvals: number;
  unread: number;
  costUsd: number;
  /** Tüm ajanların toplam token'ı (fleet.json, birikimli). */
  tokens: number;
  lastActivity?: string;
  /** Proje sekmesinin ayrıntısı: arşivli olmayan ajanlar. */
  team: ProjectAgent[];
  /** Açık (done olmayan) görevler. */
  taskList: ProjectTask[];
  /** Yanıt bekleyen insan soruları (görev başına ilk açık soru). */
  questionList: Array<{ taskId: string; title: string; q: string }>;
}

/** Proje sekmesindeki ajan satırı. `status` roster.json'dan (renderer'ın canlı
 *  durumu: working / idle / waiting / blocked …); proje kapalıysa 'off'. */
export interface ProjectAgent {
  id: string;
  name: string;
  isGod: boolean;
  status: string;
  action?: string;
  provider?: string;
  model?: string;
  tokens: number;
  usd: number;
  lastTool?: string;
  lastActiveSecAgo?: number;
  inboxBacklog: number;
  onHold: boolean;
}

export interface ProjectTask {
  id: string;
  title: string;
  status: string;
  assignee?: string;
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return fallback; }
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

export class ProjectRegistry {
  constructor(
    /** The Merkez userData folder (projeler.json and profiles/ live here). */
    private readonly merkezDir: string,
    /** Default parent folder for new projects. */
    private readonly projectsRoot: string
  ) {}

  private file(): string { return join(this.merkezDir, PROJECTS_FILE); }

  list(): Project[] {
    const raw = readJson<{ projects?: unknown }>(this.file(), { projects: [] });
    return Array.isArray(raw.projects)
      ? raw.projects.filter((p): p is Project => !!p && typeof p === 'object'
          && typeof (p as Project).id === 'string' && typeof (p as Project).dir === 'string')
      : [];
  }

  private save(projects: Project[]): void {
    mkdirSync(this.merkezDir, { recursive: true });
    writeJsonAtomic(this.file(), { projects });
  }

  get(id: string): Project | undefined {
    return this.list().find((p) => p.id === id);
  }

  /** The folder a project named `name` gets when none is chosen. */
  defaultDir(name: string): string {
    const safe = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '');
    return join(this.projectsRoot, safe || 'proje');
  }

  /** Create a project: registry entry, folder, and a profile config pointing at
   *  the folder. Refuses a duplicate id, or a folder another project uses. */
  create(name: unknown, dir?: unknown): { ok: true; project: Project } | { ok: false; error: string } {
    const clean = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (!clean) return { ok: false, error: 'Proje adı boş olamaz.' };
    const base = profileIdFromName(clean);
    if (!base) return { ok: false, error: 'Proje adında en az bir harf veya rakam olmalı.' };
    const projects = this.list();
    let id = base;
    for (let n = 2; projects.some((p) => p.id === id); n++) id = `${base.slice(0, 36)}-${n}`;
    const folder = typeof dir === 'string' && dir.trim() ? dir.trim() : this.defaultDir(clean);
    const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
    const clash = projects.find((p) => norm(p.dir) === norm(folder));
    if (clash) return { ok: false, error: `Bu klasörü zaten "${clash.name}" projesi kullanıyor.` };
    if (norm(folder) === norm(this.merkezDir)) return { ok: false, error: 'Bu klasör kullanılamaz.' };
    try {
      mkdirSync(folder, { recursive: true });
      const profileDir = join(this.merkezDir, 'profiles', id);
      mkdirSync(profileDir, { recursive: true });
      const cfgPath = join(profileDir, 'config.json');
      // Only the workspace is pre-set; every other setting starts fresh (§7).
      if (!existsSync(cfgPath)) writeJsonAtomic(cfgPath, { harnessHome: folder });
    } catch (e) {
      return { ok: false, error: `Klasör oluşturulamadı: ${e instanceof Error ? e.message : String(e)}` };
    }
    const project: Project = { id, name: clean, dir: folder, createdAt: new Date().toISOString() };
    this.save([...projects, project]);
    return { ok: true, project };
  }

  setArchived(id: string, archived: boolean): { ok: boolean; error?: string } {
    const projects = this.list();
    const p = projects.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'Proje bulunamadı.' };
    if (archived && lockOwner(p.dir)) return { ok: false, error: 'Önce projeyi durdurun.' };
    p.archived = archived || undefined;
    this.save(projects);
    return { ok: true };
  }

  rename(id: string, name: unknown): { ok: boolean; error?: string } {
    const clean = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (!clean) return { ok: false, error: 'Proje adı boş olamaz.' };
    const projects = this.list();
    const p = projects.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'Proje bulunamadı.' };
    p.name = clean;
    this.save(projects);
    return { ok: true };
  }

  /** Ask a running project to quit. Its instance polls for the file. */
  requestStop(id: string): { ok: boolean; error?: string } {
    const p = this.get(id);
    if (!p) return { ok: false, error: 'Proje bulunamadı.' };
    if (!lockOwner(p.dir)) return { ok: false, error: 'Proje zaten kapalı.' };
    try { writeFileSync(join(p.dir, STOP_REQUEST_FILE), new Date().toISOString(), 'utf8'); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    return { ok: true };
  }

  status(now = Date.now()): ProjectStatus[] {
    return this.list().map((p) => projectStatus(p, now));
  }
}

/** Read-only summary of one project from its files. */
export function projectStatus(p: Project, now = Date.now()): ProjectStatus {
  const hive = join(p.dir, 'hive');
  const owner = lockOwner(p.dir, now);
  const fleet = readJson<{ ts?: number; agents?: Array<Record<string, unknown>> }>(join(hive, 'fleet.json'), {});
  const agents = Array.isArray(fleet.agents) ? fleet.agents : [];
  const tasksRaw = readJson<{ tasks?: Array<Record<string, unknown>> }>(join(hive, 'tasks.json'), {});
  const tasks = Array.isArray(tasksRaw.tasks) ? tasksRaw.tasks : [];
  const approvalsRaw = readJson<{ items?: Array<Record<string, unknown>> }>(join(hive, 'onaylar.json'), {});
  const inboxRaw = readJson<{ items?: Array<Record<string, unknown>> }>(join(hive, 'insan-kutusu.json'), {});
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  // roster.json (harnessHome kökünde) renderer'ın canlı durumunu tutar; fleet.json
  // yalnız sayıları. İkisi ajan kimliğiyle birleştirilir.
  const rosterRaw = readJson<{ agents?: Array<Record<string, unknown>> }>(join(p.dir, 'roster.json'), {});
  const roster = new Map((Array.isArray(rosterRaw.agents) ? rosterRaw.agents : [])
    .filter((a) => a && typeof a.id === 'string').map((a) => [a.id as string, a]));
  // fleet.json kapanmış/arşivlenmiş worker'ları da tutmaya devam eder; roster'ın
  // canlı listesi varsa yalnız ondakiler gösterilir.
  const hasRoster = roster.size > 0;
  const team: ProjectAgent[] = agents.filter((a) => a && !a.archived && typeof a.id === 'string'
    && (!hasRoster || roster.has(a.id as string))).map((a) => {
    const r = roster.get(a.id as string) ?? {};
    return {
      id: a.id as string,
      name: str(a.name) ?? (a.id as string),
      isGod: a.isGod === true,
      status: owner ? (str(r.status) ?? 'idle') : 'off',
      ...(str(r.action) ? { action: str(r.action) } : {}),
      ...(str(r.provider) ? { provider: str(r.provider) } : {}),
      ...(str(r.model) ? { model: str(r.model) } : {}),
      tokens: num(a.tokens),
      usd: num(a.usd),
      ...(str(a.lastTool) ? { lastTool: str(a.lastTool) } : {}),
      ...(typeof a.lastActiveSecAgo === 'number' ? { lastActiveSecAgo: a.lastActiveSecAgo } : {}),
      inboxBacklog: num(a.inboxBacklog),
      onHold: a.onHold === true
    };
  });
  const taskList: ProjectTask[] = tasks.filter((t) => t && t.status !== 'done' && typeof t.id === 'string').map((t) => ({
    id: t.id as string,
    title: str(t.title) ?? (t.id as string),
    status: str(t.status) ?? 'todo',
    ...(str(t.assignee) ? { assignee: str(t.assignee) } : {})
  }));
  const questionList = tasks.filter((t) => t && typeof t.id === 'string' && openHumanAsk(t.humanQA)).map((t) => {
    const e = openHumanAsk(t.humanQA)!;
    return { taskId: t.id as string, title: str(t.title) ?? (t.id as string), q: e.q };
  });
  return {
    ...p,
    running: !!owner,
    ...(owner ? { pid: owner.pid } : {}),
    agents: agents.length,
    activeAgents: agents.filter((a) => !a.archived && typeof a.lastActiveSecAgo === 'number' && (a.lastActiveSecAgo as number) < 300).length,
    openTasks: tasks.filter((t) => t && t.status !== 'done').length,
    blockedTasks: tasks.filter((t) => t && t.status === 'blocked').length,
    questions: tasks.filter((t) => t && openHumanAsk(t.humanQA)).length,
    approvals: (Array.isArray(approvalsRaw.items) ? approvalsRaw.items : []).filter((a) => a && a.status === 'bekliyor').length,
    unread: (Array.isArray(inboxRaw.items) ? inboxRaw.items : []).filter((i) => i && !i.read && i.kind !== 'giden').length,
    costUsd: agents.reduce((s, a) => s + num(a.usd), 0),
    tokens: agents.reduce((s, a) => s + num(a.tokens), 0),
    ...(typeof fleet.ts === 'number' ? { lastActivity: new Date(fleet.ts).toISOString() } : {}),
    team,
    taskList,
    questionList
  };
}
