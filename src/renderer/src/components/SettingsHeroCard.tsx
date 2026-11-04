/**
 * The hero card at the top of Settings → General.
 *
 * One card that answers "what is this install" — the product name, the running
 * version, a manual download when the updater knows of a newer release, and the
 * release notes. It used to carry upstream promotion (Pro announcement, Founders'
 * Wall, sponsor, GitHub/Discord links, remote hero.json copy); Emret Agency ships
 * none of that, so the card is fully local and renders the same offline.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import { manualDownloadUrl, pendingVersion, reduceStatus, type UpdateStatus } from '@shared/updateState';

export const PRODUCT_NAME = 'Emret Agency';

export function SettingsHeroCard() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  /** Whatever release the updater knows about, so the card can offer the
   *  manual download right where the version is shown. */
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.().then((cur) => {
      if (cur) setStatus((prev) => reduceStatus(prev, cur));
    }).catch(() => { /* push channel still works */ });
    return off;
  }, []);
  const pending = version ? pendingVersion(status, version) : null;
  const downloadManually = () => {
    if (!status) return;
    const url = manualDownloadUrl(status, window.cth.platform, window.cth.arch);
    if (url) void window.cth.updateOpenRelease(url);
  };

  useEffect(() => {
    let alive = true;
    window.cth.appInfo()
      .then((i) => { if (alive) setVersion(i.version); })
      .catch(() => { /* the card is still useful without it */ });
    return () => { alive = false; };
  }, []);

  /** Re-show the release notes. UpdateToast owns that surface — it holds the
   *  last status and the drop renderer — so this asks rather than duplicating
   *  it, via the same CustomEvent convention App uses for opening Settings. */
  const showReleaseNotes = () => {
    window.dispatchEvent(new CustomEvent('cth:show-release-notes'));
  };

  const INK = 'var(--cth-ink-900)';
  const MONO = 'var(--cth-font-mono, monospace)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: 14,
      background: 'var(--cth-paper-100)',
      border: `2px solid ${INK}`
    }}>
      <span style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 13, lineHeight: '20px', color: INK, fontWeight: 700,
        letterSpacing: '.08em'
      }}>{PRODUCT_NAME}</span>
      {version && (
        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: INK }}>v{version}</span>
      )}
      <span style={{ flex: 1 }} />
      {pending && (
        <>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--cth-ink-700)' }}>
            v{pending} {t('settingsHero.isOut')}
          </span>
          <PixelButton variant="primary" size="sm" onClick={downloadManually}>
            {t('settingsHero.download')} v{pending}
          </PixelButton>
        </>
      )}
      <PixelButton variant="secondary" size="sm" onClick={showReleaseNotes}>
        <span title={t('settingsHero.whatsNewTitle')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="sparkle" /> {t('settingsHero.whatsNew')}
        </span>
      </PixelButton>
    </div>
  );
}
