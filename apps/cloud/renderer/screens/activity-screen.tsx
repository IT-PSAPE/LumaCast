import { EmptyState, Title } from '@lumacast/ui';
import { suiteApp } from '@lumacast/suite';
import type { OperationKind, OperationSnapshot } from '../../shared/desktop-api';
import { formatRelativeTime, operationStatusLabel } from '../presentation';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'verifying', 'installing', 'removing']);

const KIND_LABEL: Record<OperationKind, string> = {
  install: 'Install',
  update: 'Update',
  downgrade: 'Downgrade',
  uninstall: 'Uninstall',
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
              <div key={operation.id} className="flex flex-col gap-2 rounded-md border border-primary bg-secondary px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="label-sm text-primary">{descriptor.productName}</span>
                    <span className="label-xs text-tertiary">
                      {KIND_LABEL[operation.kind]} {operation.version}
                    </span>
                  </div>
                  <span className="label-xs text-tertiary">
                    {formatRelativeTime(operation.finishedAt ?? operation.startedAt, Date.now())}
                  </span>
                </div>
                {isActive ? (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-tertiary">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${operation.progress.percent ?? 30}%` }} />
                  </div>
                ) : operation.status === 'failed' ? (
                  <p className="paragraph-xs text-error">{operation.error ?? 'The operation failed.'}</p>
                ) : (
                  <span className="label-xs text-tertiary">{operationStatusLabel(operation)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
