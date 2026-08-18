import { cv } from '@renderer/utils/cv';
import { LoaderCircle } from 'lucide-react';
import type { NdiActiveSenderDiagnostics } from '@lumacast/protocol';
import { useCast, useNdi } from '../../contexts/app-context';

const indicatorStyles = cv({
  base: 'inline-block size-1.5 rounded-full',
  variants: {
    active: {
      true: ['bg-green-500'],
      false: ['bg-red-500'],
    },
  },
});

export function StatusBar() {
  const { isRunningOperation, operationText, statusText } = useCast();
  const { state: { diagnostics } } = useNdi();
  const audienceLive = isSenderLive(diagnostics?.senders.audience ?? null);
  const stageLive = isSenderLive(diagnostics?.senders.stage ?? null);
  const audienceStateLabel = audienceLive ? 'Audience live' : 'Audience idle';
  const stageStateLabel = stageLive ? 'Stage live' : 'Stage idle';
  const displayText = isRunningOperation ? operationText ?? 'Processing...' : statusText;

  return (
    <div
      data-ui-region="status-bar"
      className="border-t border-primary bg-primary/60 px-2 py-1 flex items-center gap-3 text-sm"
    >
      <span className="flex items-center gap-2 text-secondary">
        {isRunningOperation && <LoaderCircle size={14} className="animate-spin text-tertiary" />}
        {displayText}
      </span>

      <div className="ml-auto flex items-center gap-3 text-tertiary">
        <span className="flex items-center gap-1">
          <span className={indicatorStyles({ active: audienceLive })} />
          {audienceStateLabel}
        </span>
        <span className="flex items-center gap-1">
          <span className={indicatorStyles({ active: stageLive })} />
          {stageStateLabel}
        </span>
      </div>
    </div>
  );
}

function isSenderLive(sender: NdiActiveSenderDiagnostics | null): boolean {
  if (!sender) return false;
  if (sender.connectionCount === 0) return false;
  return sender.performance.framesSent > 0;
}
