import { EmptyState, Panel, Title } from "@lumacast/ui";
import { suiteApp } from "@lumacast/suite";
import type {
  OperationKind,
  OperationSnapshot,
} from "../../shared/desktop-api";
import { formatRelativeTime, operationStatusLabel } from "../presentation";

const ACTIVE_STATUSES = new Set([
  "queued",
  "downloading",
  "verifying",
  "installing",
  "removing",
]);

const KIND_LABEL: Record<OperationKind, string> = {
  install: "Install",
  update: "Update",
  downgrade: "Downgrade",
  uninstall: "Uninstall",
};

interface ActivityScreenProps {
  operations: OperationSnapshot[];
}

export function ActivityScreen({ operations }: ActivityScreenProps) {
  return (
    <div className="flex flex-col gap-6">
      <Title.h4>Activity</Title.h4>

      {operations.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Title>No activity yet</EmptyState.Title>
        </EmptyState.Root>
      ) : (
        <div className="flex flex-col gap-2">
          {operations.map((operation) => {
            const descriptor = suiteApp(operation.app);
            const isActive = ACTIVE_STATUSES.has(operation.status);
            return (
              <Panel
                key={operation.id}
                variant="raised"
                density="compact"
                className="h-auto"
              >
                <Panel.Header divided={false}>
                  <Panel.HeaderTitle>
                    {descriptor.productName}
                  </Panel.HeaderTitle>
                  <Panel.HeaderActions className="label-xs text-tertiary">
                    {KIND_LABEL[operation.kind]} {operation.version} ·{" "}
                    {formatRelativeTime(
                      operation.finishedAt ?? operation.startedAt,
                      Date.now(),
                    )}
                  </Panel.HeaderActions>
                </Panel.Header>
                <Panel.Body scroll={false} padded className="pt-0">
                  {isActive ? (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-tertiary">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{
                          width: `${operation.progress.percent ?? 30}%`,
                        }}
                      />
                    </div>
                  ) : operation.status === "failed" ? (
                    <p className="paragraph-xs text-error">
                      {operation.error ?? "The operation failed."}
                    </p>
                  ) : (
                    <span className="label-xs text-tertiary">
                      {operationStatusLabel(operation)}
                    </span>
                  )}
                </Panel.Body>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
