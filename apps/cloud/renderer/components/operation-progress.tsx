import { ReacstButton } from '@lumacast/ui';
import type { OperationSnapshot } from '../../shared/desktop-api';
import { operationStatusLabel } from '../presentation';

interface OperationProgressProps {
  operation: OperationSnapshot;
  cancellable: boolean;
  onCancel: () => void;
}

export function OperationProgress({ operation, cancellable, onCancel }: OperationProgressProps) {
  const percent = operation.progress.percent;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-tertiary">
        <div
          className={percent === null ? 'h-full w-1/3 animate-pulse rounded-full bg-brand' : 'h-full rounded-full bg-brand transition-all'}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="label-xs text-tertiary">{operationStatusLabel(operation)}</span>
        {cancellable ? (
          <ReacstButton variant="ghost" className="px-2 py-0.5" onClick={onCancel}>
            Cancel
          </ReacstButton>
        ) : null}
      </div>
    </div>
  );
}
