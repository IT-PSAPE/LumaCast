import { useEffect, useState } from 'react';
import { EmptyState, Modal, ReacstButton } from '@lumacast/ui';
import type { AppRelease, SuiteAppDescriptor } from '@lumacast/suite';
import type { CloudDesktopAPI } from '../../shared/desktop-api';
import { versionActionLabel } from '../presentation';

interface VersionsDialogProps {
  open: boolean;
  descriptor: SuiteAppDescriptor | null;
  installedVersion: string | null;
  api: CloudDesktopAPI;
  onClose: () => void;
  onSelectVersion: (version: string) => void;
}

export function VersionsDialog({ open, descriptor, installedVersion, api, onClose, onSelectVersion }: VersionsDialogProps) {
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !descriptor) return undefined;

    let cancelled = false;
    setLoading(true);
    void api.releases(descriptor.id).then((next) => {
      if (cancelled) return;
      setReleases(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, descriptor, api]);

  if (!descriptor) return null;

  return (
    <Modal open={open} onClose={onClose} title={`${descriptor.productName} versions`}>
      {loading ? (
        <p className="paragraph-sm text-tertiary">Loading…</p>
      ) : releases.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Title>No releases available</EmptyState.Title>
        </EmptyState.Root>
      ) : (
        <ul className="flex flex-col gap-1">
          {releases.map((release, index) => {
            const isInstalled = release.version === installedVersion;
            return (
              <li key={release.tag} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-secondary">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="label-sm text-primary">{release.version}</span>
                    {index === 0 ? <span className="label-xs rounded-full bg-brand/15 px-1.5 text-brand">Latest</span> : null}
                    {release.legacy ? <span className="label-xs rounded-full bg-tertiary px-1.5 text-tertiary">Legacy</span> : null}
                    {isInstalled ? <span className="label-xs rounded-full bg-success/15 px-1.5 text-success">Installed</span> : null}
                  </div>
                  <span className="paragraph-xs text-tertiary">
                    {release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : 'Unknown date'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    className="label-xs text-brand hover:underline"
                    onClick={() => {
                      void api.openReleaseNotes(descriptor.id, release.version);
                    }}
                  >
                    Notes
                  </button>
                  <ReacstButton onClick={() => onSelectVersion(release.version)}>
                    {versionActionLabel(release, installedVersion, descriptor.versionScheme)}
                  </ReacstButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
