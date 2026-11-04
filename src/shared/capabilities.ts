/**
 * Agent capability tags — short labels for what an agent is good at.
 *
 * They are routing hints, not permissions: the project lead reads them in the
 * LIVE ROSTER to pick the right owner for a task, and the UI shows them on the
 * agent's card. What an agent can actually DO is decided by its engine, tools,
 * skills and MCP servers (see AgentAbilities in the renderer).
 *
 * Tags are stored in Turkish (the working language of this office) and kept to
 * the same limits the hire-manifest importer enforces (src/shared/hire.ts), so a
 * tag set that round-trips through a manifest is never silently truncated.
 */

export const MAX_CAPABILITIES = 12;
export const MAX_CAPABILITY_LENGTH = 40;

/** One-click suggestions in the picker, grouped by field, in display order.
 *  Every preset has a built-in expertise guide (src/shared/expertise.ts). */
export const CAPABILITY_GROUPS: readonly { key: 'software' | 'marketing'; tags: readonly string[] }[] = [
  {
    key: 'software',
    tags: [
      'kod yazma',
      'kod inceleme',
      'test',
      'hata ayıklama',
      'dokümantasyon',
      'araştırma',
      'tasarım',
      'veri analizi',
      'altyapı / DevOps',
      'güvenlik',
      'sürüm yönetimi',
      'planlama',
    ],
  },
  {
    key: 'marketing',
    tags: [
      'reklam yönetimi',
      'sosyal medya',
      'içerik yazarlığı',
      'SEO',
      'e-ticaret',
      'müşteri iletişimi',
    ],
  },
];

/** All presets, flat. */
export const CAPABILITY_PRESETS: readonly string[] = CAPABILITY_GROUPS.flatMap((g) => g.tags);

/** Clean an untrusted capability list: strings only, trimmed, length-capped,
 *  de-duplicated case-insensitively (first spelling wins), at most 12. */
export function normalizeCapabilities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_CAPABILITY_LENGTH).trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('tr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_CAPABILITIES) break;
  }
  return out;
}
