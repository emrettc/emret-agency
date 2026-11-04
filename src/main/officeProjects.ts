/**
 * Tek ofis, etiketli projeler — main tarafı (saf kurallar shared/officeProjects.ts).
 *
 *  - <hive>/projeler.json: proje listesi (kullanıcı Projeler sekmesinden düzenler,
 *    god okur ve görevlere `proje` alanını yazar).
 *  - <hive>/proje-harcama.json: dakikada bir fleet.json artışlarının, ajanın o an
 *    üstlendiği görevin projesine dağıtılmış toplamı (yaklaşık).
 *  - overview(): Projeler sekmesinin tek sorgusu — projeler, harcama, ajanlar
 *    (canlı durum + o anki projeleri), görevler (projesiyle) ve açık sorular.
 *
 * Pure node (electron'suz) — hive kökü çağırandan gelir; test edilebilir.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  attributeSpend, currentProjects, normalizeOfficeProjects, projectOfTask,
  type OfficeProject, type ProjectSpendState
} from '../shared/officeProjects';
import { projectStatus, type ProjectAgent } from './projects';
import { openHumanAsk } from '../shared/humanQA';

export const OFFICE_PROJECTS_FILE = 'projeler.json';
export const PROJECT_SPEND_FILE = 'proje-harcama.json';
const SAMPLE_MS = 60_000;

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return fallback; }
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

export interface OfficeTask {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  proje: string | null;
  /** İlk yanıtlanmamış insan sorusu. */
  question?: string;
}

export interface OfficeOverview {
  projects: OfficeProject[];
  spend: ProjectSpendState['byProject'];
  spendSince?: string;
  team: Array<ProjectAgent & { projects: string[] }>;
  tasks: OfficeTask[];
}

export class OfficeProjectsService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly hiveRoot: () => string | null) {}

  private path(name: string): string | null {
    const r = this.hiveRoot();
    return r ? join(r, name) : null;
  }

  list(): OfficeProject[] {
    const p = this.path(OFFICE_PROJECTS_FILE);
    return p ? normalizeOfficeProjects(readJson<{ projects?: unknown }>(p, {}).projects) : [];
  }

  save(raw: unknown): { ok: boolean; error?: string; projects?: OfficeProject[] } {
    const p = this.path(OFFICE_PROJECTS_FILE);
    if (!p) return { ok: false, error: 'Çalışma alanı yok.' };
    const projects = normalizeOfficeProjects(raw);
    try { writeJsonAtomic(p, { projects }); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    return { ok: true, projects };
  }

  private rawTasks(): Array<Record<string, unknown>> {
    const p = this.path('tasks.json');
    const t = p ? readJson<{ tasks?: unknown }>(p, {}).tasks : [];
    return Array.isArray(t) ? t.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
  }

  /** Bir örnekleme turu (dakikada bir). */
  sample(now = Date.now()): void {
    const spendPath = this.path(PROJECT_SPEND_FILE);
    const fleetPath = this.path('fleet.json');
    if (!spendPath || !fleetPath || !existsSync(fleetPath)) return;
    const fleet = readJson<{ agents?: unknown }>(fleetPath, {}).agents;
    if (!Array.isArray(fleet)) return;
    const state = readJson<ProjectSpendState>(spendPath, { last: {}, byProject: {} });
    const next = attributeSpend(
      { last: state.last ?? {}, byProject: state.byProject ?? {}, since: state.since ?? new Date(now).toISOString() },
      fleet as Array<{ id?: unknown; tokens?: unknown; usd?: unknown }>,
      currentProjects(this.rawTasks(), this.list())
    );
    try { writeJsonAtomic(spendPath, { ...next, updatedAt: new Date(now).toISOString() }); } catch { /* best-effort */ }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { try { this.sample(); } catch { /* best-effort */ } }, SAMPLE_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  overview(): OfficeOverview {
    const root = this.hiveRoot();
    const projects = this.list();
    if (!root) return { projects, spend: {}, team: [], tasks: [] };
    const raw = this.rawTasks();
    const cur = currentProjects(raw, projects);
    // projectStatus, harnessHome (hive'ın üstü) ile roster + fleet'i birleştirir.
    const status = projectStatus({ id: 'ofis', name: 'Ofis', dir: dirname(root), createdAt: '' });
    const spend = readJson<ProjectSpendState>(join(root, PROJECT_SPEND_FILE), { last: {}, byProject: {} });
    const tasks: OfficeTask[] = raw.filter((t) => typeof t.id === 'string').map((t) => {
      const qa = openHumanAsk(t.humanQA);
      return {
        id: t.id as string,
        title: typeof t.title === 'string' ? t.title : (t.id as string),
        status: typeof t.status === 'string' ? t.status : 'todo',
        ...(typeof t.assignee === 'string' && t.assignee ? { assignee: t.assignee } : {}),
        proje: projectOfTask(t, projects),
        ...(qa ? { question: qa.q as string } : {})
      };
    });
    return {
      projects,
      spend: spend.byProject ?? {},
      ...(spend.since ? { spendSince: spend.since } : {}),
      team: status.team.map((a) => ({ ...a, projects: cur[a.id] ?? [] })),
      tasks
    };
  }
}
