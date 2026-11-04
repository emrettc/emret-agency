import { useEffect } from 'react';
import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { disposeTerminal } from '@/components/terminalPool';
import { DEFAULT_AUTO_ARCHIVE_HOURS, decideLifecycle, openTaskAssignees } from '@shared/agentLifecycle';
import { reviveArchivedAgent } from './useRestoreTeam';

/**
 * Ajan yaşam döngüsü (shared/agentLifecycle.ts): görevi olmayan ve
 * `autoArchiveIdleHours` (varsayılan 24) saat boşta kalan ajan otomatik
 * arşivlenir; arşivdeki ajana görev panosunda açık bir görev atanınca geri
 * getirilir. Yönetici hiçbir zaman arşivlenmez. App'te bir kez bağlanır.
 *
 * "Boşta" süresi bu çalıştırmada ölçülür: uygulama açıldığında herkesin saati
 * sıfırdan başlar, yani yeniden başlatma kimseyi anında arşive göndermez.
 */

const TICK_MS = 5 * 60_000;
const FIRST_TICK_MS = 60_000;
/** Başlatılamayan bir ajan için yeniden deneme aralığı. */
const REVIVE_RETRY_MS = 30 * 60_000;

/** Ajanın en son meşgul görüldüğü an (ms). */
const lastActiveAt: Record<string, number> = {};
const reviveFailedAt: Record<string, number> = {};

export function useAgentLifecycle(config: HarnessConfig | null): void {
  const enabled = !!config?.onboardingComplete;
  const idleHours = config?.autoArchiveIdleHours ?? DEFAULT_AUTO_ARCHIVE_HOURS;

  useEffect(() => {
    if (!enabled) return;
    const stamp = (): void => {
      const now = Date.now();
      for (const a of useStore.getState().agents) {
        if (!(a.id in lastActiveAt) || (a.status && a.status !== 'idle')) lastActiveAt[a.id] = now;
      }
    };
    stamp();
    const unsub = useStore.subscribe(stamp);

    let running = false;
    const tick = async (): Promise<void> => {
      if (running) return;
      running = true;
      try {
        const ledger = await window.cth.hiveTasks().catch(() => null);
        const st = useStore.getState();
        const now = Date.now();
        const decision = decideLifecycle({
          live: st.agents,
          archived: st.archivedAgents,
          openAssignees: openTaskAssignees(ledger),
          lastActiveAt,
          now,
          idleHours
        });
        for (const id of decision.revive) {
          if (now - (reviveFailedAt[id] ?? 0) < REVIVE_RETRY_MS) continue;
          const r = await reviveArchivedAgent(id, config);
          if (r.ok) {
            lastActiveAt[id] = Date.now();
            delete reviveFailedAt[id];
            console.log(`[yaşam döngüsü] ${id}: görev atandı, arşivden geri getirildi`);
          } else {
            reviveFailedAt[id] = now;
            console.warn(`[yaşam döngüsü] ${id} geri getirilemedi: ${r.error ?? ''}`);
          }
        }
        for (const id of decision.archive) {
          const a = useStore.getState().agents.find((x) => x.id === id);
          if (!a) continue;
          if (a.ptyId) {
            await window.cth.killPty(a.ptyId).catch(() => undefined);
            disposeTerminal(a.ptyId);
          }
          useStore.getState().archiveAgent(id);
          delete lastActiveAt[id];
          console.log(`[yaşam döngüsü] ${id}: ${idleHours} saattir görevsiz ve boşta, arşivlendi`);
        }
      } finally {
        running = false;
      }
    };
    const first = setTimeout(() => { void tick(); }, FIRST_TICK_MS);
    const timer = setInterval(() => { void tick(); }, TICK_MS);
    return () => { unsub(); clearTimeout(first); clearInterval(timer); };
    // config is read at tick time for spawn commands; only these two change behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleHours]);
}
