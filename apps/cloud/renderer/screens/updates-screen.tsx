import { EmptyState, ListRow, ReacstButton, Title, Toolbar } from "@lumacast/ui";
import { suiteApp, type SuiteAppId } from "@lumacast/suite";
import type { CloudDesktopAPI, SuiteOverview } from "../../shared/desktop-api";
import { PermissionDialog } from "../components/permission-dialog";
import { formatRelativeTime } from "../presentation";
import { ActionErrors } from "../components/action-errors";
import type { ManagedActionOwner } from "../hooks/use-cloud-actions";
import { useManagedActions } from "../hooks/use-managed-actions";

const SELF_UPDATE_LISTED_STATUSES = new Set([
  "available",
  "downloading",
  "ready",
]);

interface UpdatesScreenProps {
  overview: SuiteOverview;
  api: CloudDesktopAPI;
  actions: ManagedActionOwner;
}

export function UpdatesScreen({ overview, api, actions }: UpdatesScreenProps) {
  const managed = useManagedActions(api, overview, actions);

  const updatable = overview.apps.filter(
    (state) => state.status === "update-available",
  );
  const cloudListed = SELF_UPDATE_LISTED_STATUSES.has(
    overview.selfUpdate.status,
  );
  const total = updatable.length + (cloudListed ? 1 : 0);

  function updateApp(app: SuiteAppId): void {
    managed.request({ kind: "install", app });
  }

  function updateAll(): void {
    updatable.forEach((state) => managed.request({ kind: "install", app: state.app }, true));
    if (cloudListed && overview.selfUpdate.status === "available")
      void api.installSelfUpdate();
  }

  return (
    <div className="flex flex-col gap-6">
      <Toolbar label="Updates" className="px-0">
        <Toolbar.Start>
          <Title.h4>Updates</Title.h4>
        </Toolbar.Start>
        <Toolbar.End>
          {total > 1 ? (
            <ReacstButton variant="tinted" onClick={updateAll}>
              Update all
            </ReacstButton>
          ) : null}
        </Toolbar.End>
      </Toolbar>
      <ActionErrors failures={managed.failures} onRetry={managed.retry} onDismiss={managed.dismiss} isBusy={(failure) => actions.busyApps.has(failure.action.action.app)} />

      {total === 0 ? (
        <EmptyState.Root>
          <EmptyState.Title>Everything is up to date</EmptyState.Title>
          <EmptyState.Description>
            Last checked{" "}
            {formatRelativeTime(overview.catalog.fetchedAt, Date.now())}
          </EmptyState.Description>
        </EmptyState.Root>
      ) : (
        <div className="flex flex-col gap-2">
          {cloudListed ? (
            <ListRow actions="always">
              <ListRow.Label
                description={`${overview.host.cloudVersion} → ${overview.selfUpdate.availableVersion ?? "—"}`}
              >
                LumaCloud
              </ListRow.Label>
              <ListRow.Actions>
                <ReacstButton
                  variant="tinted"
                  disabled={overview.selfUpdate.status === "downloading"}
                  onClick={() => {
                    void api.installSelfUpdate();
                  }}
                >
                  {overview.selfUpdate.status === "ready"
                    ? "Restart to Update"
                    : "Update"}
                </ReacstButton>
              </ListRow.Actions>
            </ListRow>
          ) : null}

          {updatable.map((state) => {
            const descriptor = suiteApp(state.app);
            return (
              <ListRow key={state.app} actions="always">
                <ListRow.Label
                  description={`${state.installed?.version ?? "—"} → ${state.latest?.version ?? "—"}`}
                >
                  {descriptor.productName}
                </ListRow.Label>
                <ListRow.Actions>
                  <ReacstButton
                    variant="tinted"
                    disabled={!managed.ready || actions.busyApps.has(state.app)}
                    onClick={() => updateApp(state.app)}
                  >
                    Update
                  </ReacstButton>
                </ListRow.Actions>
              </ListRow>
            );
          })}
        </div>
      )}

      <PermissionDialog
        open={managed.pending !== null}
        descriptor={managed.pending ? suiteApp(managed.pending.action.app) : null}
        busy={managed.allowing}
        onAllow={() => {
          if (managed.pending) managed.allow(managed.pending);
        }}
        onNotNow={() => { if (managed.pending) managed.notNow(managed.pending); }}
      />
    </div>
  );
}
