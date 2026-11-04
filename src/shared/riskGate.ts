/**
 * Risk gate: which tool calls must stop and wait for the human.
 *
 * The hook server (src/main/hooks.ts) answers a matching PreToolUse with
 * `permissionDecision: "ask"`, so Claude Code shows its native approval prompt in
 * the agent's terminal — even in auto mode — and the agent waits until the human
 * answers. Decisions that are not a single command (spending money, contacting
 * outsiders, scope changes) are covered by the prompt rule in hive.ts instead.
 *
 * Deliberately a blunt, readable pattern list: a false "ask" costs one click; a
 * missed destructive command can cost the project. Reasons are Turkish because
 * the human reads them in the approval prompt.
 */

export interface RiskVerdict {
  /** Short Turkish reason shown in the approval prompt. */
  reason: string;
}

interface Rule {
  re: RegExp;
  reason: string;
}

/** Shell commands (Bash / PowerShell tools). Matched case-insensitively. */
const COMMAND_RULES: Rule[] = [
  // Deleting files and folders in bulk
  { re: /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r|--recursive)\b/i, reason: 'klasör ve dosyaları toplu siliyor (rm -r)' },
  { re: /\b(rmdir|rd)\s+\/s\b/i, reason: 'klasörü içindekilerle birlikte siliyor (rmdir /s)' },
  { re: /\bdel\s+(\/[a-z]\s+)*\/s\b/i, reason: 'dosyaları alt klasörlerle birlikte siliyor (del /s)' },
  { re: /\bRemove-Item\b[^|;]*-Recurse/i, reason: 'klasörü içindekilerle birlikte siliyor (Remove-Item -Recurse)' },
  // Git: publishing and throwing work away
  { re: /\bgit\s+push\b/i, reason: 'değişiklikleri uzak depoya gönderiyor (git push)' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'kaydedilmemiş değişiklikleri kalıcı olarak siliyor (git reset --hard)' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: 'izlenmeyen dosyaları siliyor (git clean -f)' },
  { re: /\bgit\s+branch\s+(-D|--delete\s+--force)\b/, reason: 'dalı zorla siliyor (git branch -D)' },
  { re: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, reason: 'çalışma klasöründeki değişiklikleri geri alıyor' },
  { re: /\bgit\s+filter-(branch|repo)\b/i, reason: 'git geçmişini yeniden yazıyor' },
  // Databases
  { re: /\bdrop\s+(database|schema|table)\b/i, reason: 'veritabanı nesnesini siliyor (DROP)' },
  { re: /\btruncate\s+(table\s+)?\w/i, reason: 'tablonun tüm verisini siliyor (TRUNCATE)' },
  { re: /\bdelete\s+from\s+[\w."`[\]]+\s*(;|$|")/i, reason: 'tablodaki tüm satırları siliyor (WHERE olmadan DELETE)' },
  { re: /\b(prisma\s+migrate\s+(deploy|reset)|migrate\s+--force|db:drop|db:reset)\b/i, reason: 'veritabanı şemasını değiştiriyor veya sıfırlıyor' },
  // Publishing and deploying
  { re: /\b(npm|pnpm|yarn)\s+publish\b/i, reason: 'paket yayınlıyor (publish)' },
  { re: /\bdocker\s+push\b/i, reason: 'imaj yayınlıyor (docker push)' },
  { re: /\bkubectl\s+(apply|delete|replace|rollout)\b/i, reason: 'canlı ortamı değiştiriyor (kubectl)' },
  { re: /\bterraform\s+(apply|destroy)\b/i, reason: 'altyapıyı değiştiriyor (terraform)' },
  { re: /\b(vercel\s+(--prod|deploy)|firebase\s+deploy|fly\s+deploy|netlify\s+deploy|heroku\s+[\w:]*deploy|gcloud\s+\w+\s+deploy|az\s+webapp\s+deploy)\b/i, reason: 'yayına alıyor (deploy)' },
  // Running code straight from the internet
  { re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|python|node)\b/i, reason: 'internetten indirilen betiği doğrudan çalıştırıyor' },
  // Machine-level
  { re: /\b(shutdown|reboot|format\s+[a-z]:|diskpart|mkfs)\b/i, reason: 'bilgisayarı veya diski etkiliyor' },
];

/** Files whose contents are secrets or credentials. */
const SECRET_FILE_RE = /(^|[\\/])(\.env(\.[\w-]+)?|id_rsa|id_ed25519|[\w-]*\.pem|[\w-]*\.key|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'run_shell_command', 'exec_command']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** MCP tools (`mcp__<server>__<tool>`) that act on the outside world: ad
 *  accounts, payments, publishing and messaging. Judged by name tokens, since
 *  every server spells its tools differently: a "subject" token says what is
 *  touched, a "verb" token says it is changed. Read-only tools (get, list,
 *  report, insights) carry no verb token and pass. */
const MCP_VERBS = new Set(['create', 'update', 'edit', 'set', 'change', 'pause', 'resume', 'enable', 'disable',
  'activate', 'deactivate', 'delete', 'remove', 'archive', 'publish', 'launch', 'mutate', 'upload', 'duplicate',
  'copy', 'send', 'post', 'schedule', 'submit', 'charge', 'refund', 'apply', 'increase', 'decrease', 'adjust']);
const MCP_SUBJECTS: { tokens: Set<string>; reason: string }[] = [
  {
    tokens: new Set(['ad', 'ads', 'adset', 'adsets', 'adgroup', 'adgroups', 'campaign', 'campaigns', 'budget',
      'budgets', 'bid', 'bids', 'bidding', 'audience', 'audiences', 'creative', 'creatives', 'kampanya', 'reklam']),
    reason: 'reklam hesabında değişiklik yapıyor (kampanya, bütçe, teklif veya reklam) — para harcanabilir'
  },
  {
    tokens: new Set(['payment', 'payments', 'charge', 'refund', 'refunds', 'invoice', 'invoices', 'payout',
      'payouts', 'subscription', 'subscriptions', 'order', 'orders', 'price', 'prices', 'odeme']),
    reason: 'para hareketi, fiyat veya sipariş değişikliği yapıyor'
  },
  {
    tokens: new Set(['email', 'emails', 'mail', 'gmail', 'sms', 'whatsapp', 'tweet', 'posts', 'story', 'reel',
      'newsletter', 'customer', 'customers', 'publish', 'instagram', 'facebook', 'twitter', 'linkedin', 'tiktok',
      'youtube']),
    reason: 'dışarıya içerik yayınlıyor veya birilerine mesaj gönderiyor'
  },
];

function classifyMcp(toolName: string): RiskVerdict | null {
  const parts = toolName.split('__');
  if (parts.length < 3) return null;
  const tokens = parts.slice(1).join('_').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const toolTokens = parts.slice(2).join('_').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!toolTokens.some((t) => MCP_VERBS.has(t))) return null;
  // A draft is not sent: preparing one is exactly what an agent should do
  // before it proposes the real action.
  if (toolTokens.includes('draft') || toolTokens.includes('drafts')) return null;
  for (const subject of MCP_SUBJECTS) {
    if (tokens.some((t) => subject.tokens.has(t))) return { reason: subject.reason };
  }
  return null;
}

/** Is this an MCP tool of an ad-account server (Meta Ads and the like)? Such
 *  tools belong to the agents whose capabilities include ad management. */
export function isAdAccountTool(toolName: string | undefined): boolean {
  if (!toolName || !toolName.startsWith('mcp__')) return false;
  const parts = toolName.split('__');
  if (parts.length < 3) return false;
  const tokens = parts.slice(1).join('_').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => MCP_SUBJECTS[0].tokens.has(t));
}

/** The capability that unlocks ad-account tools. */
export const AD_CAPABILITY = 'reklam yönetimi';

/** Why an agent may not use an ad-account tool, or null when it may. The lead
 *  (god) and agents tagged with ad management may; everyone else is told to
 *  route the work. */
export function adToolRefusal(toolName: string | undefined, capabilities: readonly string[] | undefined, isLead: boolean): string | null {
  if (!isAdAccountTool(toolName) || isLead) return null;
  const has = (capabilities ?? []).some((c) => c.toLocaleLowerCase('tr') === AD_CAPABILITY);
  return has ? null
    : 'Emret Agency: reklam hesabı araçları yalnızca "reklam yönetimi" yeteneği olan ajanlar içindir. '
      + 'Bu işi Proje Liderine veya reklamcı ajana mesajla ilet.';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Returns why this tool call needs the human's approval, or null when it doesn't. */
export function classifyRisk(toolName: string | undefined, toolInput: unknown): RiskVerdict | null {
  if (!toolName) return null;
  if (toolName.startsWith('mcp__')) return classifyMcp(toolName);
  const input = (toolInput && typeof toolInput === 'object') ? toolInput as Record<string, unknown> : {};
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = str(input.command) || str(input.cmd);
    if (!cmd) return null;
    for (const rule of COMMAND_RULES) {
      if (rule.re.test(cmd)) return { reason: rule.reason };
    }
    return null;
  }
  if (WRITE_TOOLS.has(toolName)) {
    const file = str(input.file_path) || str(input.path) || str(input.notebook_path);
    if (file && SECRET_FILE_RE.test(file)) return { reason: 'gizli bilgi içeren bir dosyayı değiştiriyor (.env, anahtar)' };
  }
  return null;
}

/** The approval prompt text: what is risky, and what the human is deciding. */
export function riskPromptText(verdict: RiskVerdict): string {
  return `Emret Agency riskli işlem kapısı: bu işlem ${verdict.reason}. `
    + 'Onaylarsanız ajan devam eder; reddederseniz işlem yapılmaz ve ajan başka bir yol arar.';
}
