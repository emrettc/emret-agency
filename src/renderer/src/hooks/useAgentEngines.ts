import { useSyncExternalStore } from 'react';
import { isLocalEndpoint, normalizeEndpoints } from '@shared/byokEndpoints';

/**
 * Her canlı ajanın şu an hangi motorda çalıştığı — kartlardaki "Yerel / API"
 * rozeti için. Main'in `agentEngine:state` cevabı + motor listesi, uygulama
 * genelinde TEK bir yoklamayla (5 sn) okunur; kaç kart abone olursa olsun.
 *
 *  - local: bu bilgisayardaki motor (Ollama…) — ücretsiz, token harcamaz.
 *  - api:   uzak motor (EVREN, ChatGPT, Claude…) — kullandıkça ücretli.
 */
export interface AgentEngineBadge {
  kind: 'local' | 'api';
  /** Motorun görünen adı (ör. "Genel İşler", "EVREN LLM Gateway", "Claude"). */
  label: string;
  model?: string;
  /** İzleme'den seçilmiş geçici motor mu? */
  temporary: boolean;
}

type Snapshot = Record<string, AgentEngineBadge>;

const POLL_MS = 5000;
let snapshot: Snapshot = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  try {
    const [state, cfg] = await Promise.all([window.cth.agentEngineState(), window.cth.getConfig()]);
    const endpoints = normalizeEndpoints(cfg?.byokEndpoints ?? []);
    const next: Snapshot = {};
    for (const [id, s] of Object.entries(state ?? {})) {
      const ep = endpoints.find((e) => e.id === s.engine);
      if (ep) {
        next[id] = { kind: isLocalEndpoint(ep) ? 'local' : 'api', label: ep.label, model: s.model, temporary: !!s.session };
      } else {
        // Claude Code'un kendi motoru ya da modeli belirsiz OpenCode: ikisi de uzak, ücretli.
        next[id] = { kind: 'api', label: s.engine === 'claude' ? 'Claude' : s.engine === 'opencode' ? 'OpenCode' : s.engine, model: s.model, temporary: !!s.session };
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
      snapshot = next;
      listeners.forEach((l) => l());
    }
  } catch { /* bir sonraki yoklamada tekrar denenir */ }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    void refresh();
    timer = setInterval(() => { void refresh(); }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

const getSnapshot = (): Snapshot => snapshot;

export function useAgentEngines(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
