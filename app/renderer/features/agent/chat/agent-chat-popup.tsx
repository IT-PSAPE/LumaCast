// The floating chat popup (ADR-0038 UI). `AgentChatPopup.Root` is the single
// mounted instance (see `App.tsx`); Header/Transcript/Composer/ThreadList are
// its internal parts, named per ADR-0036's compound-component convention even
// though there is only one call site today. One-use visual parts (message
// rows, the tool-call card, the model picker) stay inline in this file rather
// than becoming their own modules.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Check,
  Ellipsis,
  List,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type {
  AgentConfig,
  AgentCredentialStatus,
  AgentMessage,
  AgentMessagePart,
  AgentModelInfo,
  AgentThreadSummary,
  AgentToolCallStatus,
} from '@lumacast/protocol';
import { ACTION_METADATA, type ActionId, type ActionMetadata } from '@lumacast/commands';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dropdown, useDropdown } from '@renderer/components/form/dropdown';
import { FieldTextarea } from '@renderer/components/form/field';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { EmptyState } from '@renderer/components/display/empty-state';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useOverlayContainer, useOverlayStackEntry } from '@renderer/components/overlays/overlay-primitives';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { cn } from '@renderer/utils/cn';
import { useAgentChat, type AgentChatView, type ToolCallPart } from './agent-chat-context';

const JSON_TRUNCATE_LENGTH = 2048;

function isConfigured(config: AgentConfig | null, credentialStatuses: AgentCredentialStatus[]): boolean {
  if (!config || !config.provider || !config.model) return false;
  return credentialStatuses.some((status) => status.provider === config.provider && status.hasKey);
}

function formatRelativeTime(iso: string): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.round(diffDays / 365)}y ago`;
}

// ─── Root ─────────────────────────────────────────────────
// A bespoke floating overlay rather than an anchored Popover: it must stay
// open while the user works elsewhere in the app (no outside-press dismiss),
// only Escape and the status-bar trigger close it. Still follows the three
// ADR-0033 overlay conventions directly: portal into #overlay-root,
// data-popover-content, and workbench overlay-stack registration.

function Root() {
  const { state, actions } = useAgentChat();
  const container = useOverlayContainer();
  const { isTopmost, zIndex } = useOverlayStackEntry(state.open);

  useEffect(() => {
    if (!state.open) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !isTopmost) return;
      event.preventDefault();
      actions.close();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.open, isTopmost, actions]);

  if (!state.open || !container) return null;

  return createPortal(
    <div
      data-popover-content="true"
      data-shortcuts-scope="ignore"
      style={{ zIndex }}
      className="fixed bottom-11 right-3 flex h-160 max-h-[calc(100vh-4.5rem)] w-105 min-w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-primary bg-primary shadow-2xl"
    >
      <Header />
      {state.view === 'threads' ? (
        <ThreadList />
      ) : (
        <>
          <Transcript />
          <Composer />
        </>
      )}
    </div>,
    container,
  );
}

// ─── Header ───────────────────────────────────────────────

function Header() {
  const { state, actions } = useAgentChat();
  const renameRef = useRef<RenameFieldHandle>(null);
  const activeThread = state.activeThread;
  const showThreadChrome = state.view === 'transcript' && activeThread != null;

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-primary px-2 py-2">
      {showThreadChrome ? (
        <RenameField
          ref={renameRef}
          value={activeThread.title}
          onValueChange={(next) => void actions.renameThread(activeThread.id, next)}
          className="min-w-0 flex-1 px-1 text-sm font-medium text-primary"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-primary">
          {state.view === 'threads' ? 'Threads' : 'Assistant'}
        </span>
      )}
      <ReacstButton.Icon
        label={state.view === 'threads' ? 'Back to conversation' : 'Threads'}
        variant="ghost"
        active={state.view === 'threads'}
        onClick={() => actions.setView(state.view === 'threads' ? ('transcript' satisfies AgentChatView) : ('threads' satisfies AgentChatView))}
      >
        <List />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="New thread" variant="ghost" onClick={() => void actions.createThread()}>
        <Plus />
      </ReacstButton.Icon>
      {showThreadChrome ? (
        <HeaderMenu threadId={activeThread.id} title={activeThread.title} onRequestRename={() => renameRef.current?.startEditing()} />
      ) : null}
      <ReacstButton.Icon label="Close" variant="ghost" onClick={actions.close}>
        <X />
      </ReacstButton.Icon>
    </div>
  );
}

function HeaderMenu({ threadId, title, onRequestRename }: { threadId: Id; title: string; onRequestRename: () => void }) {
  const { actions } = useAgentChat();
  const confirm = useConfirm();

  async function handleDelete() {
    const confirmed = await confirm({ title: `Delete "${title}"?`, confirmLabel: 'Delete', destructive: true });
    if (!confirmed) return;
    await actions.deleteThread(threadId);
  }

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label="Thread options" className="cursor-pointer rounded-sm bg-transparent p-1.5 text-tertiary transition-colors hover:bg-tertiary hover:text-primary [&>svg]:size-4">
        <Ellipsis />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end">
        <Dropdown.Item onClick={onRequestRename}>Rename</Dropdown.Item>
        <Dropdown.Item onClick={() => void handleDelete()}>Delete</Dropdown.Item>
      </Dropdown.Panel>
    </Dropdown>
  );
}

// ─── Thread list ────────────────────────────────────────────

function ThreadList() {
  const { state, actions } = useAgentChat();
  const confirm = useConfirm();

  async function handleDelete(thread: AgentThreadSummary, event: React.MouseEvent) {
    event.stopPropagation();
    const confirmed = await confirm({ title: `Delete "${thread.title}"?`, confirmLabel: 'Delete', destructive: true });
    if (!confirmed) return;
    await actions.deleteThread(thread.id);
  }

  if (state.threads.length === 0) {
    return (
      <EmptyState.Root className="flex-1">
        <EmptyState.Icon><MessageSquare size={24} /></EmptyState.Icon>
        <EmptyState.Title>No conversations yet</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {state.threads.map((thread) => (
        // A `<div role="button">`, not a `<button>`: it hosts the per-row
        // delete button as a real child control, and a button cannot nest
        // another interactive control.
        <div
          key={thread.id}
          role="button"
          tabIndex={0}
          onClick={() => void actions.selectThread(thread.id)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            void actions.selectThread(thread.id);
          }}
          className="flex w-full items-center gap-2 border-b border-secondary/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-tertiary/40 cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-primary">{thread.title}</div>
            <div className="text-xs text-tertiary">{formatRelativeTime(thread.updatedAt)} · {thread.messageCount} messages</div>
          </div>
          <ReacstButton.Icon label="Delete thread" variant="ghost" onClick={(event) => void handleDelete(thread, event)}>
            <Trash2 size={14} />
          </ReacstButton.Icon>
        </div>
      ))}
    </div>
  );
}

// ─── Transcript ─────────────────────────────────────────────

function Transcript() {
  const { state } = useAgentChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const messages = state.activeThread?.messages ?? [];

  // Auto-scroll to bottom on new content unless the user scrolled away —
  // same convention as log-viewer-section.tsx.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (userScrolledRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    userScrolledRef.current = !atBottom;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.modelValidation === 'not-found' ? (
        <div className="mx-3 mt-3 shrink-0 rounded bg-tertiary px-3 py-2 text-xs text-secondary">
          Model {state.activeThread?.model ?? state.config?.model} is no longer available.
        </div>
      ) : null}
      <div ref={containerRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <EmptyState.Root className="flex-1">
            <EmptyState.Icon><Sparkles size={24} /></EmptyState.Icon>
            <EmptyState.Title>Ask the assistant anything</EmptyState.Title>
          </EmptyState.Root>
        ) : (
          messages.map((message) => <MessageRow key={message.id} message={message} />)
        )}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      {message.parts.map((part, index) => (
        <MessagePartView key={index} part={part} isUser={isUser} />
      ))}
    </div>
  );
}

function MessagePartView({ part, isUser }: { part: AgentMessagePart; isUser: boolean }) {
  if (part.type === 'text') {
    if (part.text.length === 0) return null;
    return (
      <div className={cn('max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-lg px-3 py-2 text-sm text-primary', isUser && 'bg-secondary')}>
        {renderFormattedText(part.text)}
      </div>
    );
  }
  if (part.type === 'tool_call') {
    return <ToolCallCard part={part} />;
  }
  return (
    <div className="max-w-[85%] rounded-lg bg-tertiary px-3 py-2 text-sm text-error">{part.message}</div>
  );
}

// Fenced/inline code get monospace treatment; everything else renders as
// plain text. No markdown library — this is the entire supported syntax.
function renderFormattedText(text: string): ReactNode[] {
  const fenceRegex = /```[^\n]*\n?([\s\S]*?)```/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderInlineCode(text.slice(lastIndex, match.index), key));
      key += 1;
    }
    nodes.push(
      <pre key={`fence-${key++}`} className="max-w-full overflow-x-auto rounded bg-tertiary px-2 py-1.5 font-mono text-xs text-primary">
        <code>{match[1].replace(/\n$/, '')}</code>
      </pre>,
    );
    lastIndex = fenceRegex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(...renderInlineCode(text.slice(lastIndex), key));
  return nodes;
}

function renderInlineCode(segment: string, keyBase: number): ReactNode[] {
  return segment
    .split(/(`[^`]+`)/g)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={`${keyBase}-${index}`} className="rounded bg-tertiary px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${keyBase}-${index}`}>{part}</span>;
    });
}

const TOOL_CALL_STATUS_LABEL: Record<AgentToolCallStatus, string> = {
  pending: 'Pending',
  awaiting_permission: 'Awaiting permission',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

const TOOL_CALL_STATUS_CLASS: Record<AgentToolCallStatus, string> = {
  pending: 'text-warning bg-warning/10',
  awaiting_permission: 'text-warning bg-warning/10',
  running: 'text-warning bg-warning/10',
  succeeded: 'text-success bg-success/10',
  failed: 'text-error bg-error/10',
  denied: 'text-error bg-error/10',
  cancelled: 'text-error bg-error/10',
};

function ToolCallCard({ part }: { part: ToolCallPart }) {
  const [expanded, setExpanded] = useState(false);
  const metadata = ACTION_METADATA[part.actionId as ActionId] as ActionMetadata | undefined;
  const title = metadata?.title ?? part.actionId;

  return (
    <div className="w-full max-w-[85%] rounded-lg border border-secondary bg-tertiary/40 text-sm">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer">
        {expanded ? <ChevronDown size={14} className="shrink-0 text-tertiary" /> : <ChevronRight size={14} className="shrink-0 text-tertiary" />}
        <span className="min-w-0 flex-1 truncate text-primary">{title}</span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TOOL_CALL_STATUS_CLASS[part.status])}>
          {TOOL_CALL_STATUS_LABEL[part.status]}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-2 border-t border-secondary px-3 py-2">
          <JsonBlock label="Arguments" value={part.arguments} />
          {part.result !== null ? <JsonBlock label="Result" value={part.result} /> : null}
          {part.error ? <p className="text-xs text-error">{part.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [showAll, setShowAll] = useState(false);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? 'null';
    } catch {
      return String(value);
    }
  }, [value]);
  const truncated = !showAll && pretty.length > JSON_TRUNCATE_LENGTH;
  const displayed = truncated ? pretty.slice(0, JSON_TRUNCATE_LENGTH) : pretty;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary">{label}</span>
      <pre className="max-h-48 overflow-auto rounded bg-primary/60 px-2 py-1.5 font-mono text-[11px] text-secondary">
        {displayed}
        {truncated ? '…' : ''}
      </pre>
      {truncated ? (
        <button type="button" onClick={() => setShowAll(true)} className="self-start text-[11px] text-brand hover:underline cursor-pointer">
          Show all
        </button>
      ) : null}
    </div>
  );
}

// ─── Composer ───────────────────────────────────────────────

function autoGrowTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  const style = window.getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const maxHeight = lineHeight * 6 + paddingTop + paddingBottom;
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function Composer() {
  const { state, actions, isRunning } = useAgentChat();
  const { actions: workbenchActions } = useWorkbench();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadId = state.activeThread?.id ?? null;
  const running = threadId ? isRunning(threadId) : false;

  useEffect(() => {
    autoGrowTextarea(textareaRef.current);
  }, [text]);

  if (!isConfigured(state.config, state.credentialStatuses)) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-primary px-3 py-2 text-sm text-secondary">
        <span>Assistant isn&rsquo;t configured.</span>
        <ReacstButton
          variant="default"
          onClick={() => {
            actions.close();
            workbenchActions.setWorkbenchMode('settings');
          }}
        >
          Open settings
        </ReacstButton>
      </div>
    );
  }

  function commitSend() {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setText('');
    void actions.send(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitSend();
      return;
    }
    if (event.key === 'Escape' && running) {
      // Stop generation without also letting the same keypress close the
      // popup (Root's Escape handler is a separate `window` listener).
      event.preventDefault();
      event.stopPropagation();
      void actions.stop();
    }
  }

  function handleSendOrStop() {
    if (running) {
      void actions.stop();
      return;
    }
    commitSend();
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-primary px-3 py-2">
      <div className="flex items-end gap-2">
        <FieldTextarea
          value={text}
          onChange={setText}
          onKeyDown={handleKeyDown}
          placeholder="Message the assistant"
          resize="none"
          rows={1}
          className="max-h-36 min-h-8 flex-1 py-1.5 text-sm"
          textareaRef={textareaRef}
        />
        <ReacstButton.Icon
          label={running ? 'Stop' : 'Send'}
          variant={running ? 'danger' : 'take'}
          onClick={handleSendOrStop}
          disabled={!running && text.trim().length === 0}
        >
          {running ? <Square /> : <Send />}
        </ReacstButton.Icon>
      </div>
      <ModelPicker />
    </div>
  );
}

function ModelPickerFocusOnInvalid({ invalid }: { invalid: boolean }) {
  const { triggerRef } = useDropdown();
  useEffect(() => {
    if (invalid) triggerRef.current?.focus();
  }, [invalid, triggerRef]);
  return null;
}

function ModelPicker() {
  const { state, actions } = useAgentChat();
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const thread = state.activeThread;
  const provider = thread?.provider ?? state.config?.provider ?? null;
  const model = thread?.model ?? state.config?.model ?? null;
  const isOverride = thread ? thread.provider != null || thread.model != null : false;
  const baseUrl = state.config?.baseUrl ?? null;

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingModels(true);
    window.castApi.agentListModels({ provider, baseUrl })
      .then((list) => { if (!cancelled) setModels(list); })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [provider, baseUrl]);

  if (!provider) return null;

  // Mirrors the "Default" menu item's own label: the trigger names the
  // per-thread override when one is set, and reads literally "Default"
  // (not the resolved model id) otherwise.
  const label = isOverride && model ? model : 'Default';

  // No thread yet (nothing to attach a per-thread override to): show the
  // effective default as plain, non-interactive text.
  if (!thread) {
    return <span className="self-start px-2 py-1 text-xs text-tertiary">Default</span>;
  }

  return (
    <Dropdown className="self-start">
      <ModelPickerFocusOnInvalid invalid={state.modelValidation === 'not-found'} />
      <Dropdown.Trigger aria-label="Model" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-secondary hover:bg-tertiary cursor-pointer">
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 text-tertiary" />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="top-start" className="max-h-64 min-w-48">
        <Dropdown.Item onClick={() => void actions.setThreadModel(thread.id, null, null)}>
          <span className="flex-1">Default</span>
          {!isOverride ? <Check size={14} /> : null}
        </Dropdown.Item>
        <Dropdown.Separator />
        {loadingModels ? <div className="px-2 py-1.5 text-xs text-tertiary">Loading…</div> : null}
        {models.map((entry) => (
          <Dropdown.Item key={entry.id} onClick={() => void actions.setThreadModel(thread.id, provider, entry.id)}>
            <span className="flex-1 truncate">{entry.label}</span>
            {isOverride && model === entry.id ? <Check size={14} /> : null}
          </Dropdown.Item>
        ))}
      </Dropdown.Panel>
    </Dropdown>
  );
}

// ─── Public export ────────────────────────────────────────

export const AgentChatPopup = { Root, Header, Transcript, Composer, ThreadList };
