/**
 * Chat view of an agent's Claude Code session: the transcript JSONL turned into
 * chat bubbles (the human's messages, the agent's replies) and small tool
 * chips, so the conversation reads like a messenger instead of a raw TUI.
 *
 * Read-only and incremental: the renderer polls with the byte offset it got
 * last time and receives only what was appended since. The first read starts
 * near the end of a long transcript, so opening the view stays cheap.
 *
 * Pure node (no electron) so it is unit-testable.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
  at?: string;
  /** role 'tool': the tool's name, and its outcome once the result is seen. */
  tool?: string;
  isError?: boolean;
}

export interface ChatChunk {
  entries: ChatEntry[];
  /** Tool results seen in this chunk, by tool_use id (for chips already sent). */
  results: { id: string; isError: boolean }[];
  /** Byte offset to pass next time. */
  offset: number;
  /** True when the read started mid-file (older history was skipped). */
  truncated: boolean;
}

/** How much of a long transcript the first read takes. */
const FIRST_READ_BYTES = 3 * 1024 * 1024;
/** Upper bound per incremental read, so a burst never blocks the main process. */
const MAX_READ_BYTES = 8 * 1024 * 1024;

/** Harness/CLI text typed into the session that is not the human talking. */
const SYSTEM_PREFIXES = [
  'You have new hive inbox message', // inbox-wake nudge (src/shared/hiveNudge.ts)
  'Circuit breaker',
  '<command-name>', '<command-message>', '<local-command-stdout>', '<local-command-stderr>',
  '<system-reminder>', '<task-notification>', 'Caveat: The messages below',
  '[Request interrupted'
];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** One line of what a tool call is doing, for its chip. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const file = str(i.file_path) || str(i.path) || str(i.notebook_path);
  switch (name) {
    case 'Bash': case 'PowerShell':
      return clip(str(i.description) || str(i.command).split('\n')[0]);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return file ? basename(file) : '';
    case 'Grep': case 'Glob':
      return clip(str(i.pattern));
    case 'WebFetch':
      return clip(str(i.url));
    case 'WebSearch':
      return clip(str(i.query));
    case 'Task': case 'Agent':
      return clip(str(i.description));
    case 'TodoWrite':
      return '';
    default:
      return clip(str(i.description) || str(i.query) || str(i.command) || file);
  }
}

/** Display name of a tool: an MCP tool shows as "server: tool". */
export function toolLabel(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  return parts.length >= 3 ? `${parts[1].replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${parts.slice(2).join('__')}` : name;
}

/** Parse complete JSONL lines into chat entries. Unknown or malformed lines
 *  are skipped: the transcript format grows new record types often. */
export function parseTranscriptLines(lines: string[]): { entries: ChatEntry[]; results: { id: string; isError: boolean }[] } {
  const entries: ChatEntry[] = [];
  const results: { id: string; isError: boolean }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (o.isSidechain === true) continue; // sub-agent chatter
    const msg = o.message as { content?: unknown } | undefined;
    const at = str(o.timestamp) || undefined;
    const uuid = str(o.uuid) || `${entries.length}-${at ?? ''}`;
    if (o.type === 'user' && msg) {
      if (typeof msg.content === 'string') {
        const text = msg.content.trim();
        if (!text) continue;
        const system = o.isMeta === true || SYSTEM_PREFIXES.some((p) => text.startsWith(p));
        entries.push({ id: uuid, role: system ? 'system' : 'user', text, at });
      } else if (Array.isArray(msg.content)) {
        let n = 0;
        for (const b of msg.content as Array<Record<string, unknown>>) {
          if (b?.type === 'tool_result') {
            results.push({ id: str(b.tool_use_id), isError: b.is_error === true });
          } else if (b?.type === 'text' && str(b.text).trim() && o.isMeta !== true) {
            const text = str(b.text).trim();
            const system = SYSTEM_PREFIXES.some((p) => text.startsWith(p));
            entries.push({ id: `${uuid}:${n++}`, role: system ? 'system' : 'user', text, at });
          }
        }
      }
    } else if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      let n = 0;
      for (const b of msg.content as Array<Record<string, unknown>>) {
        if (b?.type === 'text' && str(b.text).trim()) {
          entries.push({ id: `${uuid}:${n++}`, role: 'assistant', text: str(b.text).trim(), at });
        } else if (b?.type === 'tool_use') {
          const name = str(b.name);
          entries.push({ id: str(b.id) || `${uuid}:${n++}`, role: 'tool', tool: toolLabel(name), text: toolSummary(name, b.input), at });
        }
      }
    }
  }
  // A result that arrives in the same chunk as its call marks the chip directly.
  const byId = new Map(entries.filter((e) => e.role === 'tool').map((e) => [e.id, e]));
  for (const r of results) {
    const e = byId.get(r.id);
    if (e) e.isError = r.isError;
  }
  return { entries, results };
}

/** Read what was appended to a transcript since `offset` (null = first read). */
export function readChatChunk(path: string, offset: number | null): ChatChunk {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let start = offset ?? Math.max(0, size - FIRST_READ_BYTES);
    if (start > size) start = 0; // file was replaced (new session) → start over
    const truncated = offset === null && start > 0;
    const len = Math.min(size - start, MAX_READ_BYTES);
    if (len <= 0) return { entries: [], results: [], offset: start, truncated };
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    let consumed = len;
    // Only complete lines: keep a trailing partial line for the next read.
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { entries: [], results: [], offset: start, truncated };
    if (lastNl < text.length - 1) {
      consumed = Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
      text = text.slice(0, lastNl + 1);
    }
    let lines = text.split('\n');
    // A first read that starts mid-file begins mid-line: drop that fragment.
    if (truncated) lines = lines.slice(1);
    const { entries, results } = parseTranscriptLines(lines);
    return { entries, results, offset: start + consumed, truncated };
  } catch {
    return { entries: [], results: [], offset: offset ?? 0, truncated: false };
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}
