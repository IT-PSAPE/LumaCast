import { useAgentActionDispatcher } from './use-agent-action-dispatcher';
import { AgentPermissionDialog } from './agent-permission-dialog';

/**
 * Mount point for the agent action dispatcher. Renders nothing of its own; it
 * exists because the dispatcher is a hook and the permission prompt it queues
 * needs somewhere in the tree to appear. Mounted once, in `App.tsx`, inside
 * every provider the executors reach.
 */
export function AgentActionDispatcher() {
  useAgentActionDispatcher();
  return <AgentPermissionDialog />;
}
