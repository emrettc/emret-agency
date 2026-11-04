/**
 * HumanDraftTracker — does the human have a half-typed line on this PTY?
 *
 * The renderer already holds its queued deliveries back while the user has a
 * draft on the prompt (terminalAutomation.ts). The main-process inbox-wake
 * watchdog (workerWake.ts → nudgeWorker) types straight into the PTY and never
 * saw that gate, so a user who paused mid-sentence for longer than the 12s idle
 * window got the nudge fused onto their line ("…BANA SORMAN GEREKEN BİRŞEY VAR
 * MIYou have new hive inbox message(s)…") and the agent received garbage.
 *
 * The renderer tags its keystroke writes as human (pty:write's third arg), and
 * this tracker keeps a coarse per-PTY model of them — no screen to read here, so
 * it errs toward "there is a draft" and lets it expire instead.
 *
 * No electron import — unit-testable.
 */

/** A draft nobody typed into for this long is treated as abandoned. Shorter than
 *  the renderer's half hour: the renderer can read the screen to clear a phantom
 *  draft, this tracker cannot, and a stuck hold would starve the watchdog. */
export const HUMAN_DRAFT_STALE_MS = 5 * 60_000;

const BRACKETED_PASTE = /\x1b\[20[01]~/g;

export class HumanDraftTracker {
  /** ptyId → when the human last left text on the prompt. */
  private dirtyAt = new Map<string, number>();

  /** Feed one chunk the human typed (or pasted) into `ptyId`. */
  note(ptyId: string, data: string, now = Date.now()): void {
    const pasted = data.includes('\x1b[200~');
    // Esc / Ctrl-C / Ctrl-U clear the line (or close a picker) — no draft left.
    if (data === '\x1b' || data === '\x03' || data === '\x15') { this.dirtyAt.delete(ptyId); return; }
    // A typed Enter submits the line; a paste's newlines do NOT (the TUI keeps
    // them in the input box until a real Enter).
    if (!pasted && /[\r\n]/.test(data)) { this.dirtyAt.delete(ptyId); return; }
    // Bare escape sequences (arrows, focus reports) are navigation, not text.
    const text = data.replace(BRACKETED_PASTE, '').replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, '');
    if (/[^\x00-\x1f\x7f]/.test(text)) this.dirtyAt.set(ptyId, now);
  }

  /** True while the human has an unsubmitted, recently touched line on `ptyId`. */
  has(ptyId: string, now = Date.now()): boolean {
    const at = this.dirtyAt.get(ptyId);
    if (at === undefined) return false;
    if (now - at >= HUMAN_DRAFT_STALE_MS) { this.dirtyAt.delete(ptyId); return false; }
    return true;
  }

  forget(ptyId: string): void {
    this.dirtyAt.delete(ptyId);
  }
}
