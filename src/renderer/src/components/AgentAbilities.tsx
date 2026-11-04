import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import { providerPreset, isClaudeProvider, type AgentProvider, type HarnessConfig } from '@/store/config';
import { CapabilityChips } from './CapabilityPicker';

export interface AgentAbilitiesProps {
  provider?: AgentProvider;
  model?: string;
  /** The spawn command, when known — decides autonomous vs ask-first per agent. */
  command?: string;
  /** The agent's working folder; project-scoped skills are read from here. */
  cwd?: string;
  capabilities?: string[];
}

type SkillProvider = 'claude' | 'opencode' | 'codex';

/** Which skill directory a provider reads, or null when it has none. */
function skillProviderFor(provider: AgentProvider): SkillProvider | null {
  if (provider === 'codex') return 'codex';
  if (provider === 'opencode') return 'opencode';
  return isClaudeProvider(provider) ? 'claude' : null;
}

/**
 * "What can this agent do?" — a read-only summary of everything that actually
 * shapes an agent's reach: engine + model, permission mode, capability tags,
 * the MCP servers merged into new Claude sessions, the skills its CLI will
 * load, and the integrations the broker hands to workers. Each source is
 * fetched independently and a failed fetch just hides its row.
 */
export function AgentAbilities({ provider = 'claude', model, command, cwd, capabilities }: AgentAbilitiesProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const [skills, setSkills] = useState<string[] | null>(null);
  const [integrations, setIntegrations] = useState<string[] | null>(null);
  const skillProvider = skillProviderFor(provider);

  useEffect(() => {
    let live = true;
    void window.cth.getConfig().then((c) => { if (live) setConfig(c); }).catch(() => {});
    void window.cth.integrationsList()
      .then((list) => { if (live) setIntegrations(list.filter((r) => r.enabled).map((r) => r.label)); })
      .catch(() => { if (live) setIntegrations(null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    if (!skillProvider) { setSkills(null); return; }
    void window.cth.skillsLocal(cwd || undefined)
      .then((list) => { if (live) setSkills(list.filter((s) => s.provider === skillProvider).map((s) => s.name)); })
      .catch(() => { if (live) setSkills(null); });
    return () => { live = false; };
  }, [cwd, skillProvider]);

  const preset = providerPreset(provider);
  const autoFlag = preset.autoFlag;
  const autonomous = command && autoFlag ? command.includes(autoFlag) : !!config?.autoMode;
  const mcp = config && isClaudeProvider(provider)
    ? MCP_CATALOG.filter((m) => config.mcpDefaults?.[m.id]?.enabled).map((m) => m.label)
    : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
      background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
        color: 'var(--cth-ink-700)', textTransform: 'uppercase'
      }}>{t('abilities.title')}</div>

      <Line label={t('abilities.engine')}>
        {preset.label} · {model || t('addAgent.cliDefaultModel')}
      </Line>
      <Line label={t('abilities.mode')}>
        {autonomous ? t('abilities.autonomous') : t('abilities.askFirst')}
      </Line>
      <Line label={t('abilities.tags')}>
        {capabilities && capabilities.length
          ? <CapabilityChips value={capabilities} />
          : <span style={{ color: 'var(--cth-ink-500)' }}>{t('abilities.noTags')}</span>}
      </Line>
      {mcp && (
        <Line label={t('abilities.mcp')}>
          <List items={mcp} empty={t('abilities.none')} />
        </Line>
      )}
      {skills && (
        <Line label={t('abilities.skills')}>
          <List items={skills} empty={t('abilities.none')} max={10} />
        </Line>
      )}
      {integrations && (
        <Line label={t('abilities.integrations')}>
          <List items={integrations} empty={t('abilities.none')} />
        </Line>
      )}
      <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)' }}>
        {t('abilities.note')}
      </span>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 8, fontSize: 12, lineHeight: '17px' }}>
      <span style={{ color: 'var(--cth-ink-500)' }}>{label}</span>
      <div style={{ color: 'var(--cth-ink-900)', minWidth: 0 }}>{children}</div>
    </div>
  );
}

function List({ items, empty, max }: { items: string[]; empty: string; max?: number }) {
  if (!items.length) return <span style={{ color: 'var(--cth-ink-500)' }}>{empty}</span>;
  const shown = typeof max === 'number' ? items.slice(0, max) : items;
  const rest = items.length - shown.length;
  return <span>{shown.join(', ')}{rest > 0 ? ` +${rest}` : ''}</span>;
}
