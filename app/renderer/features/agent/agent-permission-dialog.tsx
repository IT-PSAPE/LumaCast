// The consent surface for an agent action the permission matrix marked `ask`,
// and the only place the show-safety interlock becomes visible.
//
// Prompts are driven by a module-level queue rather than component state:
// requests arrive from the dispatcher's async loop, not from a React event, and
// more than one can be outstanding while the user is still reading the first.
// The queue shows them one at a time in arrival order.
import { useCallback, useSyncExternalStore } from 'react';
import type { ActionId, ActionRiskClass } from '@lumacast/commands';
import { describeAgentPrincipal, type AgentPrincipal } from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { cn } from '@renderer/utils/cn';
import { Dialog } from '../../components/overlays/dialog';

export type AgentPermissionAnswer = 'allow-once' | 'always-allow' | 'deny';

export interface AgentPermissionPrompt {
  principal: AgentPrincipal;
  actionId: ActionId;
  /** The action's human title from `ACTION_METADATA`. */
  title: string;
  risk: ActionRiskClass;
  params: unknown;
  /**
   * Set when an output is live and the interlock forced this prompt. The
   * decision is then per-action only — "Always allow" is withheld, because a
   * standing grant is exactly what the interlock exists to prevent.
   */
  interlock: boolean;
}

interface QueueEntry {
  prompt: AgentPermissionPrompt;
  resolve: (answer: AgentPermissionAnswer) => void;
}

let queue: readonly QueueEntry[] = [];
const subscribers = new Set<() => void>();

function publish(next: readonly QueueEntry[]): void {
  queue = next;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

function getQueue(): readonly QueueEntry[] {
  return queue;
}

/** Queues a prompt and resolves with the user's answer once it reaches the front. */
export function requestAgentPermission(prompt: AgentPermissionPrompt): Promise<AgentPermissionAnswer> {
  return new Promise<AgentPermissionAnswer>((resolve) => {
    publish([...queue, { prompt, resolve }]);
  });
}

/**
 * Denies and clears every queued prompt. Used when the dispatcher unmounts, so
 * a pending request is answered rather than left hanging in main.
 */
export function denyAllAgentPermissionPrompts(): void {
  const pending = queue;
  publish([]);
  for (const entry of pending) entry.resolve('deny');
}

const RISK_LABELS: Record<ActionRiskClass, string> = {
  read: 'Read',
  write: 'Write',
  destructive: 'Destructive',
  broadcast: 'Broadcast',
  filesystem: 'Filesystem',
};

function isSevere(risk: ActionRiskClass): boolean {
  return risk === 'destructive' || risk === 'broadcast';
}

const MAX_PARAM_LENGTH = 160;

interface ParamField {
  key: string;
  /** Clipped for the row; the untruncated text stays on the row's `title`. */
  display: string;
  full: string;
}

function paramEntries(params: unknown): ParamField[] {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  return Object.entries(params as Record<string, unknown>).map(([key, value]) => {
    const full = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
    return { key, full, display: full.length > MAX_PARAM_LENGTH ? `${full.slice(0, MAX_PARAM_LENGTH)}…` : full };
  });
}

export function AgentPermissionDialog() {
  const entries = useSyncExternalStore(subscribe, getQueue, getQueue);
  const current = entries[0] ?? null;

  const answer = useCallback((value: AgentPermissionAnswer) => {
    const [head, ...rest] = queue;
    if (!head) return;
    publish(rest);
    head.resolve(value);
  }, []);

  if (!current) return null;

  const { prompt } = current;
  const fields = paramEntries(prompt.params);

  return (
    <Dialog.Root
      open
      closeOnBackdropClick={false}
      onOpenChange={(isOpen) => { if (!isOpen) answer('deny'); }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            data-ui-region="agent-permission-dialog"
            className="max-w-lg"
            onKeyDown={(event) => {
              // A focused button already owns Enter; without this guard the
              // key would answer the focused button *and* allow the next
              // prompt in the queue.
              if (event.key !== 'Enter' || event.defaultPrevented) return;
              if ((event.target as HTMLElement | null)?.closest('button')) return;
              event.preventDefault();
              answer('allow-once');
            }}
          >
            <Dialog.Header>
              <Dialog.Title>{prompt.title}</Dialog.Title>
              <span
                className={cn(
                  'shrink-0 rounded-sm bg-tertiary px-2 py-0.5 label-xs',
                  isSevere(prompt.risk) ? 'text-error' : 'text-secondary',
                )}
              >
                {RISK_LABELS[prompt.risk]}
              </span>
            </Dialog.Header>
            <Dialog.Body className="space-y-3 px-4 py-4">
              <div className="text-sm text-secondary">{describeAgentPrincipal(prompt.principal)}</div>
              {prompt.interlock ? <div className="text-sm text-error">An output is live.</div> : null}
              {fields.length > 0 ? (
                <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
                  {fields.map((field) => (
                    <div key={field.key} className="contents">
                      <dt className="truncate text-tertiary">{field.key}</dt>
                      <dd className="m-0 truncate text-primary" title={field.full}>{field.display}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer className="justify-end gap-2">
              <ReacstButton variant="ghost" onClick={() => answer('deny')}>Deny</ReacstButton>
              {prompt.interlock ? null : (
                <ReacstButton variant="default" onClick={() => answer('always-allow')}>
                  {`Always allow ${prompt.risk}`}
                </ReacstButton>
              )}
              <ReacstButton
                variant={isSevere(prompt.risk) ? 'danger' : 'take'}
                onClick={() => answer('allow-once')}
              >
                Allow once
              </ReacstButton>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
