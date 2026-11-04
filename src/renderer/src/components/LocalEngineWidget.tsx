import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { speedVerdict } from '@shared/localPriority';
import { shortTokens } from '@shared/quota';

/**
 * Ofis ekranının sol üst köşesindeki yerel motor özeti: ekran kartı belleği,
 * modeldeki ve sıradaki ajanlar, API'ye taşanlar, ajan belleği ve son hız
 * testi. Ayrıntılar Ayarlar › Motorlar'da; başlığa tıklayınca kutu küçülür.
 */
export function LocalEngineWidget() {
  const { t } = useTranslation();
  const e = (k: string, o?: Record<string, unknown>): string => t(`engines.widget.${k}`, o ?? {});
  const agents = useStore((s) => s.agents);
  const nameOf = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('emrettc.engineWidget') !== 'closed'; } catch { return true; }
  });
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.cth.localGateStatus>> | null>(null);
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof window.cth.localGatePerf>> | null>(null);

  useEffect(() => {
    let alive = true;
    const loadSt = (): void => { void window.cth.localGateStatus().then((s) => { if (alive) setSt(s); }).catch(() => { /* noop */ }); };
    const loadPerf = (): void => { void window.cth.localGatePerf().then((p) => { if (alive) setPerf(p); }).catch(() => { /* noop */ }); };
    loadSt(); loadPerf();
    const a = setInterval(loadSt, 3000);
    const b = setInterval(loadPerf, 6000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);

  const toggle = (): void => {
    setOpen((v) => {
      try { localStorage.setItem('emrettc.engineWidget', v ? 'closed' : 'open'); } catch { /* noop */ }
      return !v;
    });
  };

  const gpu = perf?.perf?.gpu ?? null;
  const engine = perf?.perf?.engine ?? null;
  const model = perf?.perf?.models[0] ?? null;
  const bench = perf?.bench ?? null;
  const pct = gpu ? Math.round((gpu.usedMb / gpu.totalMb) * 100) : 0;
  const dot = !perf ? 'var(--cth-ink-500)' : engine ? 'var(--cth-mint, #3aa76d)' : 'var(--cth-coral)';
  const active = st?.active ?? [];
  const waiting = st?.waiting ?? [];
  const spilled = st?.spilled ?? [];

  return (
    <div style={box}>
      <button type="button" onClick={toggle} style={head} aria-expanded={open} title={open ? e('collapse') : e('expand')}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: dot, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{e('title')}</span>
        {!open && gpu && <span style={{ opacity: 0.8 }}>{pct}%</span>}
        {!open && waiting.length > 0 && <span style={{ opacity: 0.8 }}>· {e('waitingShort', { count: waiting.length })}</span>}
        <span aria-hidden style={{ fontSize: 9, opacity: 0.8 }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 10px 9px' }}>
          {gpu && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={row}><span>{e('gpu')}</span><strong>{(gpu.usedMb / 1024).toFixed(1)} / {(gpu.totalMb / 1024).toFixed(1)} GB</strong></div>
              <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct > 95 ? 'var(--cth-coral)' : 'var(--cth-mint, #3aa76d)' }} />
              </div>
            </div>
          )}
          <div style={row}>
            <span>{e('model')}</span>
            <strong style={ellipsis}>{model ? model.name : engine ? e('notLoaded') : e('down')}</strong>
          </div>
          {bench && (
            <div style={row}>
              <span>{e('speed')}</span>
              <strong style={{ color: speedVerdict(bench.readTps) === 'slow' ? 'var(--cth-coral)' : undefined }}>
                {e('speedValue', { read: Math.round(bench.readTps), write: Math.round(bench.writeTps) })}
              </strong>
            </div>
          )}
          <div style={row}>
            <span>{e('inModel')}</span>
            <strong style={ellipsis}>{active.length ? active.map((a) => nameOf(a.agentId)).join(', ') : e('none')}</strong>
          </div>
          <div style={row}>
            <span>{e('waiting')}</span>
            <strong style={ellipsis}>{waiting.length ? waiting.map((w) => nameOf(w.agentId)).join(', ') : e('none')}</strong>
          </div>
          {spilled.length > 0 && (
            <div style={row}>
              <span>{e('spilled')}</span>
              <strong style={ellipsis}>{spilled.map((s) => `${nameOf(s.agentId)} (${s.engine})`).join(', ')}</strong>
            </div>
          )}
          {perf?.memory && (
            <div style={row}>
              <span>{e('memory')}</span>
              <strong>{e('memoryValue', { count: perf.memory.agents, gb: perf.memory.totalGb })}</strong>
            </div>
          )}
          <QuotaSection />
        </div>
      )}
    </div>
  );
}

/** Krediler ve kotalar: Claude aboneliği çubukları (%60 işçi sınırı işaretli),
 *  motor durumları ve bugünkü kullanım. Kalan kredi sağlayıcıdan okunamadığı
 *  için API motorlarında durum (kullanılabilir / kota / kredi yok) gösterilir. */
function QuotaSection() {
  const { t } = useTranslation();
  const q = (k: string, o?: Record<string, unknown>): string => t(`engines.quota.${k}`, o ?? {});
  const [data, setData] = useState<Awaited<ReturnType<typeof window.cth.quotaStatus>> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => { void window.cth.quotaStatus().then((d) => { if (alive) setData(d); }).catch(() => { /* noop */ }); };
    load();
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!data) return null;
  const until = (ms: number | null): string => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const bar = (label: string, w: { pct: number; resetsAt: number | null } | null): React.ReactNode => {
    if (!w) return null;
    const over = w.pct >= data.workerLimitPct;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={row}><span>{label}</span><strong style={{ color: over ? 'var(--cth-coral)' : undefined }}>%{w.pct}</strong></div>
        <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
          <div style={{ width: `${w.pct}%`, height: '100%', background: over ? 'var(--cth-coral)' : '#C9A7E8' }} />
          <div title={q('limitTip', { pct: data.workerLimitPct })} style={{ position: 'absolute', top: 0, bottom: 0, left: `${data.workerLimitPct}%`, width: 2, background: '#fff' }} />
        </div>
        {w.resetsAt && <span style={{ fontSize: 10, opacity: 0.7 }}>{q('resets', { at: until(w.resetsAt) })}</span>}
      </div>
    );
  };
  const reason = (r: string): string => q(`reason.${r}`) || r;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 7, marginTop: 2 }}>
      <strong style={{ fontSize: 11 }}>{q('title')}</strong>
      {data.claude ? (
        <>
          {bar(q('fiveHour'), data.claude.fiveHour)}
          {bar(q('sevenDay'), data.claude.sevenDay)}
        </>
      ) : <span style={{ fontSize: 10, opacity: 0.75 }}>{q('noClaude')}</span>}
      {data.engines.filter((x) => x.id !== 'claude').map((x) => (
        <div key={x.id} style={row}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0, background: x.down ? 'var(--cth-coral)' : 'var(--cth-mint, #3aa76d)' }} />
            <span style={ellipsis}>{x.label}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>{x.kind === 'free' ? q('free') : q('paid')}</span>
          </span>
          <strong style={{ color: x.down ? 'var(--cth-coral)' : undefined, whiteSpace: 'nowrap' }}>
            {x.down ? `${reason(x.down.reason)} · ${until(x.down.untilMs)}` : q('ok')}
          </strong>
        </div>
      ))}
      {data.today.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, opacity: 0.75 }}>{q('today')}</span>
          {data.today.map((f) => (
            <div key={f.family} style={row} title={f.models.join(', ')}>
              <span>{q(`family.${f.family}`)}</span>
              <strong>{shortTokens(f.tokens)} token{f.usd >= 0.01 ? ` · $${f.usd.toFixed(2)}` : ''}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const box: CSSProperties = {
  position: 'absolute', top: 8, left: 8, zIndex: 3, width: 268, maxHeight: 'calc(100% - 16px)', overflowY: 'auto',
  background: 'rgba(26, 19, 32, 0.78)', color: '#fff', borderRadius: 8,
  fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '15px',
  boxShadow: '0 4px 14px rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)'
};
const head: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px',
  background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 700
};
const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, minWidth: 0, opacity: 0.95 };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, textAlign: 'right' };
