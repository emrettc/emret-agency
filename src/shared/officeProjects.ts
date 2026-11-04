/**
 * Tek ofis, ortak ajanlar, etiketli projeler — SAF çekirdek.
 *
 * Emre 2026-10-29: projeler ayrı ofis (ayrı uygulama kopyası) DEĞİL; aynı ekip
 * birden çok projede çalışır, boştaki ajan başka projeye geçebilir. Karışmayı
 * önleyen şey ETİKET: her görevin `proje` alanı (yoksa başlık öneki
 * "ilanveral.com — …"), her projenin kendi çalışma/belge klasörü. Ajanın o anki
 * projesi üstlendiği "doing" görevden gelir; token harcaması da buna göre
 * projelere dağıtılır (yaklaşık — örnekleme aralığında hangi projedeydiyse).
 *
 * Disk: <hive>/projeler.json (liste), <hive>/proje-harcama.json (harcama).
 */

export interface OfficeProject {
  /** Kalıcı kimlik (slug) — tasks.json `proje` alanının değeri. */
  id: string;
  name: string;
  /** Tema vurgu rengi adı (var(--cth-<color>)). */
  color: string;
  /** Çalışma klasörü (kod deposu / iş klasörü). */
  dir?: string;
  /** Rapor / belge klasörü (yoksa dir). */
  docs?: string;
  /** Başlık önekinde de tanınan diğer adlar. */
  aliases?: string[];
  archived?: boolean;
}

/** Hiçbir projeye ait olmayan harcama (görevsiz çalışma, orkestrasyon). */
export const GENERAL_PROJECT = 'genel';

export const PROJECT_COLORS = ['sky', 'lemon', 'coral', 'mint', 'lilac', 'peach', 'rose', 'teal'];

function fold(s: string): string {
  return s
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
}

export function projectSlug(name: string): string {
  return fold(name).replace(/\.(com|net|org)(\.tr)?\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Ham listeyi doğrula. Kimliksiz kayda addan kimlik üretilir; yinelenen düşer. */
export function normalizeOfficeProjects(raw: unknown): OfficeProject[] {
  if (!Array.isArray(raw)) return [];
  const out: OfficeProject[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    const name = str(e.name);
    if (!name) continue;
    const id = (str(e.id) && projectSlug(str(e.id)!)) || projectSlug(name);
    if (!id || id === GENERAL_PROJECT || seen.has(id)) continue;
    seen.add(id);
    const aliases = Array.isArray(e.aliases) ? e.aliases.map(str).filter((a): a is string => !!a) : [];
    out.push({
      id,
      name,
      color: str(e.color) ?? PROJECT_COLORS[out.length % PROJECT_COLORS.length],
      ...(str(e.dir) ? { dir: str(e.dir) } : {}),
      ...(str(e.docs) ? { docs: str(e.docs) } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(e.archived === true ? { archived: true } : {})
    });
  }
  return out;
}

/** Görevin projesi: geçerli `proje` alanı, yoksa başlık öneki ("X — …" / "X - …"). */
export function projectOfTask(task: { proje?: unknown; title?: unknown }, projects: OfficeProject[]): string | null {
  const explicit = str(task.proje);
  if (explicit) {
    const id = projectSlug(explicit);
    if (projects.some((p) => p.id === id)) return id;
  }
  const title = str(task.title);
  if (!title) return null;
  const m = /^(.+?)\s+[—–-]\s+/.exec(title);
  if (!m) return null;
  const prefix = fold(m[1].trim());
  const slugPrefix = projectSlug(m[1]);
  for (const p of projects) {
    const names = [p.name, p.id, ...(p.aliases ?? [])];
    if (names.some((n) => fold(n) === prefix || projectSlug(n) === slugPrefix)) return p.id;
  }
  return null;
}

/** ajan → üstlendiği "doing" görevlerin projeleri (sırayla, tekrarsız). */
export function currentProjects(tasks: Array<Record<string, unknown>>, projects: OfficeProject[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tasks) {
    if (!t || t.status !== 'doing' || typeof t.assignee !== 'string' || !t.assignee) continue;
    const pid = projectOfTask(t, projects);
    if (!pid) continue;
    const list = (out[t.assignee] = out[t.assignee] ?? []);
    if (!list.includes(pid)) list.push(pid);
  }
  return out;
}

export interface SpendTotals { tokens: number; usd: number }

export interface ProjectSpendState {
  /** Ajan başına son görülen birikimli fleet.json değerleri. */
  last: Record<string, SpendTotals>;
  /** Proje başına toplam (izleme başladığından beri). */
  byProject: Record<string, SpendTotals>;
  since?: string;
  updatedAt?: string;
}

const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Bir örnekleme turu: her ajanın son turdan bu yana artışı, o an çalıştığı
 * proje(ler)e eşit bölünür; görevsizse GENERAL_PROJECT'e. İlk görülen ajan
 * yalnız taban olur; sayaç geriye giderse (yeniden başlatma) taban sıfırlanır.
 */
export function attributeSpend(
  state: ProjectSpendState,
  fleet: Array<{ id?: unknown; tokens?: unknown; usd?: unknown }>,
  current: Record<string, string[]>
): ProjectSpendState {
  const last: Record<string, SpendTotals> = { ...state.last };
  const byProject: Record<string, SpendTotals> = Object.fromEntries(
    Object.entries(state.byProject).map(([k, v]) => [k, { ...v }])
  );
  for (const a of fleet) {
    if (typeof a.id !== 'string') continue;
    const now: SpendTotals = {
      tokens: typeof a.tokens === 'number' && Number.isFinite(a.tokens) ? a.tokens : 0,
      usd: typeof a.usd === 'number' && Number.isFinite(a.usd) ? a.usd : 0
    };
    const prev = last[a.id];
    last[a.id] = now;
    if (!prev) continue;
    const dTok = now.tokens - prev.tokens;
    const dUsd = now.usd - prev.usd;
    if (dTok <= 0 && dUsd <= 0) continue;
    const targets = current[a.id]?.length ? current[a.id] : [GENERAL_PROJECT];
    for (const pid of targets) {
      const b = (byProject[pid] = byProject[pid] ?? { tokens: 0, usd: 0 });
      b.tokens = Math.round(b.tokens + Math.max(0, dTok) / targets.length);
      b.usd = round(b.usd + Math.max(0, dUsd) / targets.length, 6);
    }
  }
  return { ...state, last, byProject };
}
