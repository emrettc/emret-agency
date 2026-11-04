/**
 * Yerel motor performans ölçüsü — Ayarlar › Motorlar'daki "Yerel model sırası"
 * kartının üstündeki gösterge için.
 *
 *  - Ekran kartı: nvidia-smi (yoksa null — NVIDIA dışı / sürücüsüz makine).
 *  - Yüklü modeller: Ollama `/api/ps` — modelin ne kadarı ekran kartında.
 *    Bir kısmı işlemcide (CPU) ise model ekran kartı belleğine sığmıyor demektir;
 *    yanıtlar birkaç kat yavaşlar. Gösterge bunu açıkça uyarır.
 *  - llama-server (localServer.ts) da tanınır: `/props` + `/completion`.
 *  - Hız testi: Ollama `/api/generate` ile ~4k tokenlık sabit bir istem; Ollama'nın
 *    kendi ölçtüğü okuma (istem işleme) ve yazma (yanıt üretme) hızı döner.
 */
import { execFile } from 'node:child_process';

export interface GpuInfo { name: string; usedMb: number; totalMb: number; utilPct: number }
export interface LoadedModel { name: string; /** Modelin ekran kartındaki payı (%); bilinmiyorsa null. */ gpuPct: number | null; context: number | null }
export type LocalEngineKind = 'ollama' | 'llama-server';
export interface LocalPerf { gpu: GpuInfo | null; models: LoadedModel[]; engine: LocalEngineKind | null }
export interface BenchResult {
  model: string;
  at: number;
  /** İstemi okuma hızı (token/sn). */
  readTps: number;
  /** Yanıt yazma hızı (token/sn). */
  writeTps: number;
  promptTokens: number;
  /** Modelin belleğe yüklenmesi (sn) — model zaten yüklüyse ~0. */
  loadSec: number;
}

/** `http://localhost:11434/v1` → `http://localhost:11434` */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** nvidia-smi CSV satırı → GpuInfo (bozuksa null). Testler doğrudan çağırır. */
export function parseNvidiaSmi(out: string): GpuInfo | null {
  const line = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const [name, used, total, util] = line.split(',').map((x) => x.trim());
  const n = (x: string | undefined): number => Number.parseFloat(x ?? '');
  if (!name || !Number.isFinite(n(used)) || !Number.isFinite(n(total))) return null;
  return { name, usedMb: n(used), totalMb: n(total), utilPct: Number.isFinite(n(util)) ? n(util) : 0 };
}

function readGpu(): Promise<GpuInfo | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parseNvidiaSmi(String(stdout)))
    );
  });
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type LlamaProps = { model_alias?: string; model_path?: string; default_generation_settings?: { n_ctx?: number } };

export async function readLocalPerf(baseUrl: string): Promise<LocalPerf> {
  const root = ollamaRoot(baseUrl);
  const [gpu, ps, props] = await Promise.all([
    readGpu(),
    getJson<{ models?: Array<{ name: string; size: number; size_vram: number; context_length?: number }> }>(`${root}/api/ps`).catch(() => null),
    getJson<LlamaProps>(`${root}/props`).catch(() => null)
  ]);
  if (ps) {
    return {
      gpu,
      engine: 'ollama',
      models: (ps.models ?? []).map((m) => ({
        name: m.name.replace(/:latest$/, ''),
        gpuPct: m.size ? Math.round((m.size_vram / m.size) * 100) : null,
        context: m.context_length ?? null
      }))
    };
  }
  if (props) {
    // llama-server bütün katmanları ekran kartında açılır (-ngl 99): tamamı GPU'da.
    const name = props.model_alias || (props.model_path ?? '').split(/[\\/]/).pop() || 'model';
    return { gpu, engine: 'llama-server', models: [{ name, gpuPct: 100, context: props.default_generation_settings?.n_ctx ?? null }] };
  }
  return { gpu, engine: null, models: [] };
}

/** Sabit test istemi (~4k token). Her testte aynı metin: sonuçlar karşılaştırılabilir. */
const BENCH_PROMPT =
  'Aşağıdaki metin yerel modelin hızını ölçmek içindir; içeriği önemsizdir.\n' +
  Array.from({ length: 160 }, (_, i) => `${i + 1}. satır: ofisteki ajanlar görevlerini sırayla alır, bitirir ve raporlar.`).join('\n') +
  '\nBu metni tek cümleyle özetle.';

export async function benchLocalModel(baseUrl: string, model: string): Promise<BenchResult> {
  const root = ollamaRoot(baseUrl);
  const isLlama = await getJson<LlamaProps>(`${root}/props`).then(() => true, () => false);
  if (isLlama) {
    const r = await getJson<{ timings?: { prompt_n?: number; prompt_per_second?: number; predicted_per_second?: number } }>(
      `${root}/completion`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: `[${Date.now()}]\n${BENCH_PROMPT}`, n_predict: 48, cache_prompt: false }) },
      10 * 60_000
    );
    const t = r.timings ?? {};
    const r1 = (x?: number): number => Math.round((x ?? 0) * 10) / 10;
    return { model, at: Date.now(), readTps: r1(t.prompt_per_second), writeTps: r1(t.predicted_per_second), promptTokens: t.prompt_n ?? 0, loadSec: 0 };
  }
  const r = await getJson<{
    prompt_eval_count?: number; prompt_eval_duration?: number;
    eval_count?: number; eval_duration?: number; load_duration?: number;
  }>(
    `${root}/api/generate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Önbellekten okunmasın diye başına zaman damgası: ölçülen gerçek okuma hızı.
      body: JSON.stringify({ model, prompt: `[${Date.now()}]\n${BENCH_PROMPT}`, stream: false, options: { num_predict: 48 } })
    },
    // Model yüklü değilse önce belleğe yüklenir; ajanlar modeldeyse sırada bekler.
    10 * 60_000
  );
  const tps = (n?: number, ns?: number): number => (n && ns ? Math.round((n / (ns / 1e9)) * 10) / 10 : 0);
  return {
    model,
    at: Date.now(),
    readTps: tps(r.prompt_eval_count, r.prompt_eval_duration),
    writeTps: tps(r.eval_count, r.eval_duration),
    promptTokens: r.prompt_eval_count ?? 0,
    loadSec: Math.round(((r.load_duration ?? 0) / 1e9) * 10) / 10
  };
}
