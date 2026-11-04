import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { useAgentEngines } from '@/hooks/useAgentEngines';
import { moveItem, orderByPriority, speedVerdict, summarizeRecent } from '@shared/localPriority';
import { spillTierOrder } from '@shared/localSpill';
import {
  DEFAULT_BYOK_ENDPOINTS,
  ENDPOINT_PRESETS,
  formatPins,
  isLocalEndpoint,
  isValidEndpointId,
  normalizeEndpoints,
  normalizeQuotaFailover,
  parsePinLines,
  splitList,
  type AgentEnginePin,
  type ByokEndpoint,
  type QuotaFailoverConfig
} from '@shared/byokEndpoints';

/**
 * ByokEnginesPanel — Ayarlar → Ajanlar ve Modeller → Motorlar.
 *
 *  1) Varsayılan işçi motoru: yönetici dışındaki, motoru seçilmemiş her ajan
 *     (yöneticinin sonradan açtıkları dahil) bununla başlar (config.workerDefaultEngine).
 *  2) Motorlar: EVREN, ChatGPT, yerel Ollama… — her biri adres + model + anahtar.
 *     Anahtar yalnız-yazılır secret broker'a gider (`endpointKey:*`), düz metin
 *     asla geri okunmaz. "Bağlantıyı test et" main'de `<adres>/models` çağırır.
 *  3) Motor ekle: hazır motorlar tek tıkla, özel motor ad + adresle.
 *  4) Gelişmiş: otomatik yedek motor ve kalıcı ajan atamaları.
 */

const inputStyle: CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 8px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
  borderRadius: 'var(--cth-radius-sm, 2px)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13,
  color: 'var(--cth-ink-900)',
  outline: 'none',
  boxSizing: 'border-box'
};
const fieldLabel: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-700)', fontWeight: 500 };
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' };
const desc: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '17px' };
const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
  borderRadius: 'var(--cth-radius-panel, 0px)'
};
const badge = (bg: string): CSSProperties => ({
  fontSize: 11, padding: '1px 7px', borderRadius: 10, background: bg, color: 'var(--cth-on-accent)', whiteSpace: 'nowrap'
});

/** "Şirket Motoru" → "sirket-motoru" — kimlik kullanıcıya hiç sorulmaz. */
function slugify(name: string, taken: Set<string>): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  let base = name.toLowerCase().replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'motor';
  if (!/^[a-z0-9]/.test(base)) base = `m-${base}`;
  let id = base;
  for (let i = 2; taken.has(id) || !isValidEndpointId(id); i++) id = `${base}-${i}`;
  return id;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/** Yerel motor performansı + kullanım (öncelik) sırası (main/localGate.ts, main/localPerf.ts). */
function LocalQueueCard({ initial, initialPriority }: { initial?: number; initialPriority?: string[] }) {
  const { t } = useTranslation();
  const e = (k: string, o?: Record<string, unknown>): string => t(`engines.queue.${k}`, o ?? {});
  const agents = useStore((s) => s.agents);
  const engines = useAgentEngines();
  const nameOf = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
  const [n, setN] = useState<number>(initial ?? 1);
  const [priority, setPriority] = useState<string[]>(initialPriority ?? []);
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.cth.localGateStatus>> | null>(null);
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof window.cth.localGatePerf>> | null>(null);
  const [benching, setBenching] = useState(false);
  const [benchErr, setBenchErr] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const loadSt = (): void => { void window.cth.localGateStatus().then((s) => { if (alive) setSt(s); }).catch(() => { /* noop */ }); };
    const loadPerf = (): void => { void window.cth.localGatePerf().then((p) => { if (alive) setPerf(p); }).catch(() => { /* noop */ }); };
    loadSt(); loadPerf();
    const a = setInterval(loadSt, 2000);
    const b = setInterval(loadPerf, 5000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);

  // Listede: yerelde çalışan ajanlar + sırada/modelde olanlar.
  const ids = useMemo(() => {
    const live = agents.filter((a) => !a.isGod && engines[a.id]?.kind === 'local').map((a) => a.id);
    const gate = [...(st?.active ?? []).map((x) => x.agentId), ...(st?.waiting ?? []).map((x) => x.agentId)].filter((id) => id !== 'bilinmeyen');
    const known = new Set(agents.map((a) => a.id));
    return orderByPriority([...new Set([...live, ...gate])], priority.filter((id) => known.has(id)));
  }, [agents, engines, st, priority]);

  const save = (next: string[]): void => {
    // Listede görünmeyen (şu an kapalı) ajanların kaydı korunur: sona eklenir.
    const merged = [...next, ...priority.filter((id) => !next.includes(id))];
    setPriority(merged);
    void window.cth.updateConfig({ localPriority: merged });
  };
  const move = (from: number, to: number): void => save(moveItem(ids, from, to));

  const runBench = async (): Promise<void> => {
    setBenching(true); setBenchErr(null);
    try {
      const r = await window.cth.localGateBench();
      if (!r.ok) setBenchErr(r.error);
      setPerf(await window.cth.localGatePerf());
    } catch (err) { setBenchErr(err instanceof Error ? err.message : String(err)); }
    finally { setBenching(false); }
  };

  const secs = (since: number): string => `${Math.max(0, Math.round((Date.now() - since) / 1000))} sn`;
  const gpu = perf?.perf?.gpu ?? null;
  const loaded = perf?.perf?.models ?? [];
  const bench = perf?.bench ?? null;
  const sum = summarizeRecent(st?.recent ?? []);
  const verdict = bench ? speedVerdict(bench.readTps) : null;
  const verdictColor = verdict === 'fast' ? 'var(--cth-mint, #3aa76d)' : verdict === 'ok' ? 'var(--cth-amber, #d49a1f)' : 'var(--cth-coral)';
  const busy = benching || !!perf?.benchRunning;

  return (
    <div style={card}>
      {/* ── Performans ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={sectionTitle}>{e('perfTitle')}</div>
          <div style={desc}>{e('hardwareNote')}</div>
        </div>
        <PixelButton onClick={() => { void runBench(); }} disabled={busy || !perf?.target}>
          {busy ? e('benchRunning') : e('benchRun')}
        </PixelButton>
      </div>
      {perf?.perf && !perf.perf.engine && <div style={{ ...desc, color: 'var(--cth-coral)' }}>{e('engineDown')}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={perfTile}>
          <span style={tileLabel}>{e('gpu')}</span>
          {gpu ? (
            <>
              <span style={tileValue}>{(gpu.usedMb / 1024).toFixed(1)} / {(gpu.totalMb / 1024).toFixed(1)} GB</span>
              <Meter pct={(gpu.usedMb / gpu.totalMb) * 100} color={gpu.usedMb / gpu.totalMb > 0.95 ? 'var(--cth-coral)' : 'var(--cth-accent, #4a7bd0)'} />
              <span style={tileLabel}>{gpu.name} · {e('busy', { pct: gpu.utilPct })}</span>
            </>
          ) : <span style={tileLabel}>{e('noGpu')}</span>}
        </div>
        <div style={perfTile}>
          <span style={tileLabel}>{e('loadedModel')}</span>
          {loaded.length === 0 ? <span style={tileLabel}>{e('noneLoaded', { model: perf?.target ?? '—' })}</span> : loaded.map((m) => {
            const gpuPct = m.gpuPct ?? 100;
            return (
              <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...tileValue, fontSize: 14 }}>{m.name}</span>
                <span style={{ ...tileLabel, color: gpuPct < 100 ? 'var(--cth-coral)' : tileLabel.color }}>
                  {gpuPct < 100 ? e('spill', { pct: 100 - gpuPct }) : e('allGpu')}{m.context ? ` · ${e('context', { k: Math.round(m.context / 1024) })}` : ''}
                </span>
              </div>
            );
          })}
          {loaded.length > 1 && <span style={{ ...tileLabel, color: 'var(--cth-coral)' }}>{e('manyModels')}</span>}
          {perf?.perf?.engine && <span style={tileLabel}>{e(perf.perf.engine === 'llama-server' ? 'engineLlama' : 'engineOllama')}</span>}
        </div>
        <div style={perfTile}>
          <span style={tileLabel}>{e('readSpeed')}</span>
          {bench ? (
            <>
              <span style={{ ...tileValue, color: verdictColor }}>{Math.round(bench.readTps)} <span style={tileLabel}>{e('tps')}</span></span>
              <span style={tileLabel}>{e('promptEstimate', { sec: Math.round(15000 / Math.max(1, bench.readTps)) })}</span>
            </>
          ) : <span style={tileLabel}>{e('noBench')}</span>}
        </div>
        <div style={perfTile}>
          <span style={tileLabel}>{e('writeSpeed')}</span>
          {bench ? (
            <>
              <span style={tileValue}>{bench.writeTps} <span style={tileLabel}>{e('tps')}</span></span>
              <span style={tileLabel}>{e('benchAt', { model: bench.model, time: new Date(bench.at).toLocaleTimeString() })}</span>
            </>
          ) : <span style={tileLabel}>—</span>}
        </div>
        <div style={perfTile}>
          <span style={tileLabel}>{e('recentTitle', { count: sum.count })}</span>
          {sum.count ? (
            <>
              <span style={tileValue}>{sum.avgTotalSec} sn</span>
              <span style={tileLabel}>{e('recentDetail', { first: sum.avgFirstSec ?? '—', wait: sum.avgWaitSec ?? 0 })}</span>
            </>
          ) : <span style={tileLabel}>{e('noRecent')}</span>}
        </div>
        <div style={perfTile}>
          <span style={tileLabel}>{e('memoryTitle')}</span>
          {perf?.memory ? (
            <>
              <span style={{ ...tileValue, color: 'var(--cth-mint, #3aa76d)' }}>{e('memoryOn')}</span>
              <span style={tileLabel}>{e('memoryDetail', { count: perf.memory.agents, gb: perf.memory.totalGb })}</span>
              <span style={tileLabel}>{st?.slotOwner ? e('memoryOwner', { name: nameOf(st.slotOwner) }) : perf.memory.dir}</span>
            </>
          ) : <span style={tileLabel}>{e('memoryOff')}</span>}
        </div>
      </div>
      {benchErr && <div style={{ ...desc, color: 'var(--cth-coral)' }}>{benchErr}</div>}
      {verdict && <div style={{ ...desc, color: verdictColor }}>{e(`verdict.${verdict}`)}</div>}

      {/* ── Kullanım sırası ── */}
      <div style={{ borderTop: '1px solid var(--cth-ink-300)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <div style={sectionTitle}>{e('title')}</div>
          <div style={desc}>{e('desc')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={fieldLabel}>{e('concurrency')}</span>
          <select
            value={n}
            onChange={(ev) => { const v = Number(ev.target.value); setN(v); void window.cth.updateConfig({ localConcurrency: v }); }}
            style={{ ...inputStyle, width: 'auto' }}
          >
            {[1, 2, 3, 4].map((x) => <option key={x} value={x}>{e('agents', { count: x })}</option>)}
          </select>
          <span style={desc}>{n > 1 ? e('ollamaNote', { count: n }) : e('oneNote')}</span>
        </div>
        {st && !st.running && <div style={{ ...desc, color: 'var(--cth-coral)' }}>{e('notRunning')}</div>}
        {ids.length === 0 ? <div style={desc}>{e('emptyList')}</div> : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ids.map((id, i) => {
              const act = st?.active.find((x) => x.agentId === id);
              const wait = st?.waiting.find((x) => x.agentId === id);
              const state = act
                ? { label: e(act.inflight ? 'stateAnswering' : 'stateIn', { t: secs(act.since) }), color: 'var(--cth-mint, #3aa76d)' }
                : wait
                  ? { label: e('stateWaiting', { t: secs(wait.since) }), color: 'var(--cth-amber, #d49a1f)' }
                  : { label: e('stateIdle'), color: 'var(--cth-ink-500)' };
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
                  onDragEnd={() => setDragFrom(null)}
                  style={{ ...queueRow, opacity: dragFrom === i ? 0.5 : 1 }}
                >
                  <span style={{ ...tileLabel, width: 18, textAlign: 'right', fontWeight: 700 }}>{i + 1}.</span>
                  <span aria-hidden style={tileLabel}>⋮⋮</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(id)}</span>
                  <span style={{ ...badge(state.color), fontSize: 10 }}>{state.label}</span>
                  {(() => { const sp = st?.spilled.find((x) => x.agentId === id); return sp ? <span style={{ ...badge('var(--cth-accent, #4a7bd0)'), fontSize: 10 }}>{e('stateSpilled', { engine: sp.engine })}</span> : null; })()}
                  <button type="button" title={e('up')} aria-label={e('up')} disabled={i === 0} onClick={() => move(i, i - 1)} style={arrowBtn}>▲</button>
                  <button type="button" title={e('down')} aria-label={e('down')} disabled={i === ids.length - 1} onClick={() => move(i, i + 1)} style={arrowBtn}>▼</button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Taşma: yerel sıra uzarsa önce ücretsiz, sonra ücretli API; API yoksa yerelden devam. */
function SpillCard({ config, endpoints }: { config: HarnessConfig; endpoints: ByokEndpoint[] }) {
  const { t } = useTranslation();
  const e = (k: string, o?: Record<string, unknown>): string => t(`engines.spill.${k}`, o ?? {});
  const remote = endpoints.filter((x) => !isLocalEndpoint(x) && x.enabled !== false);
  const [sp, setSp] = useState(() => {
    const c = config.localSpill;
    const order = [...(c?.order ?? []), ...remote.map((x) => x.id).filter((id) => !(c?.order ?? []).includes(id))];
    return { enabled: !!c?.enabled, afterSec: c?.afterSec ?? 120, order, free: c?.free ?? [], models: c?.models ?? {} };
  });
  const save = (next: typeof sp): void => { setSp(next); void window.cth.updateConfig({ localSpill: next }); };
  const ids = spillTierOrder(sp.order.filter((id) => remote.some((x) => x.id === id)), sp.free);
  const label = (id: string): string => remote.find((x) => x.id === id)?.label ?? id;
  const moveTo = (from: number, to: number): void => save({ ...sp, order: moveItem(ids, from, to) });
  return (
    <div style={card}>
      <div>
        <div style={sectionTitle}>{e('title')}</div>
        <div style={desc}>{e('desc')}</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cth-ink-900)' }}>
        <input type="checkbox" checked={sp.enabled} onChange={(ev) => save({ ...sp, enabled: ev.target.checked })} />
        {e('enable')}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={fieldLabel}>{e('after')}</span>
        <select value={sp.afterSec} onChange={(ev) => save({ ...sp, afterSec: Number(ev.target.value) })} style={{ ...inputStyle, width: 'auto' }} disabled={!sp.enabled}>
          {[30, 60, 120, 300, 600].map((x) => <option key={x} value={x}>{x < 60 ? `${x} sn` : `${x / 60} dk`}</option>)}
        </select>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li style={{ ...queueRow, cursor: 'default' }}>
          <span style={{ ...tileLabel, width: 18, textAlign: 'right', fontWeight: 700 }}>0.</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--cth-ink-900)' }}>{e('local')}</span>
          <span style={{ ...badge('var(--cth-mint, #3aa76d)'), fontSize: 10 }}>{e('tierLocal')}</span>
        </li>
        {ids.map((id, i) => {
          const free = sp.free.includes(id);
          return (
            <li key={id} style={{ ...queueRow, cursor: 'default', opacity: sp.enabled ? 1 : 0.6 }}>
              <span style={{ ...tileLabel, width: 18, textAlign: 'right', fontWeight: 700 }}>{i + 1}.</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--cth-ink-900)' }}>{label(id)}</span>
              <button
                type="button"
                title={e('toggleTier')}
                onClick={() => save({ ...sp, free: free ? sp.free.filter((x) => x !== id) : [...sp.free, id] })}
                style={{ ...badge(free ? 'var(--cth-accent, #4a7bd0)' : 'var(--cth-coral)'), fontSize: 10, border: 'none', cursor: 'pointer' }}
              >
                {free ? e('tierFree') : e('tierPaid')}
              </button>
              <button type="button" title={e('up')} aria-label={e('up')} disabled={i === 0} onClick={() => moveTo(i, i - 1)} style={arrowBtn}>▲</button>
              <button type="button" title={e('down')} aria-label={e('down')} disabled={i === ids.length - 1} onClick={() => moveTo(i, i + 1)} style={arrowBtn}>▼</button>
            </li>
          );
        })}
      </ol>
      <div style={desc}>{e('rules')}</div>
    </div>
  );
}

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--cth-ink-300)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color }} />
    </div>
  );
}

const perfTile: CSSProperties = {
  flex: '1 1 150px', minWidth: 140, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3,
  background: 'var(--cth-paper-50, var(--cth-paper-100))', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 8
};
const tileLabel: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: '15px' };
const tileValue: CSSProperties = { fontSize: 18, fontWeight: 700, color: 'var(--cth-ink-900)', lineHeight: '22px' };
const queueRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'grab',
  background: 'var(--cth-paper-50, var(--cth-paper-100))', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 6
};
const arrowBtn: CSSProperties = {
  width: 24, height: 22, fontSize: 10, lineHeight: '20px', padding: 0, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--cth-ink-300)', borderRadius: 4, color: 'var(--cth-ink-700)'
};

export function ByokEnginesPanel({ config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  const e = (k: string, o?: Record<string, unknown>): string => t(`engines.${k}`, o ?? {});

  const [endpoints, setEndpoints] = useState<ByokEndpoint[]>(
    () => normalizeEndpoints(config.byokEndpoints ?? DEFAULT_BYOK_ENDPOINTS)
  );
  const [workerDefault, setWorkerDefault] = useState<AgentEnginePin | undefined>(config.workerDefaultEngine);
  const [fo, setFo] = useState<QuotaFailoverConfig>(() => normalizeQuotaFailover(config.quotaFailover));
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [found, setFound] = useState<Record<string, string[]>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addNote, setAddNote] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [pinText, setPinText] = useState(() => formatPins(config.agentEngines));
  const [pinNote, setPinNote] = useState('');
  const [downEngines, setDownEngines] = useState<Array<{ engine: string; reason: string; untilMs: number }>>([]);

  useEffect(() => {
    if (!fo.auto) return;
    let alive = true;
    const load = (): void => {
      void window.cth.engineHealth?.().then((s) => { if (alive) setDownEngines(s ?? []); }).catch(() => { /* noop */ });
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [fo.auto]);

  // Anahtar var/yok bayrakları (yalnız boolean; yerel motor her zaman "var").
  const endpointIds = endpoints.map((x) => x.id).join(',');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      for (const x of endpoints) {
        try { out[x.id] = await window.cth.endpointKeyHas(x.id); } catch { out[x.id] = false; }
      }
      if (alive) setHasKey(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointIds]);

  const saveEndpoints = async (next: ByokEndpoint[]): Promise<void> => {
    setEndpoints(next);
    try { await window.cth.updateConfig({ byokEndpoints: next }); } catch { /* noop */ }
  };
  const patchEndpoint = (id: string, patch: Partial<ByokEndpoint>): void => {
    const next = endpoints.map((x) => (x.id === id ? { ...x, ...patch } : x));
    // Adresi boşaltılan motor normalize'da düşer — ham hali tut, yalnız geçerliyi yaz.
    const valid = normalizeEndpoints(next);
    if (valid.some((x) => x.id === id)) void saveEndpoints(valid);
    else setEndpoints(next);
  };
  const saveWorkerDefault = async (pin: AgentEnginePin | undefined): Promise<void> => {
    setWorkerDefault(pin);
    try { await window.cth.updateConfig({ workerDefaultEngine: pin }); } catch { /* noop */ }
  };
  const saveFo = async (patch: Partial<QuotaFailoverConfig>): Promise<void> => {
    const next = normalizeQuotaFailover({ ...fo, ...patch });
    setFo(next);
    try { await window.cth.updateConfig({ quotaFailover: next }); } catch { /* noop */ }
  };

  const say = (id: string, ok: boolean, text: string): void => setNote((s) => ({ ...s, [id]: { ok, text } }));
  const saveKey = async (id: string): Promise<void> => {
    const key = (draftKey[id] ?? '').trim();
    if (!key) return;
    try {
      const r = await window.cth.endpointKeySet({ id, key });
      if (r.ok) {
        setHasKey((s) => ({ ...s, [id]: true }));
        setDraftKey((s) => ({ ...s, [id]: '' }));
        say(id, true, e('keySaved'));
      } else say(id, false, r.error ?? e('keyFailed'));
    } catch (err) { say(id, false, err instanceof Error ? err.message : String(err)); }
  };
  const clearKey = async (id: string): Promise<void> => {
    try {
      await window.cth.endpointKeyClear(id);
      setHasKey((s) => ({ ...s, [id]: false }));
      say(id, true, e('keyCleared'));
    } catch { /* noop */ }
  };
  const test = async (x: ByokEndpoint): Promise<void> => {
    setTesting(x.id);
    try {
      const r = await window.cth.endpointTest(x.id);
      if (r.ok) {
        const models = r.models ?? [];
        setFound((s) => ({ ...s, [x.id]: models }));
        say(x.id, true, e('testOk', { count: models.length }));
      } else say(x.id, false, e('testFailed', { error: r.error ?? '' }));
    } finally { setTesting(null); }
  };
  const adoptModels = (x: ByokEndpoint): void => {
    const models = [...new Set([...(x.models ?? []), ...(found[x.id] ?? [])])];
    patchEndpoint(x.id, { models, defaultModel: x.defaultModel ?? models[0] });
    setFound((s) => ({ ...s, [x.id]: [] }));
    say(x.id, true, e('modelsAdded', { count: models.length }));
  };
  const removeEndpoint = async (x: ByokEndpoint): Promise<void> => {
    if (!window.confirm(e('removeConfirm', { label: x.label }))) return;
    await clearKey(x.id);
    await saveEndpoints(endpoints.filter((y) => y.id !== x.id));
    if (workerDefault?.endpointId === x.id) await saveWorkerDefault(undefined);
  };

  const missingPresets = ENDPOINT_PRESETS.filter((p) => !endpoints.some((x) => x.id === p.id));
  const addPreset = async (p: ByokEndpoint): Promise<void> => {
    await saveEndpoints(normalizeEndpoints([...endpoints, p]));
    setAddNote(isLocalEndpoint(p) ? e('addedLocal', { label: p.label }) : e('addedNeedsKey', { label: p.label }));
  };
  const addCustom = async (): Promise<void> => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name) { setAddNote(e('needName')); return; }
    if (!/^https?:\/\/\S+$/i.test(url)) { setAddNote(e('needUrl')); return; }
    const id = slugify(name, new Set(endpoints.map((x) => x.id)));
    const next = normalizeEndpoints([...endpoints, { id, label: name, baseUrl: url, enabled: true }]);
    if (!next.some((x) => x.id === id)) { setAddNote(e('needUrl')); return; }
    await saveEndpoints(next);
    setNewName(''); setNewUrl('');
    setAddNote(e('addedCustom', { label: name }));
  };
  const savePins = async (text: string): Promise<void> => {
    const { pins, invalid } = parsePinLines(text, endpoints);
    setPinNote(invalid.length ? t('aiEngines.byok.pinsInvalid', { lines: invalid.join(' · ') }) : t('aiEngines.saved'));
    try { await window.cth.updateConfig({ agentEngines: pins }); } catch { /* noop */ }
  };

  /** Ajanların gerçekten kullanabileceği motorlar: açık + (yerel ya da anahtarlı). */
  const usable = useMemo(
    () => endpoints.filter((x) => x.enabled !== false && (isLocalEndpoint(x) || hasKey[x.id])),
    [endpoints, hasKey]
  );
  const defaultEp = endpoints.find((x) => x.id === workerDefault?.endpointId);
  const modelsOf = (x: ByokEndpoint | undefined): string[] =>
    x ? [...new Set([...(x.defaultModel ? [x.defaultModel] : []), ...(x.models ?? [])])] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={sectionTitle}>{e('title')}</div>
        <div style={desc}>{e('intro')}</div>
      </div>

      {/* 1) Varsayılan işçi motoru */}
      <div style={card}>
        <div>
          <div style={sectionTitle}>{e('workerDefaultTitle')}</div>
          <div style={desc}>{e('workerDefaultDesc')}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Field label={e('engine')}>
            <select
              value={workerDefault?.endpointId ?? ''}
              onChange={(ev) => {
                const ep = endpoints.find((x) => x.id === ev.target.value);
                void saveWorkerDefault(ep ? { endpointId: ep.id, model: modelsOf(ep)[0] } : undefined);
              }}
              style={inputStyle}
            >
              <option value="">{e('workerDefaultNone')}</option>
              {usable.map((x) => (
                <option key={x.id} value={x.id}>{x.label}{isLocalEndpoint(x) ? ` — ${e('localShort')}` : ''}</option>
              ))}
            </select>
          </Field>
          {defaultEp && (
            <Field label={e('model')}>
              <select
                value={workerDefault?.model ?? ''}
                onChange={(ev) => void saveWorkerDefault({ endpointId: defaultEp.id, model: ev.target.value || undefined })}
                style={inputStyle}
              >
                {modelsOf(defaultEp).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          )}
        </div>
        {!workerDefault && <div style={{ ...desc, color: 'var(--cth-coral)' }}>{e('workerDefaultWarn')}</div>}
      </div>

      {/* Yerel model sırası */}
      <LocalQueueCard initial={config.localConcurrency} initialPriority={config.localPriority} />
      <SpillCard config={config} endpoints={endpoints} />

      {/* 2) Motorlar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={sectionTitle}>{e('listTitle', { count: endpoints.length })}</div>
        {endpoints.map((x) => {
          const local = isLocalEndpoint(x);
          const keyOk = local || hasKey[x.id];
          return (
            <div key={x.id} style={{ ...card, opacity: x.enabled === false ? 0.65 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  defaultValue={x.label}
                  aria-label={e('name')}
                  onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== x.label) patchEndpoint(x.id, { label: v }); }}
                  style={{ ...inputStyle, width: 'auto', flex: '1 1 180px', fontWeight: 600 }}
                />
                <span style={badge(local ? 'var(--cth-mint)' : 'var(--cth-peach)')}>{local ? e('badgeLocal') : e('badgeRemote')}</span>
                <span style={badge(keyOk ? 'var(--cth-mint-light)' : 'var(--cth-coral-light)')}>
                  {local ? e('noKeyNeeded') : hasKey[x.id] ? e('keyStored') : e('keyMissing')}
                </span>
                <label style={{ ...fieldLabel, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={x.enabled !== false} onChange={(ev) => patchEndpoint(x.id, { enabled: ev.target.checked })} />
                  {e('enabled')}
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                <Field label={e('address')}>
                  <input
                    defaultValue={x.baseUrl ?? ''}
                    placeholder="https://…/v1"
                    onBlur={(ev) => patchEndpoint(x.id, { baseUrl: ev.target.value.trim() || undefined })}
                    style={inputStyle}
                  />
                </Field>
                <Field label={e('claudeAddress')}>
                  <input
                    defaultValue={x.anthropicBaseUrl ?? ''}
                    placeholder={local ? e('claudeAddressLocal') : e('claudeAddressHint')}
                    onBlur={(ev) => patchEndpoint(x.id, { anthropicBaseUrl: ev.target.value.trim() || undefined })}
                    style={inputStyle}
                  />
                </Field>
                <Field label={e('defaultModel')}>
                  <input
                    list={`engine-models-${x.id}`}
                    defaultValue={x.defaultModel ?? ''}
                    onBlur={(ev) => patchEndpoint(x.id, { defaultModel: ev.target.value.trim() || undefined })}
                    style={inputStyle}
                  />
                  <datalist id={`engine-models-${x.id}`}>
                    {modelsOf(x).map((m) => <option key={m} value={m} />)}
                  </datalist>
                </Field>
                <Field label={e('models')}>
                  <input
                    defaultValue={(x.models ?? []).join(', ')}
                    key={(x.models ?? []).join(',')}
                    placeholder={e('modelsHint')}
                    onBlur={(ev) => patchEndpoint(x.id, { models: splitList(ev.target.value) })}
                    style={inputStyle}
                  />
                </Field>
              </div>
              {!local && (
                <Field label={e('apiKey')}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={hasKey[x.id] ? e('keyStoredPlaceholder') : e('keyPlaceholder', { label: x.label })}
                      value={draftKey[x.id] ?? ''}
                      onChange={(ev) => setDraftKey((s) => ({ ...s, [x.id]: ev.target.value }))}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') void saveKey(x.id); }}
                      style={inputStyle}
                    />
                    <PixelButton variant="secondary" size="sm" onClick={() => saveKey(x.id)}>{e('saveKey')}</PixelButton>
                    {hasKey[x.id] && <PixelButton variant="ghost" size="sm" onClick={() => clearKey(x.id)}>{e('clearKey')}</PixelButton>}
                  </div>
                </Field>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <PixelButton variant="secondary" size="sm" disabled={testing === x.id || !x.baseUrl} onClick={() => test(x)}>
                  {testing === x.id ? e('testing') : e('test')}
                </PixelButton>
                {(found[x.id]?.length ?? 0) > 0 && (
                  <PixelButton variant="secondary" size="sm" onClick={() => adoptModels(x)}>
                    {e('adoptModels', { count: found[x.id].length })}
                  </PixelButton>
                )}
                {note[x.id] && (
                  <span style={{ fontSize: 12, color: note[x.id].ok ? 'var(--cth-ink-700)' : 'var(--cth-coral)' }}>
                    {note[x.id].ok ? '✓ ' : '⚠ '}{note[x.id].text}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <PixelButton variant="ghost" size="sm" onClick={() => removeEndpoint(x)}>{e('remove')}</PixelButton>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3) Motor ekle */}
      <div style={card}>
        <div style={sectionTitle}>{e('addTitle')}</div>
        {missingPresets.length > 0 && (
          <>
            <div style={desc}>{e('addPresetsDesc')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {missingPresets.map((p) => (
                <PixelButton key={p.id} variant="secondary" size="sm" onClick={() => addPreset(p)}>+ {p.label}</PixelButton>
              ))}
            </div>
          </>
        )}
        <div style={desc}>{e('addCustomDesc')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(200px, 2fr) auto', gap: 6, alignItems: 'end' }}>
          <Field label={e('name')}>
            <input value={newName} placeholder={e('namePlaceholder')} onChange={(ev) => setNewName(ev.target.value)} style={inputStyle} />
          </Field>
          <Field label={e('address')}>
            <input value={newUrl} placeholder="https://…/v1" onChange={(ev) => setNewUrl(ev.target.value)} style={inputStyle} />
          </Field>
          <PixelButton variant="primary" size="sm" onClick={addCustom}>{e('add')}</PixelButton>
        </div>
        {addNote && <div style={{ ...desc, color: 'var(--cth-ink-700)' }}>{addNote}</div>}
      </div>

      {/* 4) Gelişmiş */}
      <div style={card}>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          style={{ ...sectionTitle, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >{advanced ? '▾' : '▸'} {e('advancedTitle')}</button>
        {advanced && (
          <>
            <div>
              <div style={sectionTitle}>{t('aiEngines.byok.failoverTitle')}</div>
              <div style={desc}>{t('aiEngines.byok.failoverDesc')}</div>
            </div>
            <label style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={fo.auto} onChange={(ev) => saveFo({ auto: ev.target.checked })} />
              {t('aiEngines.byok.autoEnabled')}
            </label>
            <div style={desc}>{t('aiEngines.byok.autoDesc')}</div>
            {fo.auto && (
              <div style={desc}>
                {downEngines.length === 0
                  ? t('aiEngines.byok.healthAllOk')
                  : downEngines.map((d) => t('aiEngines.byok.healthDown', {
                    engine: d.engine,
                    reason: d.reason,
                    until: new Date(d.untilMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  })).join(' · ')}
              </div>
            )}
            <label style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: 6, opacity: fo.auto ? 0.5 : 1 }}>
              <input type="checkbox" checked={fo.enabled && !fo.auto} disabled={fo.auto} onChange={(ev) => saveFo({ enabled: ev.target.checked })} />
              {t('aiEngines.byok.failoverEnabled')}
            </label>
            <Field label={t('aiEngines.byok.agents')}>
              <input defaultValue={fo.agents.join(', ')} onBlur={(ev) => saveFo({ agents: splitList(ev.target.value) })} style={inputStyle} />
            </Field>
            <Field label={t('aiEngines.byok.exempt')}>
              <input defaultValue={fo.exempt.join(', ')} onBlur={(ev) => saveFo({ exempt: splitList(ev.target.value) })} style={inputStyle} />
            </Field>
            <Field label={t('aiEngines.byok.fallbackOrder')}>
              <input defaultValue={fo.fallbackOrder.join(', ')} onBlur={(ev) => saveFo({ fallbackOrder: splitList(ev.target.value) })} style={inputStyle} />
            </Field>
            <div>
              <div style={sectionTitle}>{e('pinsTitle')}</div>
              <div style={desc}>{e('pinsDesc')}</div>
            </div>
            <textarea
              rows={4}
              value={pinText}
              onChange={(ev) => setPinText(ev.target.value)}
              onBlur={(ev) => savePins(ev.target.value)}
              placeholder="reklam-mvqfkrj3 = ollama-general/emrettc-genel"
              style={{ ...inputStyle, height: 'auto', padding: 8, fontFamily: 'var(--cth-font-mono, monospace)', resize: 'vertical' }}
            />
            {pinNote && <div style={desc}>{pinNote}</div>}
          </>
        )}
      </div>
    </div>
  );
}
