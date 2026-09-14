// The floating chat popup (ADR-0038 UI). `AgentChatPopup.Root` is the single
// mounted instance (see `App.tsx`); Header/Transcript/Composer/ThreadList are
// its internal parts, named per ADR-0036's compound-component convention even
// though there is only one call site today. One-use visual parts (message
// rows, the tool-call card, the model picker) stay inline in this file rather
// than becoming their own modules.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Ellipsis,
  List,
  LoaderCircle,
  MessageSquare,
  Minus,
  Plus,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
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
import { prettifyModelId } from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dropdown, useDropdown } from '@renderer/components/form/dropdown';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { EmptyState } from '@renderer/components/display/empty-state';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useOverlayContainer, useOverlayStackEntry } from '@renderer/components/overlays/overlay-primitives';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { ModelVendorLogo } from '@renderer/features/agent/model-vendor-logo';
import { cn } from '@renderer/utils/cn';
import { useAgentChat, type AgentChatView } from './agent-chat-context';
import { isToolCallSettled, summarizeToolCall, toolCallLabel, type ToolCallPart } from './tool-call-summary';

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
      className="pointer-events-auto fixed bottom-11 right-3 flex h-160 max-h-[calc(100vh-4.5rem)] w-105 min-w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-primary bg-primary shadow-2xl"
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
  const { state, isRunning } = useAgentChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const messages = state.activeThread?.messages ?? [];
  const activeThreadId = state.activeThread?.id ?? null;
  const isActiveRun = activeThreadId != null && isRunning(activeThreadId);

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
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              isActiveRun={isActiveRun && message.id === state.activeRunMessageId}
            />
          ))
        )}
      </div>
    </div>
  );
}

// A message's parts render as segments, not one row per part: a run of
// consecutive `tool_call` parts becomes a single collapsible ActivityGroup
// (Linear-style step narration) instead of one card per call.
type MessageSegment =
  | { kind: 'text'; part: Extract<AgentMessagePart, { type: 'text' }> }
  | { kind: 'error'; part: Extract<AgentMessagePart, { type: 'error' }> }
  | { kind: 'tool_calls'; parts: ToolCallPart[] };

function groupMessageParts(parts: AgentMessagePart[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  for (const part of parts) {
    if (part.type === 'tool_call') {
      const last = segments[segments.length - 1];
      if (last && last.kind === 'tool_calls') {
        last.parts.push(part);
      } else {
        segments.push({ kind: 'tool_calls', parts: [part] });
      }
    } else if (part.type === 'text') {
      segments.push({ kind: 'text', part });
    } else {
      segments.push({ kind: 'error', part });
    }
  }
  return segments;
}

function MessageRow({ message, isActiveRun }: { message: AgentMessage; isActiveRun: boolean }) {
  const isUser = message.role === 'user';
  const segments = groupMessageParts(message.parts);
  const lastPart = message.parts[message.parts.length - 1] as AgentMessagePart | undefined;
  // The ticker narrates only what the transcript can't already say for
  // itself: an in-progress ActivityGroup already shows "Listing…" in its own
  // header, and a non-empty text part gets its own caret instead (below).
  const showCaret = isActiveRun && !isUser && lastPart?.type === 'text' && lastPart.text.length > 0;
  const showTicker =
    isActiveRun &&
    !isUser &&
    (lastPart === undefined ||
      (lastPart.type === 'tool_call' && isToolCallSettled(lastPart.status)) ||
      (lastPart.type === 'text' && lastPart.text.length === 0));

  return (
    <div className={cn('flex flex-col gap-1.5 animate-chat-enter motion-reduce:animate-none', isUser ? 'items-end' : 'items-start')}>
      {segments.map((segment, index) => {
        const isLastSegment = index === segments.length - 1;
        if (segment.kind === 'text') {
          if (segment.part.text.length === 0) return null;
          if (isUser) {
            return (
              <div key={index} className="max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-sm">
                {segment.part.text}
              </div>
            );
          }
          // The caret is an `::after` on the last rendered block rather than a
          // sibling element, so it sits at the end of the streaming line instead
          // of dropping below the paragraph react-markdown emits.
          return (
            <div
              key={index}
              className={cn(
                'w-full text-sm text-primary leading-relaxed',
                isLastSegment && showCaret &&
                  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:text-brand [&>*:last-child]:after:content-['▍'] [&>*:last-child]:after:animate-chat-caret motion-reduce:[&>*:last-child]:after:animate-none",
              )}
            >
              <Markdown text={segment.part.text} />
            </div>
          );
        }
        if (segment.kind === 'error') {
          return (
            <div key={index} className="max-w-[85%] rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {segment.part.message}
            </div>
          );
        }
        return <ActivityGroup key={index} parts={segment.parts} />;
      })}
      {showTicker ? <ThinkingTicker /> : null}
    </div>
  );
}

// react-markdown escapes raw HTML by default (no rehype-raw) — that stays
// off deliberately, so an assistant reply can never inject markup.
const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-base font-medium text-primary first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1 text-base font-medium text-primary first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-medium text-primary first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-medium text-primary first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-medium text-primary first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 mb-1 text-sm font-medium text-primary first:mt-0">{children}</h6>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-secondary pl-3 text-secondary">{children}</blockquote>,
  hr: () => <hr className="my-2 border-secondary" />,
  // No IPC for opening external URLs and navigation is locked down (ADR-0007)
  // — render link text only, never a real, clickable `href`.
  a: ({ children, href }) => (
    <span className="text-brand underline decoration-brand/60" title={href}>
      {children}
    </span>
  ),
  // Rendered directly from the hast node rather than through `children`
  // (which would recurse through the `code` component below and pick up its
  // inline pill styling) so a fenced block always gets plain block styling.
  pre: ({ node }) => (
    <pre className="my-1.5 max-w-full overflow-x-auto rounded bg-tertiary px-2 py-1.5 font-mono text-xs text-primary">
      <code>{extractHastText(node)}</code>
    </pre>
  ),
  code: ({ className, children }) => (
    <code className={cn('rounded bg-tertiary px-1 py-0.5 font-mono text-[0.85em]', className)}>{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-1.5 max-w-full overflow-x-auto">
      <table className="text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-secondary px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-secondary px-2 py-1 text-left">{children}</td>,
  // GFM task-list checkboxes render, but read-only — this is a transcript of
  // what happened, not an editable list.
  input: ({ type, checked }) => (type === 'checkbox' ? <input type="checkbox" checked={checked} disabled className="mr-1 align-middle" /> : null),
};

// Duck-typed against hast's Element/Text shape rather than importing `hast`
// directly: react-markdown re-exports its node types, but pulling in a
// transitive dependency's package just for this one recursive walk isn't
// worth the coupling.
function extractHastText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const candidate = node as { type?: string; value?: unknown; children?: unknown[] };
  if (candidate.type === 'text') return typeof candidate.value === 'string' ? candidate.value : '';
  if (Array.isArray(candidate.children)) return candidate.children.map(extractHastText).join('');
  return '';
}

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
}

// The live status ticker: while the active run's message has nothing new to
// narrate yet (no parts, or its last tool call already settled, or a text
// part is still empty), this is the only sign the model is working.
function ThinkingTicker() {
  return (
    <div className="animate-chat-enter motion-reduce:animate-none text-xs">
      <span className="animate-chat-shimmer bg-size-[200%_100%] bg-clip-text text-transparent bg-[linear-gradient(90deg,var(--text-color-tertiary),var(--text-color-primary),var(--text-color-tertiary))]">
        Thinking…
      </span>
    </div>
  );
}

function formatStepDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 1) return '<1s';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function summarizeActivityGroup(parts: ToolCallPart[]): string {
  const stepCount = `${parts.length} step${parts.length === 1 ? '' : 's'}`;
  const startedAt = parts.map((part) => part.startedAt).filter((value): value is string => value != null);
  const finishedAt = parts.map((part) => part.finishedAt).filter((value): value is string => value != null);
  if (startedAt.length === 0 || finishedAt.length === 0) return stepCount;
  const earliestStart = Math.min(...startedAt.map((value) => new Date(value).getTime()));
  const latestFinish = Math.max(...finishedAt.map((value) => new Date(value).getTime()));
  return `Worked for ${formatStepDuration(latestFinish - earliestStart)} · ${stepCount}`;
}

// Expansion is captured once at mount and never reset on settling: a group
// still running when it mounts opens immediately and stays open once it
// settles (so the finished steps don't get yanked away mid-read); a settled
// group loaded from history mounts collapsed. Only a click changes it after that.
function ActivityGroup({ parts }: { parts: ToolCallPart[] }) {
  const [expanded, setExpanded] = useState(() => parts.some((part) => !isToolCallSettled(part.status)));
  const allSettled = parts.every((part) => isToolCallSettled(part.status));
  const anyUnsuccessful = parts.some((part) => part.status === 'failed' || part.status === 'denied');
  const firstUnsettled = parts.find((part) => !isToolCallSettled(part.status)) ?? null;

  const glyph = !allSettled && firstUnsettled ? (
    <LoaderCircle className="size-3.5 shrink-0 animate-spin text-brand" />
  ) : anyUnsuccessful ? (
    <TriangleAlert className="size-3.5 shrink-0 text-warning" />
  ) : (
    <Check className="size-3.5 shrink-0 text-success" />
  );
  const label = !allSettled && firstUnsettled ? toolCallLabel(firstUnsettled) : summarizeActivityGroup(parts);

  return (
    <div className="w-full max-w-[85%] animate-chat-enter motion-reduce:animate-none">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 py-1 text-left text-xs text-secondary transition-colors hover:text-primary cursor-pointer"
      >
        {glyph}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {expanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
      </button>
      {expanded ? (
        <div className="ml-1.5 flex flex-col gap-1 border-l border-secondary pl-3">
          {parts.map((part) => <ActivityStepRow key={part.callId} part={part} />)}
        </div>
      ) : null}
    </div>
  );
}

function ActivityStepGlyph({ status }: { status: AgentToolCallStatus }) {
  switch (status) {
    case 'running':
      return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-brand" />;
    case 'awaiting_permission':
      return <Clock className="size-3.5 shrink-0 text-warning" />;
    case 'pending':
      return <Circle className="size-3.5 shrink-0 text-tertiary" />;
    case 'succeeded':
      return <Check className="size-3.5 shrink-0 text-success" />;
    case 'failed':
      return <X className="size-3.5 shrink-0 text-error" />;
    case 'denied':
      return <Ban className="size-3.5 shrink-0 text-warning" />;
    case 'cancelled':
      return <Minus className="size-3.5 shrink-0 text-tertiary" />;
    default:
      return null;
  }
}

const MAX_VISIBLE_ITEMS = 6;

function ActivityStepRow({ part }: { part: ToolCallPart }) {
  const summary = summarizeToolCall(part);
  const label = toolCallLabel(part);
  const visibleItems = summary.items.slice(0, MAX_VISIBLE_ITEMS);
  const hiddenCount = summary.items.length - visibleItems.length;

  return (
    <div className="flex items-start gap-1.5 py-0.5 text-xs leading-5 animate-chat-enter motion-reduce:animate-none">
      <ActivityStepGlyph status={part.status} />
      <div className="min-w-0 flex-1">
        <span className="text-primary">{label}</span>
        {visibleItems.length > 0 ? (
          <>
            <span className="text-primary">:</span>
            <span className="text-tertiary"> {visibleItems.join(', ')}{hiddenCount > 0 ? ` +${hiddenCount} more` : ''}</span>
          </>
        ) : null}
        {summary.detail ? (
          <div className={cn('text-xs', part.status === 'denied' ? 'text-warning' : 'text-error')}>{summary.detail}</div>
        ) : null}
      </div>
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
      <div className="mx-3 mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-primary bg-secondary/60 px-3 py-2 text-sm text-secondary">
        <span>Assistant isn&rsquo;t configured.</span>
        <ReacstButton
          variant="default"
          onClick={() => {
            actions.close();
            workbenchActions.setSettingsTab('assistant');
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
    <div className="mx-3 mb-3 shrink-0 rounded-xl border border-primary bg-secondary/60 transition-colors focus-within:border-brand">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message the assistant"
        rows={1}
        className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-primary placeholder:text-tertiary outline-none"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <ModelPicker />
        <button
          type="button"
          aria-label={running ? 'Stop' : 'Send'}
          title={running ? 'Stop' : 'Send'}
          onClick={handleSendOrStop}
          disabled={!running && text.trim().length === 0}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
            running
              ? 'border border-primary bg-primary text-primary hover:bg-tertiary'
              : 'bg-brand text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {running ? <Square size={12} className="fill-current" /> : <ArrowUp size={14} />}
        </button>
      </div>
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
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const thread = state.activeThread;
  const provider = thread?.provider ?? state.config?.provider ?? null;
  const model = thread?.model ?? state.config?.model ?? null;
  const isOverride = thread ? thread.provider != null || thread.model != null : false;
  const baseUrl = state.config?.baseUrl ?? null;

  useEffect(() => {
    if (!provider) {
      setModels([]);
      setModelLoadError(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingModels(true);
    setModelLoadError(null);
    window.castApi.agentListModels({ provider, baseUrl })
      .then((list) => {
        if (!cancelled) {
          setModels([...list].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setModels([]);
          setModelLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [provider, baseUrl, loadAttempt]);

  if (!provider) return null;

  const selectedModel = models.find((entry) => entry.id === model);
  // Never show a raw catalog id: once the catalog has loaded, fall back to a
  // prettified id rather than the wire id while it's still selected but not
  // (or not yet) present in the loaded list.
  const label = selectedModel?.label ?? (model != null ? prettifyModelId(model) : loadingModels ? 'Loading models…' : 'Model');

  // The shortlist Settings configured for this provider (empty/missing means
  // "every catalog model"). The active selection is always shown even if it
  // fell out of the shortlist, so switching providers/models in Settings can
  // never silently hide the model a thread is already using.
  const shortlist = provider ? state.config?.composerModels[provider] ?? [] : [];
  const visibleModels = shortlist.length === 0 ? models : models.filter((entry) => shortlist.includes(entry.id) || entry.id === model);

  // No thread yet (nothing to attach a per-thread override to): show the
  // effective default as plain, non-interactive text.
  if (!thread) {
    return (
      <div className="flex items-center gap-2 self-start px-2 py-1 text-xs text-tertiary">
        {modelLoadError ? (
          <>
            <span role="alert" title={modelLoadError} className="text-error">Couldn’t load models.</span>
            <ReacstButton variant="ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</ReacstButton>
          </>
        ) : (
          <>
            <ModelVendorLogo vendor={selectedModel?.vendor ?? null} className="size-3.5" />
            <span>{label}</span>
            {selectedModel?.isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
          </>
        )}
      </div>
    );
  }

  return (
    <Dropdown className="self-start">
      <ModelPickerFocusOnInvalid invalid={state.modelValidation === 'not-found'} />
      <Dropdown.Trigger aria-label="Model" className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-secondary hover:bg-tertiary cursor-pointer">
        <ModelVendorLogo vendor={selectedModel?.vendor ?? null} className="size-3.5" />
        <span className="max-w-40 truncate">{label}</span>
        {selectedModel?.isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
        <ChevronDown size={12} className="shrink-0 text-tertiary" />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="top-start" className="max-h-64 min-w-48">
        <Dropdown.Item onClick={() => void actions.setThreadModel(thread.id, null, null)}>
          <span className="flex-1">Default</span>
          {!isOverride ? <Check size={14} /> : null}
        </Dropdown.Item>
        <Dropdown.Separator />
        {loadingModels ? <div className="px-2 py-1.5 text-xs text-tertiary">Loading…</div> : null}
        {!loadingModels && modelLoadError ? (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span role="alert" title={modelLoadError} className="flex-1 text-xs text-error">Couldn’t load models.</span>
            <ReacstButton variant="ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</ReacstButton>
          </div>
        ) : null}
        {!loadingModels && !modelLoadError && models.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-tertiary">No models available.</div>
        ) : null}
        {visibleModels.map((entry) => (
          <Dropdown.Item key={entry.id} onClick={() => void actions.setThreadModel(thread.id, provider, entry.id)}>
            <ModelVendorLogo vendor={entry.vendor} className="size-3.5" />
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
            {isOverride && model === entry.id ? <Check size={14} /> : null}
          </Dropdown.Item>
        ))}
      </Dropdown.Panel>
    </Dropdown>
  );
}

// ─── Public export ────────────────────────────────────────

export const AgentChatPopup = { Root, Header, Transcript, Composer, ThreadList };
