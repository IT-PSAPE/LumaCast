import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { RefreshCw } from "lucide-react";
import {
  Banner,
  Checkbox,
  Modal,
  ReacstButton,
  Title,
  Toolbar,
} from "@lumacast/ui";
import {
  useMultiSelection,
  useMultiSelectionKeyHandler,
  type SelectionModifiers,
} from "@lumacast/selection";
import { suiteApp, type SuiteAppId } from "@lumacast/suite";
import type {
  CloudDesktopAPI,
  OperationSnapshot,
  SuiteOverview,
} from "../../shared/desktop-api";
import { AppCard } from "../components/app-card";
import { PermissionDialog } from "../components/permission-dialog";
import { UninstallDialog } from "../components/uninstall-dialog";
import { VersionsDialog } from "../components/versions-dialog";
import { activeOperationFor, formatRelativeTime } from "../presentation";

type BulkActionKind = "install-update" | "uninstall";

interface BulkReview {
  kind: BulkActionKind;
  ids: SuiteAppId[];
  grantIds: SuiteAppId[];
}

function isEligibleForBulkAction(
  kind: BulkActionKind,
  app: SuiteAppId,
  overview: SuiteOverview,
  operations: OperationSnapshot[],
): boolean {
  if (app === "cloud" || activeOperationFor(app, operations)) return false;
  const state = overview.apps.find((entry) => entry.app === app);
  if (!state) return false;
  if (kind === "uninstall") return state.installed !== null;
  return Boolean(
    state.latest &&
    (state.status === "not-installed" || state.status === "update-available"),
  );
}

function isTerminalOperation(operation: OperationSnapshot): boolean {
  return ["done", "failed", "cancelled"].includes(operation.status);
}

async function waitForOperation(
  api: CloudDesktopAPI,
  initial: OperationSnapshot,
): Promise<OperationSnapshot> {
  if (isTerminalOperation(initial)) return initial;

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (operation: OperationSnapshot) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(operation);
    };
    unsubscribe = api.onOperation((operation) => {
      if (operation.id === initial.id && isTerminalOperation(operation)) {
        finish(operation);
      }
    });

    void api.operations().then(
      (operations) => {
        const current = operations.find(
          (operation) => operation.id === initial.id,
        );
        if (current && isTerminalOperation(current)) finish(current);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        reject(error);
      },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface AppsScreenProps {
  overview: SuiteOverview;
  operations: OperationSnapshot[];
  api: CloudDesktopAPI;
  refresh: () => Promise<void>;
}

export function AppsScreen({
  overview,
  operations,
  api,
  refresh,
}: AppsScreenProps) {
  const [pending, setPending] = useState<{
    app: SuiteAppId;
    run: () => void;
  } | null>(null);
  const [versionsApp, setVersionsApp] = useState<SuiteAppId | null>(null);
  const [uninstallApp, setUninstallApp] = useState<SuiteAppId | null>(null);
  const [bulkReview, setBulkReview] = useState<BulkReview | null>(null);
  const [removeBulkUserData, setRemoveBulkUserData] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkRunningRef = useRef(false);
  const orderedAppIds = useMemo(
    () => overview.apps.map((state) => state.app),
    [overview.apps],
  );
  const selection = useMultiSelection(orderedAppIds, "cloud-app-list");
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });
  const selectedAppIds = orderedAppIds.filter((app) =>
    selection.selectedIds.has(app),
  );
  const installUpdateIds = orderedAppIds.filter(
    (app) =>
      selection.selectedIds.has(app) &&
      isEligibleForBulkAction("install-update", app, overview, operations),
  );
  const uninstallIds = orderedAppIds.filter(
    (app) =>
      selection.selectedIds.has(app) &&
      isEligibleForBulkAction("uninstall", app, overview, operations),
  );

  const versionsState = versionsApp
    ? (overview.apps.find((entry) => entry.app === versionsApp) ?? null)
    : null;
  const uninstallState = uninstallApp
    ? (overview.apps.find((entry) => entry.app === uninstallApp) ?? null)
    : null;

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

  function retainSelection(ids: SuiteAppId[]): void {
    selection.clearSelection();
    ids.forEach((app, index) => {
      selection.select(app, index === 0 ? {} : { ctrlKey: true });
    });
  }

  async function runBulkAction(
    kind: BulkActionKind,
    ids: SuiteAppId[],
    approvedGrantIds: SuiteAppId[],
    removeUserData = false,
  ): Promise<void> {
    if (bulkRunningRef.current) return;
    bulkRunningRef.current = true;
    setBulkRunning(true);
    setBulkError(null);
    const approvedGrants = new Set(approvedGrantIds);

    try {
      for (let index = 0; index < ids.length; index += 1) {
        const app = ids[index]!;
        try {
          const [freshOverview, freshOperations] = await Promise.all([
            api.overview(),
            api.operations(),
          ]);
          if (
            !isEligibleForBulkAction(kind, app, freshOverview, freshOperations)
          ) {
            throw new Error(
              "It is busy or is no longer eligible for this action.",
            );
          }

          const granted = freshOverview.settings.grants.some(
            (grant) => grant.app === app,
          );
          if (!granted && !approvedGrants.has(app)) {
            const remaining = ids.slice(index);
            const grantIds = remaining.filter(
              (candidate) =>
                !freshOverview.settings.grants.some(
                  (grant) => grant.app === candidate,
                ),
            );
            retainSelection(remaining);
            setBulkReview({ kind, ids: remaining, grantIds });
            setRemoveBulkUserData(removeUserData);
            return;
          }
          if (!granted) await api.grant(app);

          const queued =
            kind === "install-update"
              ? await api.install(app)
              : await api.uninstall(app, { removeUserData });
          const operation = await waitForOperation(api, queued);
          if (operation.status !== "done") {
            throw new Error(
              operation.error ?? `The operation ${operation.status}.`,
            );
          }
        } catch (error) {
          const remaining = ids.slice(index);
          retainSelection(remaining);
          setBulkError(
            `Stopped at ${suiteApp(app).productName}. ${errorMessage(error)}`,
          );
          return;
        }
      }

      selection.clearSelection();
    } finally {
      bulkRunningRef.current = false;
      setBulkRunning(false);
    }
  }

  function requestBulkAction(kind: BulkActionKind, ids: SuiteAppId[]): void {
    if (bulkRunningRef.current || ids.length === 0) return;
    const grantIds = ids.filter(
      (app) => !overview.settings.grants.some((grant) => grant.app === app),
    );
    setBulkError(null);
    if (kind === "uninstall" || grantIds.length > 0) {
      setRemoveBulkUserData(false);
      setBulkReview({ kind, ids, grantIds });
      return;
    }
    void runBulkAction(kind, ids, []);
  }

  function handleCollectionKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    if (bulkRunning) return;
    handleSelectionKeys(event);
    if (event.defaultPrevented) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest("input, textarea, select, [contenteditable='true']"))
    ) {
      return;
    }
    if (event.key !== "Delete" || selectedAppIds.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    requestBulkAction("uninstall", uninstallIds);
  }

  return (
    <div className="flex flex-col gap-6">
      <Title.h4>Apps</Title.h4>

      <Toolbar label="Catalog" size="sm" className="px-0">
        <Toolbar.Start>
          <span className="label-xs text-tertiary">
            Last checked{" "}
            {formatRelativeTime(overview.catalog.fetchedAt, Date.now())}
          </span>
        </Toolbar.Start>
        <Toolbar.End>
          <ReacstButton
            variant="ghost"
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </ReacstButton>
        </Toolbar.End>
      </Toolbar>

      {selectedAppIds.length > 0 ? (
        <Toolbar label="Selected apps" size="sm" className="px-0">
          <Toolbar.Start>
            <span className="label-xs text-secondary">
              {selectedAppIds.length} selected
            </span>
          </Toolbar.Start>
          <Toolbar.End>
            {installUpdateIds.length > 0 ? (
              <ReacstButton
                variant="tinted"
                disabled={bulkRunning}
                onClick={() =>
                  requestBulkAction("install-update", installUpdateIds)
                }
              >
                Install or Update ({installUpdateIds.length})
              </ReacstButton>
            ) : null}
            {uninstallIds.length > 0 ? (
              <ReacstButton
                variant="danger"
                disabled={bulkRunning}
                onClick={() => requestBulkAction("uninstall", uninstallIds)}
              >
                Uninstall ({uninstallIds.length})
              </ReacstButton>
            ) : null}
            <ReacstButton
              variant="ghost"
              disabled={bulkRunning}
              onClick={selection.clearSelection}
            >
              Clear
            </ReacstButton>
          </Toolbar.End>
        </Toolbar>
      ) : null}

      {bulkError ? (
        <Banner
          tone="error"
          action={
            <ReacstButton variant="ghost" onClick={() => setBulkError(null)}>
              Dismiss
            </ReacstButton>
          }
        >
          {bulkError}
        </Banner>
      ) : null}

      {overview.catalog.status === "error" ? (
        <Banner
          tone="error"
          action={
            <ReacstButton
              variant="danger"
              onClick={() => {
                void refresh();
              }}
            >
              Retry
            </ReacstButton>
          }
        >
          {overview.catalog.error ?? "Could not check for updates."}
        </Banner>
      ) : null}

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        onKeyDown={handleCollectionKeyDown}
      >
        {overview.apps.map((state) => {
          const descriptor = suiteApp(state.app);
          const isSelf = state.app === "cloud";
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
              selected={selection.selectedIds.has(state.app)}
              selectionDisabled={bulkRunning}
              onSelect={(modifiers) => selection.select(state.app, modifiers)}
              onToggleSelect={(modifiers) => {
                const toggleModifiers: SelectionModifiers = modifiers.shiftKey
                  ? modifiers
                  : modifiers.metaKey || modifiers.ctrlKey
                    ? modifiers
                    : { ...modifiers, ctrlKey: true };
                selection.select(state.app, toggleModifiers);
              }}
              onPrimaryAction={(action) => {
                switch (action) {
                  case "install":
                  case "update":
                    runInstall(state.app);
                    break;
                  case "open":
                    requestAction(state.app, () => {
                      void api.open(state.app);
                    });
                    break;
                  case "self-check":
                    void api.checkForSelfUpdate();
                    break;
                  case "self-install":
                  case "self-restart":
                    void api.installSelfUpdate();
                    break;
                  case "none":
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
                const version =
                  state.latest?.version ?? state.installed?.version;
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
          if (app)
            requestAction(app, () => {
              void api.uninstall(app, { removeUserData });
            });
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

      <Modal
        open={bulkReview !== null}
        onClose={() => setBulkReview(null)}
        title={
          bulkReview?.kind === "uninstall"
            ? "Remove selected apps?"
            : "Allow LumaCloud to manage these apps?"
        }
        footer={
          bulkReview ? (
            <>
              <ReacstButton variant="ghost" onClick={() => setBulkReview(null)}>
                Cancel
              </ReacstButton>
              <ReacstButton
                variant={bulkReview.kind === "uninstall" ? "danger" : "tinted"}
                disabled={bulkRunning || bulkReview.ids.length === 0}
                onClick={() => {
                  const review = bulkReview;
                  if (!review) return;
                  setBulkReview(null);
                  void runBulkAction(
                    review.kind,
                    review.ids,
                    review.grantIds,
                    removeBulkUserData,
                  );
                }}
              >
                {bulkReview.grantIds.length > 0
                  ? bulkReview.kind === "uninstall"
                    ? "Allow and Remove"
                    : "Allow and Continue"
                  : "Remove"}
              </ReacstButton>
            </>
          ) : undefined
        }
      >
        {bulkReview ? (
          <div className="min-h-0 overflow-y-auto p-4">
            <p className="paragraph-sm text-secondary">
              {bulkReview.grantIds.length > 0
                ? "LumaCloud needs permission for apps marked below before it can continue. Permission allows installing, updating, downgrading, removing, and opening each app."
                : bulkReview.kind === "uninstall"
                  ? "Review the apps to remove. Their user data is kept unless you choose to delete it."
                  : "Review the apps that will be installed or updated to their latest versions."}
            </p>
            <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {bulkReview.ids.map((app) => {
                const descriptor = suiteApp(app);
                const needsGrant = bulkReview.grantIds.includes(app);
                return (
                  <li
                    key={app}
                    className="rounded-control bg-tertiary px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="label-sm text-primary">
                        {descriptor.productName}
                      </span>
                      <span className="label-xs text-tertiary">
                        {needsGrant
                          ? "Permission required"
                          : "Permission granted"}
                      </span>
                    </div>
                    {needsGrant ? (
                      <p className="mt-1 paragraph-xs text-tertiary">
                        {descriptor.bundleId}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {bulkReview.kind === "uninstall" ? (
              <Checkbox
                className="mt-4"
                label="Also delete user data from these apps"
                checked={removeBulkUserData}
                onCheckedChange={setRemoveBulkUserData}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
