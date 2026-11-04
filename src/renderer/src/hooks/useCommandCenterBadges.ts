import { useEffect, useState } from 'react';
import { parseTasks, waitsOnHuman } from '@/components/TasksKanban';

/**
 * Komuta Merkezi menüsündeki bildirim sayıları — kullanıcının yanıtını ya da
 * kararını bekleyen işler:
 *  - human: yanıt bekleyen sorular (humanQA) + bekleyen onaylar (Bana Sor sayfası)
 *  - review: incelenmeyi bekleyen dallar (İnceleme sayfası)
 */
export type CommandCenterBadges = Partial<Record<'human' | 'review', number>>;

const POLL_MS = 5000;

export function useCommandCenterBadges(): CommandCenterBadges {
  const [badges, setBadges] = useState<CommandCenterBadges>({});
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const [tasks, approvals, review] = await Promise.all([
        window.cth.hiveTasks().then((r) => parseTasks(r).filter(waitsOnHuman).length).catch(() => 0),
        window.cth.hiveApprovals()
          .then((r) => (Array.isArray(r) ? r.filter((a) => (a as { status?: string })?.status === 'bekliyor').length : 0))
          .catch(() => 0),
        window.cth.reviewList().then((r) => r.filter((i) => i.ahead > 0).length).catch(() => 0)
      ]);
      if (!alive) return;
      const next: CommandCenterBadges = { human: tasks + approvals, review };
      setBadges((prev) => (prev.human === next.human && prev.review === next.review ? prev : next));
    };
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return badges;
}
