import { useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  Download,
  Package,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Banner,
  EmptyState,
  ListRow,
  ReacstButton,
  Sidebar,
  Spinner,
  StatusBar,
  StatusDot,
  WindowChrome,
  type StatusTone,
} from "@lumacast/ui";
import { useSuite } from "./hooks/use-suite";
import { useManagedActionOwner } from "./hooks/use-cloud-actions";
import { AppsScreen } from "./screens/apps-screen";
import { UpdatesScreen } from "./screens/updates-screen";
import { ActivityScreen } from "./screens/activity-screen";
import { SettingsScreen } from "./screens/settings-screen";
import type { SelfUpdateStatus } from "../shared/desktop-api";

type ScreenId = "apps" | "updates" | "activity" | "settings";

const NAV_ITEMS: Array<{
  id: ScreenId;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { id: "apps", label: "Apps", icon: Package },
  { id: "updates", label: "Updates", icon: Download },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function useSystemTheme(): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (matches: boolean) => {
      document.documentElement.dataset.theme = matches ? "dark" : "light";
    };
    apply(media.matches);
    const listener = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
}

interface SelfUpdateEntry {
  label: string;
  tone?: StatusTone;
  busy?: boolean;
  action?: "install" | "retry";
}

const SELF_UPDATE_STATUS: Record<SelfUpdateStatus, SelfUpdateEntry> = {
  unavailable: { label: "Unavailable in this build" },
  idle: { label: "Up to date" },
  checking: { label: "Checking for updates…", busy: true },
  "up-to-date": { label: "Up to date" },
  available: {
    label: "Update available — Install",
    tone: "brand",
    action: "install",
  },
  downloading: { label: "Downloading update…", busy: true },
  ready: { label: "Restart to update", tone: "brand", action: "install" },
  error: {
    label: "Update check failed — Retry",
    tone: "error",
    action: "retry",
  },
};

export function App() {
  useSystemTheme();

  const { overview, operations, loading, operationsLoading, refreshing, operationsError, error, retry, refresh, api } = useSuite();
  const actions = useManagedActionOwner(api, operations);
  const [screen, setScreen] = useState<ScreenId>("apps");

  // The window has no native title bar, so the chrome (the only drag region)
  // renders in every state, including before the first overview arrives.
  const chrome = (
    <WindowChrome>
      <WindowChrome.Start draggable>
        <WindowChrome.Title>LumaCloud</WindowChrome.Title>
      </WindowChrome.Start>
    </WindowChrome>
  );

  if (!overview) {
    return (
      <div className="flex h-screen flex-col bg-primary">
        {chrome}
        <main className="flex min-h-0 flex-1" aria-busy={loading}>
          {loading ? (
            <EmptyState.Root role="status">
              <EmptyState.Icon><Spinner /></EmptyState.Icon>
              <EmptyState.Title>Loading apps…</EmptyState.Title>
            </EmptyState.Root>
          ) : (
            <EmptyState.Root role="alert">
              <EmptyState.Title>Could not load LumaCloud</EmptyState.Title>
              <EmptyState.Description>{error?.message}</EmptyState.Description>
              <EmptyState.Action>
                <ReacstButton onClick={() => void retry()}>Retry</ReacstButton>
              </EmptyState.Action>
            </EmptyState.Root>
          )}
        </main>
      </div>
    );
  }

  const selfUpdateEntry = SELF_UPDATE_STATUS[overview.selfUpdate.status];
  const updateCount =
    overview.apps.filter((state) => state.status === "update-available")
      .length +
    (["available", "downloading", "ready"].includes(overview.selfUpdate.status)
      ? 1
      : 0);

  return (
    <div className="flex h-screen flex-col bg-primary text-primary">
      {chrome}
      <div className="flex min-h-0 flex-1">
        <Sidebar width={200}>
          <Sidebar.Nav>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              // A dot, not a tally: what matters is that updates are waiting,
              // not how many. Pending work is named on the Updates screen itself.
              const pending = id === "updates" && updateCount > 0;
              return (
                <ListRow
                  key={id}
                  as="button"
                  selected={screen === id}
                  onClick={() => setScreen(id)}
                >
                  <ListRow.Leading>
                    <Icon size={16} />
                  </ListRow.Leading>
                  <ListRow.Label>{label}</ListRow.Label>
                  {pending ? <ListRow.Meta><StatusDot tone="brand" label="Updates available" /></ListRow.Meta> : null}
                </ListRow>
              );
            })}
          </Sidebar.Nav>
        </Sidebar>

        <main className="flex-1 overflow-y-auto p-8" aria-busy={refreshing || (screen === "activity" && operationsLoading)}>
          {error ? (
            <Banner
              tone="error"
              className="mb-4"
              action={<ReacstButton variant="ghost" onClick={() => void (error.source === "refresh" ? refresh() : retry())}>Retry</ReacstButton>}
            >
              {error.message}
            </Banner>
          ) : null}
          {screen === "apps" ? (
            <AppsScreen
              overview={overview}
              operations={operations}
              api={api}
              refresh={refresh}
              actions={actions}
            />
          ) : null}
          {screen === "updates" ? (
            <UpdatesScreen overview={overview} api={api} actions={actions} />
          ) : null}
          {screen === "activity" ? (
            operationsLoading && operations.length === 0 ? (
              <EmptyState.Root role="status">
                <EmptyState.Icon><Spinner /></EmptyState.Icon>
                <EmptyState.Title>Loading activity…</EmptyState.Title>
              </EmptyState.Root>
            ) : operationsError && operations.length === 0 ? (
              <EmptyState.Root>
                <EmptyState.Title>Activity unavailable</EmptyState.Title>
              </EmptyState.Root>
            ) : (
              <ActivityScreen operations={operations} />
            )
          ) : null}
          {screen === "settings" ? (
            <SettingsScreen overview={overview} api={api} />
          ) : null}
        </main>
      </div>
      <StatusBar label="LumaCloud status">
        <StatusBar.Start>
          <StatusBar.Item>
            LumaCloud {overview.host.cloudVersion}
          </StatusBar.Item>
        </StatusBar.Start>
        <StatusBar.End>
          <StatusBar.Item
            live
            tone={selfUpdateEntry.tone}
            busy={selfUpdateEntry.busy}
            onClick={
              selfUpdateEntry.action
                ? () => {
                    if (selfUpdateEntry.action === "install")
                      void api.installSelfUpdate();
                    else void api.checkForSelfUpdate();
                  }
                : undefined
            }
          >
            {selfUpdateEntry.label}
          </StatusBar.Item>
        </StatusBar.End>
      </StatusBar>
    </div>
  );
}
