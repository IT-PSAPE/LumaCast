import { useEffect, useState, type ComponentType } from 'react';
import { Activity, Download, Package, Settings as SettingsIcon } from 'lucide-react';
import { Title } from '@lumacast/ui';
import { useSuite } from './hooks/use-suite';
import { AppsScreen } from './screens/apps-screen';
import { UpdatesScreen } from './screens/updates-screen';
import { ActivityScreen } from './screens/activity-screen';
import { SettingsScreen } from './screens/settings-screen';
import type { CloudDesktopAPI, SelfUpdateState, SelfUpdateStatus } from '../shared/desktop-api';

type ScreenId = 'apps' | 'updates' | 'activity' | 'settings';

const NAV_ITEMS: Array<{ id: ScreenId; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'apps', label: 'Apps', icon: Package },
  { id: 'updates', label: 'Updates', icon: Download },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function useSystemTheme(): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (matches: boolean) => {
      document.documentElement.dataset.theme = matches ? 'dark' : 'light';
    };
    apply(media.matches);
    const listener = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
}

interface SelfUpdateFooterEntry {
  label: string;
  buttonLabel?: string;
  onClick?: 'install' | 'retry';
}

const SELF_UPDATE_FOOTER: Record<SelfUpdateStatus, SelfUpdateFooterEntry> = {
  unavailable: { label: 'Unavailable in this build' },
  idle: { label: 'Up to date' },
  checking: { label: 'Checking for updates…' },
  'up-to-date': { label: 'Up to date' },
  available: { label: 'Update available', buttonLabel: 'Update available — Install', onClick: 'install' },
  downloading: { label: 'Downloading update…' },
  ready: { label: 'Restart to update', buttonLabel: 'Restart to update', onClick: 'install' },
  error: { label: 'Update check failed', buttonLabel: 'Update check failed — Retry', onClick: 'retry' },
};

function SelfUpdateFooter({ selfUpdate, cloudVersion, api }: { selfUpdate: SelfUpdateState; cloudVersion: string; api: CloudDesktopAPI }) {
  const entry = SELF_UPDATE_FOOTER[selfUpdate.status];

  return (
    <div className="flex flex-col gap-1 border-t border-primary pt-3">
      <span className="label-xs text-tertiary">LumaCloud {cloudVersion}</span>
      {entry.onClick ? (
        <button
          type="button"
          className="text-left label-xs text-brand hover:underline"
          onClick={() => {
            if (entry.onClick === 'install') void api.installSelfUpdate();
            else void api.checkForSelfUpdate();
          }}
        >
          {entry.buttonLabel}
        </button>
      ) : (
        <span className="label-xs text-tertiary">{entry.label}</span>
      )}
    </div>
  );
}

export function App() {
  useSystemTheme();

  const { overview, operations, refresh, api } = useSuite();
  const [screen, setScreen] = useState<ScreenId>('apps');

  if (!overview) {
    return <div className="flex h-screen items-center justify-center bg-primary" />;
  }

  return (
    <div className="flex h-screen bg-primary text-primary">
      <aside className="flex w-[200px] shrink-0 flex-col justify-between border-r border-primary bg-secondary p-4">
        <div className="flex flex-col gap-6">
          <Title.h6>LumaCloud</Title.h6>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setScreen(id)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left label-sm transition-colors ${
                  screen === id ? 'bg-tertiary text-primary' : 'text-secondary hover:bg-tertiary hover:text-primary'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <SelfUpdateFooter selfUpdate={overview.selfUpdate} cloudVersion={overview.host.cloudVersion} api={api} />
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {screen === 'apps' ? <AppsScreen overview={overview} operations={operations} api={api} refresh={refresh} /> : null}
        {screen === 'updates' ? <UpdatesScreen overview={overview} api={api} /> : null}
        {screen === 'activity' ? <ActivityScreen operations={operations} /> : null}
        {screen === 'settings' ? <SettingsScreen overview={overview} api={api} /> : null}
      </main>
    </div>
  );
}
