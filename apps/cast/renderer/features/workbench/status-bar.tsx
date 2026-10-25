import { StatusBar as UiStatusBar, StatusDot } from '@lumacast/ui';
import { useNdiLiveState, useStatusBarState } from '../../contexts/app-context';
import { AgentChatTrigger } from '../agent/chat/agent-chat-trigger';

// Tally contract: red = on-air, green = ready. Idle is `success`, not
// `neutral` — a neutral dot is `bg-tertiary`, one step from the bar's own
// `bg-secondary`, which renders it invisible at 6px.
export function StatusBar() {
  const { isRunningOperation, operationText, statusText } = useStatusBarState();
  const { audienceLive, stageLive } = useNdiLiveState();
  const audienceStateLabel = audienceLive ? 'Audience live' : 'Audience idle';
  const stageStateLabel = stageLive ? 'Stage live' : 'Stage idle';
  const displayText = isRunningOperation ? operationText ?? 'Processing...' : statusText;

  return (
    <UiStatusBar data-ui-region="status-bar">
      <UiStatusBar.Start>
        <UiStatusBar.Item busy={isRunningOperation}>{displayText}</UiStatusBar.Item>
      </UiStatusBar.Start>
      <UiStatusBar.End>
        <UiStatusBar.Item icon={<StatusDot tone={audienceLive ? 'error' : 'success'} />}>{audienceStateLabel}</UiStatusBar.Item>
        <UiStatusBar.Item icon={<StatusDot tone={stageLive ? 'error' : 'success'} />}>{stageStateLabel}</UiStatusBar.Item>
        <AgentChatTrigger />
      </UiStatusBar.End>
    </UiStatusBar>
  );
}
