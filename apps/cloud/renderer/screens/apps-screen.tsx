import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ReacstButton, Title } from '@lumacast/ui';
import { suiteApp, type SuiteAppId } from '@lumacast/suite';
import type { CloudDesktopAPI, OperationSnapshot, SuiteOverview } from '../../shared/desktop-api';
import { AppCard } from '../components/app-card';
import { PermissionDialog } from '../components/permission-dialog';
import { UninstallDialog } from '../components/uninstall-dialog';
import { VersionsDialog } from '../components/versions-dialog';
import { activeOperationFor, formatRelativeTime } from '../presentation';

interface AppsScreenProps {
  overview: SuiteOverview;
  operations: OperationSnapshot[];
  api: CloudDesktopAPI;
  refresh: () => Promise<void>;
}

export function AppsScreen({ overview, operations, api, refresh }: AppsScreenProps) {
  const [pending, setPending] = useState<{ app: SuiteAppId; run: () => void } | null>(null);
  const [versionsApp, setVersionsApp] = useState<SuiteAppId | null>(null);
  const [uninstallApp, setUninstallApp] = useState<SuiteAppId | null>(null);

  const versionsState = versionsApp ? (overview.apps.find((entry) => entry.app === versionsApp) ?? null) : null;
  const uninstallState = uninstallApp ? (overview.apps.find((entry) => entry.app === uninstallApp) ?? null) : null;

  function requestAction(app: SuiteAppId, run: () => void): void {
    const granted = overview.settings.grants.some((grant) => grant.app === app);
    if (granted) {
      run();
      return;
    }
    setPending({ app, run });
  }

  function runInstall(app: SuiteAppId, version?: string): void {
    requestAction(app, () => {
      void api.install(app, version);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Title.h4>Apps</Title.h4>

      <div className="flex items-center justify-between gap-4">
        <span className="label-xs text-tertiary">Last checked {formatRelativeTime(overview.catalog.fetchedAt, Date.now())}</span>
        <ReacstButton
          variant="ghost"
          className="flex items-center gap-1.5"
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw size={14} />
          Refresh
        </ReacstButton>
      </div>

      {overview.catalog.status === 'error' ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-error/40 bg-error/10 px-3 py-2">
          <span className="paragraph-sm text-error">{overview.catalog.error ?? 'Could not check for updates.'}</span>
          <ReacstButton
            variant="danger"
            onClick={() => {
              void refresh();
            }}
          >
            Retry
          </ReacstButton>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {overview.apps.map((state) => {
          const descriptor = suiteApp(state.app);
          const isSelf = state.app === 'cloud';
          const activeOperation = activeOperationFor(state.app, operations);

          return (
            <AppCard
              key={state.app}
              descriptor={descriptor}
              state={state}
              isSelf={isSelf}
              selfUpdate={isSelf ? overview.selfUpdate : undefined}
              activeOperation={activeOperation}
              platform={overview.host.platform}
              onPrimaryAction={(action) => {
                switch (action) {
                  case 'install':
                  case 'update':
                    runInstall(state.app);
                    break;
                  case 'open':
                    requestAction(state.app, () => {
                      void api.open(state.app);
                    });
                    break;
                  case 'self-check':
                    void api.checkForSelfUpdate();
                    break;
                  case 'self-install':
                  case 'self-restart':
                    void api.installSelfUpdate();
                    break;
                  case 'none':
                    break;
                }
              }}
              onOpen={() => {
                requestAction(state.app, () => {
                  void api.open(state.app);
                });
              }}
              onReveal={() => {
                void api.reveal(state.app);
              }}
              onOtherVersions={() => setVersionsApp(state.app)}
              onUninstall={() => setUninstallApp(state.app)}
              onReleaseNotes={() => {
                const version = state.latest?.version ?? state.installed?.version;
                if (version) void api.openReleaseNotes(state.app, version);
              }}
              onCancel={() => {
                if (activeOperation) void api.cancel(activeOperation.id);
              }}
            />
          );
        })}
      </div>

      <VersionsDialog
        open={versionsApp !== null}
        descriptor={versionsApp ? suiteApp(versionsApp) : null}
        installedVersion={versionsState?.installed?.version ?? null}
        api={api}
        onClose={() => setVersionsApp(null)}
        onSelectVersion={(version) => {
          if (versionsApp) runInstall(versionsApp, version);
          setVersionsApp(null);
        }}
      />

      <UninstallDialog
        open={uninstallApp !== null}
        descriptor={uninstallApp ? suiteApp(uninstallApp) : null}
        installedVersion={uninstallState?.installed?.version ?? null}
        onClose={() => setUninstallApp(null)}
        onConfirm={(removeUserData) => {
          const app = uninstallApp;
          if (app) requestAction(app, () => { void api.uninstall(app, { removeUserData }); });
          setUninstallApp(null);
        }}
      />

      <PermissionDialog
        open={pending !== null}
        descriptor={pending ? suiteApp(pending.app) : null}
        onAllow={() => {
          if (!pending) return;
          const { app, run } = pending;
          void api.grant(app).then(() => run());
          setPending(null);
        }}
        onNotNow={() => setPending(null)}
      />
    </div>
  );
}
