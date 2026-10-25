import { useState } from "react";
import { EmptyState, ListRow, ReacstButton, Title, Toolbar } from "@lumacast/ui";
import { suiteApp, type SuiteAppId } from "@lumacast/suite";
import type { CloudDesktopAPI, SuiteOverview } from "../../shared/desktop-api";
import { PermissionDialog } from "../components/permission-dialog";
import { formatRelativeTime } from "../presentation";

const SELF_UPDATE_LISTED_STATUSES = new Set([
  "available",
  "downloading",
  "ready",
]);

interface UpdatesScreenProps {
  overview: SuiteOverview;
  api: CloudDesktopAPI;
}

export function UpdatesScreen({ overview, api }: UpdatesScreenProps) {
  const [pending, setPending] = useState<{
    app: SuiteAppId;
    run: () => void;
  } | null>(null);

  const updatable = overview.apps.filter(
    (state) => state.status === "update-available",
  );
  const cloudListed = SELF_UPDATE_LISTED_STATUSES.has(
    overview.selfUpdate.status,
  );
  const total = updatable.length + (cloudListed ? 1 : 0);

  function requestAction(app: SuiteAppId, run: () => void): void {
    const granted = overview.settings.grants.some((grant) => grant.app === app);
    if (granted) {
      run();
      return;
    }
    setPending({ app, run });
  }

  function updateApp(app: SuiteAppId): void {
    requestAction(app, () => {
      void api.install(app);
    });
  }

  function updateAll(): void {
    updatable.forEach((state) => updateApp(state.app));
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
