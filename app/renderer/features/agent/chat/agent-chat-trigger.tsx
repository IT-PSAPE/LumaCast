import { Sparkles } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { useAgentChat } from './agent-chat-context';

// The status-bar entry point for the chat popup (`agent-chat-popup.tsx`).
// Kept as its own file because it is the one part of this feature another
// feature (`workbench/status-bar.tsx`) imports directly.
export function AgentChatTrigger() {
  const { state, actions } = useAgentChat();

  return (
    <ReacstButton variant="ghost" active={state.open} onClick={actions.toggle} className="inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5">
      <Sparkles size={13} />
      <span>Assistant</span>
      {state.hasActiveRun ? <span className="size-1.5 shrink-0 rounded-full bg-brand animate-pulse" aria-hidden="true" /> : null}
    </ReacstButton>
  );
}
