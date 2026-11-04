import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CAPABILITY_GROUPS, CAPABILITY_PRESETS, MAX_CAPABILITIES, normalizeCapabilities } from '@shared/capabilities';

export interface CapabilityPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Capability tag editor: one-click presets plus free-text custom tags. Tags are
 * routing hints for the project lead (see src/shared/capabilities.ts); the
 * same limits as the hire importer apply, enforced by normalizeCapabilities.
 */
export function CapabilityPicker({ value, onChange }: CapabilityPickerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const lower = new Set(value.map((v) => v.toLocaleLowerCase('tr')));
  const has = (tag: string) => lower.has(tag.toLocaleLowerCase('tr'));
  const full = value.length >= MAX_CAPABILITIES;

  const toggle = (tag: string) => {
    onChange(has(tag)
      ? value.filter((v) => v.toLocaleLowerCase('tr') !== tag.toLocaleLowerCase('tr'))
      : normalizeCapabilities([...value, tag]));
  };
  const addDraft = () => {
    const parts = draft.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange(normalizeCapabilities([...value, ...parts]));
    setDraft('');
  };
  const custom = value.filter((v) => !CAPABILITY_PRESETS.some((p) => p.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {CAPABILITY_GROUPS.map((group) => (
      <div key={group.key} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', minWidth: 70 }}>{t(`capabilities.group.${group.key}`)}</span>
        {group.tags.map((tag) => {
          const on = has(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              disabled={!on && full}
              aria-pressed={on}
              style={chip(on, !on && full)}
            >
              {on ? '✓ ' : ''}{tag}
            </button>
          );
        })}
      </div>
      ))}
      {custom.length > 0 && (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', minWidth: 70 }}>{t('capabilities.group.custom')}</span>
        {custom.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            title={t('capabilities.removeTitle')}
            aria-pressed
            style={chip(true, false)}
          >
            ✓ {tag} ✕
          </button>
        ))}
      </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addDraft(); }
          }}
          disabled={full}
          placeholder={full ? t('capabilities.full', { max: MAX_CAPABILITIES }) : t('capabilities.customPlaceholder')}
          style={{
            flex: 1, padding: '5px 8px 3px', background: 'var(--cth-paper-100)', border: 'none',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
            fontSize: 13, color: 'var(--cth-ink-900)', outline: 'none'
          }}
        />
        <button type="button" onClick={addDraft} disabled={full || !draft.trim()} style={chip(false, full || !draft.trim())}>
          {t('common.add')}
        </button>
      </div>
      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', lineHeight: '15px' }}>
        {t('capabilities.hint')}{' '}
        <button
          type="button"
          onClick={() => {
            // A renderer hot-reloaded ahead of its main process has the link but
            // not the handler: say so instead of a silent no-op.
            const open = window.cth.hiveOpenExpertiseGuides;
            if (!open) { window.alert(t('capabilities.guidesRestart')); return; }
            void open(value).then((r) => { if (!r.ok) window.alert(r.error ?? t('capabilities.guidesRestart')); })
              .catch(() => window.alert(t('capabilities.guidesRestart')));
          }}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--cth-ink-900)', textDecoration: 'underline', fontSize: 11 }}
        >
          {t('capabilities.openGuides')}
        </button>
      </span>
    </div>
  );
}

function chip(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '3px 8px 1px',
    background: active ? 'var(--cth-mint-light)' : 'var(--cth-cream-100)',
    boxShadow: active ? 'inset 0 0 0 1.5px var(--cth-ink-500)' : 'inset 0 0 0 1px var(--cth-ink-100)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12,
    color: 'var(--cth-ink-900)', cursor: disabled ? 'default' : 'pointer', border: 'none',
    opacity: disabled ? 0.5 : 1
  };
}

/** Read-only tag row for cards and panels. Renders nothing for an empty list. */
export function CapabilityChips({ value, max }: { value?: string[]; max?: number }) {
  const tags = value ?? [];
  if (!tags.length) return null;
  const shown = typeof max === 'number' ? tags.slice(0, max) : tags;
  const rest = tags.length - shown.length;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {shown.map((tag) => (
        <span key={tag} style={{
          padding: '1px 5px', fontSize: 10, lineHeight: '14px',
          background: 'var(--cth-mint-light)', color: 'var(--cth-ink-900)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }}>{tag}</span>
      ))}
      {rest > 0 && (
        <span style={{ fontSize: 10, lineHeight: '14px', color: 'var(--cth-ink-500)' }}>+{rest}</span>
      )}
    </div>
  );
}
