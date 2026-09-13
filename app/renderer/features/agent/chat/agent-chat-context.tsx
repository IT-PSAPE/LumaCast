// The in-app agent chat: thread list, active thread, and the streamed
// run state applied from `onAgentThreadEvent` (ADR-0038). This context owns
// every mutation the popup (`agent-chat-popup.tsx`) and its trigger
// (`agent-chat-trigger.tsx`) need, so neither has to touch `window.castApi`
// directly or reconcile streamed events itself.
//
// A run always emits `message_completed` (the authoritative final message)
// before `run_finished`, even on failure — see `agent-runtime.ts`. Text
// deltas and tool-call updates before that are a streaming preview applied
// against a synthesized in-progress assistant message; `message_completed`
// replaces it outright, so a dropped or reordered delta never leaves the
// transcript stuck mid-stream.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import { createId, nowIso } from '@lumacast/kernel';
import type {
  AgentConfig,
  AgentCredentialStatus,
  AgentMessage,
  AgentMessagePart,
  AgentModelValidation,
  AgentProviderId,
  AgentThread,
  AgentThreadSummary,
} from '@lumacast/protocol';

export type ToolCallPart = Extract<AgentMessagePart, { type: 'tool_call' }>;

export type AgentChatView = 'transcript' | 'threads';

const STORAGE_KEY = 'lumacast.agent-chat.v1';

interface StoredState {
  open: boolean;
  threadId: Id | null;
}

function readStoredState(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, threadId: null };
    const parsed = JSON.parse(raw) as Partial<StoredState> | null;
    if (!parsed || typeof parsed !== 'object') return { open: false, threadId: null };
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : false,
      threadId: typeof parsed.threadId === 'string' ? (parsed.threadId as Id) : null,
    };
  } catch {
    return { open: false, threadId: null };
  }
}

function writeStoredState(next: StoredState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort persistence only — a full or blocked store must not break the chat.
  }
}

// ─── State ───────────────────────────────────────────────────────

interface AgentChatState {
  open: boolean;
  view: AgentChatView;
  threadId: Id | null;
  threads: AgentThreadSummary[];
  threadsById: Partial<Record<Id, AgentThread>>;
  threadsLoading: boolean;
  runs: Partial<Record<Id, string>>;
  assistantMessageIdByThread: Partial<Record<Id, Id>>;
  config: AgentConfig | null;
  credentialStatuses: AgentCredentialStatus[];
  modelValidationByThread: Partial<Record<Id, AgentModelValidation>>;
}

function initialState(): AgentChatState {
  const restored = readStoredState();
  return {
    open: restored.open,
    view: 'transcript',
    threadId: restored.threadId,
    threads: [],
    threadsById: {},
    threadsLoading: true,
    runs: {},
    assistantMessageIdByThread: {},
    config: null,
    credentialStatuses: [],
    modelValidationByThread: {},
  };
}

type AgentChatAction =
  | { type: 'set-open'; open: boolean }
  | { type: 'set-view'; view: AgentChatView }
  | { type: 'threads-loaded'; threads: AgentThreadSummary[] }
  | { type: 'thread-loaded'; thread: AgentThread }
  | { type: 'thread-missing'; id: Id }
  | { type: 'thread-created'; thread: AgentThread }
  | { type: 'thread-summary-updated'; summary: AgentThreadSummary }
  | { type: 'thread-deleted'; id: Id }
  | { type: 'select-thread'; threadId: Id }
  | { type: 'message-appended'; threadId: Id; message: AgentMessage }
  | { type: 'run-started'; threadId: Id; runId: string; assistantMessageId: Id }
  | { type: 'text-delta'; threadId: Id; messageId: Id; text: string }
  | { type: 'tool-call-updated'; threadId: Id; messageId: Id; part: ToolCallPart }
  | { type: 'message-completed'; threadId: Id; message: AgentMessage }
  | { type: 'run-error'; threadId: Id; message: string }
  | { type: 'run-finished'; threadId: Id }
  | { type: 'config-loaded'; config: AgentConfig }
  | { type: 'credentials-loaded'; statuses: AgentCredentialStatus[] }
  | { type: 'model-validated'; threadId: Id; validation: AgentModelValidation };

function toSummary(thread: AgentThread): AgentThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messageCount,
    provider: thread.provider,
    model: thread.model,
  };
}

function sortThreadsByRecency(threads: AgentThreadSummary[]): AgentThreadSummary[] {
  return [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function updateThread(state: AgentChatState, threadId: Id, updater: (thread: AgentThread) => AgentThread): AgentChatState {
  const thread = state.threadsById[threadId];
  if (!thread) return state;
  return { ...state, threadsById: { ...state.threadsById, [threadId]: updater(thread) } };
}

function emptyAssistantMessage(id: Id): AgentMessage {
  return { id, role: 'assistant', parts: [], createdAt: nowIso(), usage: null };
}

function appendTextDelta(thread: AgentThread, messageId: Id, text: string): AgentThread {
  const index = thread.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    const message: AgentMessage = { id: messageId, role: 'assistant', parts: [{ type: 'text', text }], createdAt: nowIso(), usage: null };
    return { ...thread, messages: [...thread.messages, message] };
  }
  const message = thread.messages[index];
  const parts = [...message.parts];
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.type === 'text') {
    parts[parts.length - 1] = { type: 'text', text: lastPart.text + text };
  } else {
    parts.push({ type: 'text', text });
  }
  const messages = [...thread.messages];
  messages[index] = { ...message, parts };
  return { ...thread, messages };
}

function upsertToolCallPart(thread: AgentThread, messageId: Id, part: ToolCallPart): AgentThread {
  const index = thread.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    const message: AgentMessage = { id: messageId, role: 'assistant', parts: [part], createdAt: nowIso(), usage: null };
    return { ...thread, messages: [...thread.messages, message] };
  }
  const message = thread.messages[index];
  const partIndex = message.parts.findIndex((existing) => existing.type === 'tool_call' && existing.callId === part.callId);
  const parts = partIndex === -1 ? [...message.parts, part] : message.parts.map((existing, i) => (i === partIndex ? part : existing));
  const messages = [...thread.messages];
  messages[index] = { ...message, parts };
  return { ...thread, messages };
}

function upsertMessage(thread: AgentThread, message: AgentMessage): AgentThread {
  const index = thread.messages.findIndex((existing) => existing.id === message.id);
  const messages = index === -1 ? [...thread.messages, message] : thread.messages.map((existing, i) => (i === index ? message : existing));
  return { ...thread, messages, messageCount: messages.length };
}

function appendErrorPart(thread: AgentThread, targetMessageId: Id | undefined, message: string): AgentThread {
  const errorPart: AgentMessagePart = { type: 'error', code: 'run_error', message };
  if (targetMessageId) {
    const index = thread.messages.findIndex((existing) => existing.id === targetMessageId);
    if (index !== -1) {
      const existing = thread.messages[index];
      const messages = [...thread.messages];
      messages[index] = { ...existing, parts: [...existing.parts, errorPart] };
      return { ...thread, messages };
    }
  }
  return { ...thread, messages: [...thread.messages, { id: createId(), role: 'assistant', parts: [errorPart], createdAt: nowIso(), usage: null }] };
}

function agentChatReducer(state: AgentChatState, action: AgentChatAction): AgentChatState {
  switch (action.type) {
    case 'set-open':
      return { ...state, open: action.open };
    case 'set-view':
      return { ...state, view: action.view };
    case 'threads-loaded':
      return { ...state, threads: sortThreadsByRecency(action.threads), threadsLoading: false };
    case 'thread-loaded':
      return { ...state, threadsById: { ...state.threadsById, [action.thread.id]: action.thread } };
    case 'thread-missing':
      return { ...state, threadId: state.threadId === action.id ? null : state.threadId };
    case 'thread-created':
      return {
        ...state,
        threadId: action.thread.id,
        view: 'transcript',
        threads: sortThreadsByRecency([toSummary(action.thread), ...state.threads]),
        threadsById: { ...state.threadsById, [action.thread.id]: action.thread },
      };
    case 'thread-summary-updated': {
      const existing = state.threadsById[action.summary.id];
      return {
        ...state,
        threads: sortThreadsByRecency(state.threads.map((t) => (t.id === action.summary.id ? action.summary : t))),
        threadsById: existing
          ? {
              ...state.threadsById,
              [action.summary.id]: {
                ...existing,
                title: action.summary.title,
                provider: action.summary.provider,
                model: action.summary.model,
                updatedAt: action.summary.updatedAt,
                messageCount: action.summary.messageCount,
              },
            }
          : state.threadsById,
      };
    }
    case 'thread-deleted': {
      const threadsById = { ...state.threadsById };
      delete threadsById[action.id];
      const runs = { ...state.runs };
      delete runs[action.id];
      const assistantMessageIdByThread = { ...state.assistantMessageIdByThread };
      delete assistantMessageIdByThread[action.id];
      const modelValidationByThread = { ...state.modelValidationByThread };
      delete modelValidationByThread[action.id];
      const wasActive = state.threadId === action.id;
      return {
        ...state,
        threads: state.threads.filter((t) => t.id !== action.id),
        threadsById,
        runs,
        assistantMessageIdByThread,
        modelValidationByThread,
        threadId: wasActive ? null : state.threadId,
        view: wasActive ? 'threads' : state.view,
      };
    }
    case 'select-thread':
      return { ...state, threadId: action.threadId, view: 'transcript' };
    case 'message-appended':
      return updateThread(state, action.threadId, (thread) => ({
        ...thread,
        messages: [...thread.messages, action.message],
        messageCount: thread.messages.length + 1,
      }));
    case 'run-started': {
      const withRun = {
        ...state,
        runs: { ...state.runs, [action.threadId]: action.runId },
        assistantMessageIdByThread: { ...state.assistantMessageIdByThread, [action.threadId]: action.assistantMessageId },
      };
      return updateThread(withRun, action.threadId, (thread) =>
        thread.messages.some((message) => message.id === action.assistantMessageId)
          ? thread
          : { ...thread, messages: [...thread.messages, emptyAssistantMessage(action.assistantMessageId)] },
      );
    }
    case 'text-delta':
      return updateThread(state, action.threadId, (thread) => appendTextDelta(thread, action.messageId, action.text));
    case 'tool-call-updated':
      return updateThread(state, action.threadId, (thread) => upsertToolCallPart(thread, action.messageId, action.part));
    case 'message-completed':
      return updateThread(state, action.threadId, (thread) => upsertMessage(thread, action.message));
    case 'run-error':
      return updateThread(state, action.threadId, (thread) =>
        appendErrorPart(thread, state.assistantMessageIdByThread[action.threadId], action.message));
    case 'run-finished': {
      const runs = { ...state.runs };
      delete runs[action.threadId];
      const assistantMessageIdByThread = { ...state.assistantMessageIdByThread };
      delete assistantMessageIdByThread[action.threadId];
      return { ...state, runs, assistantMessageIdByThread };
    }
    case 'config-loaded':
      return { ...state, config: action.config };
    case 'credentials-loaded':
      return { ...state, credentialStatuses: action.statuses };
    case 'model-validated':
      return { ...state, modelValidationByThread: { ...state.modelValidationByThread, [action.threadId]: action.validation } };
    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────

export interface AgentChatContextValue {
  state: {
    open: boolean;
    view: AgentChatView;
    threadId: Id | null;
    threads: AgentThreadSummary[];
    activeThread: AgentThread | null;
    threadsLoading: boolean;
    config: AgentConfig | null;
    credentialStatuses: AgentCredentialStatus[];
    modelValidation: AgentModelValidation | null;
    hasActiveRun: boolean;
  };
  actions: {
    open: () => void;
    close: () => void;
    toggle: () => void;
    setView: (view: AgentChatView) => void;
    createThread: () => Promise<void>;
    selectThread: (id: Id) => Promise<void>;
    renameThread: (id: Id, title: string) => Promise<void>;
    deleteThread: (id: Id) => Promise<void>;
    setThreadModel: (id: Id, provider: AgentProviderId | null, model: string | null) => Promise<void>;
    send: (text: string) => Promise<void>;
    stop: () => Promise<void>;
  };
  isRunning: (threadId: Id) => boolean;
}

const AgentChatContext = createContext<AgentChatContextValue | null>(null);

export function useAgentChat(): AgentChatContextValue {
  const ctx = useContext(AgentChatContext);
  if (!ctx) throw new Error('useAgentChat must be used within AgentChatProvider');
  return ctx;
}

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(agentChatReducer, undefined, initialState);

  // Persist open/threadId on every change (wrapped in try/catch above).
  useEffect(() => {
    writeStoredState({ open: state.open, threadId: state.threadId });
  }, [state.open, state.threadId]);

  // Mount-once: the thread list (for the threads view and the trigger's
  // running indicator, which needs no popup open) and the restored thread's
  // messages, if any.
  useEffect(() => {
    let cancelled = false;
    void window.castApi.agentListThreads().then((threads) => {
      if (!cancelled) dispatch({ type: 'threads-loaded', threads });
    });
    const restoredId = state.threadId;
    if (restoredId) {
      void window.castApi.agentGetThread({ id: restoredId }).then((thread) => {
        if (cancelled) return;
        if (thread) dispatch({ type: 'thread-loaded', thread });
        else dispatch({ type: 'thread-missing', id: restoredId });
      });
    }
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — `state.threadId` here is deliberately the
    // value restored from storage, not a live dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe once to the streamed run feed; unsubscribe on unmount.
  useEffect(() => {
    const unsubscribe = window.castApi.onAgentThreadEvent((event) => {
      switch (event.type) {
        case 'run_started':
          dispatch({ type: 'run-started', threadId: event.threadId, runId: event.runId, assistantMessageId: event.assistantMessageId });
          break;
        case 'text_delta':
          dispatch({ type: 'text-delta', threadId: event.threadId, messageId: event.messageId, text: event.text });
          break;
        case 'tool_call_updated':
          dispatch({ type: 'tool-call-updated', threadId: event.threadId, messageId: event.messageId, part: event.part });
          break;
        case 'message_completed':
          dispatch({ type: 'message-completed', threadId: event.threadId, message: event.message });
          break;
        case 'run_error':
          dispatch({ type: 'run-error', threadId: event.threadId, message: event.message });
          break;
        case 'run_finished':
          dispatch({ type: 'run-finished', threadId: event.threadId });
          // Refreshes title (first-message derivation), message count, and
          // ordering — all decided on the main side, not replayed here.
          void window.castApi.agentListThreads().then((threads) => dispatch({ type: 'threads-loaded', threads }));
          break;
        default:
          break;
      }
    });
    return unsubscribe;
  }, []);

  // Config/credentials are refreshed each time the popup opens, so a change
  // made in Settings while it was closed is reflected immediately.
  useEffect(() => {
    if (!state.open) return;
    void window.castApi.agentGetConfig().then((config) => dispatch({ type: 'config-loaded', config }));
    void window.castApi.agentGetCredentialStatus().then((statuses) => dispatch({ type: 'credentials-loaded', statuses }));
  }, [state.open]);

  const activeThread = state.threadId ? state.threadsById[state.threadId] ?? null : null;

  // Revalidate the active thread's effective model whenever the popup opens,
  // the selected thread (or its override) changes, or the config default does.
  useEffect(() => {
    if (!state.open || !activeThread || !state.config) return;
    const provider = activeThread.provider ?? state.config.provider;
    const model = activeThread.model ?? state.config.model;
    if (!provider || !model) return;
    let cancelled = false;
    void window.castApi.agentValidateModel({ provider, model, baseUrl: state.config.baseUrl }).then((validation) => {
      if (!cancelled) dispatch({ type: 'model-validated', threadId: activeThread.id, validation });
    });
    return () => {
      cancelled = true;
    };
  }, [state.open, activeThread?.id, activeThread?.provider, activeThread?.model, state.config]);

  const isRunning = (threadId: Id) => state.runs[threadId] !== undefined;

  const actions: AgentChatContextValue['actions'] = {
    open: () => dispatch({ type: 'set-open', open: true }),
    close: () => dispatch({ type: 'set-open', open: false }),
    toggle: () => dispatch({ type: 'set-open', open: !state.open }),
    setView: (view) => dispatch({ type: 'set-view', view }),
    async createThread() {
      const thread = await window.castApi.agentCreateThread({ provider: null, model: null });
      dispatch({ type: 'thread-created', thread });
    },
    async selectThread(id) {
      dispatch({ type: 'select-thread', threadId: id });
      const thread = await window.castApi.agentGetThread({ id });
      if (thread) dispatch({ type: 'thread-loaded', thread });
    },
    async renameThread(id, title) {
      const summary = await window.castApi.agentRenameThread({ id, title });
      dispatch({ type: 'thread-summary-updated', summary });
    },
    async deleteThread(id) {
      await window.castApi.agentDeleteThread({ id });
      dispatch({ type: 'thread-deleted', id });
    },
    async setThreadModel(id, provider, model) {
      const summary = await window.castApi.agentSetThreadModel({ id, provider, model });
      dispatch({ type: 'thread-summary-updated', summary });
    },
    async send(text) {
      let threadId = state.threadId;
      if (!threadId) {
        const thread = await window.castApi.agentCreateThread({ provider: null, model: null });
        dispatch({ type: 'thread-created', thread });
        threadId = thread.id;
      }
      const message: AgentMessage = { id: createId(), role: 'user', parts: [{ type: 'text', text }], createdAt: nowIso(), usage: null };
      dispatch({ type: 'message-appended', threadId, message });
      await window.castApi.agentSendMessage({ threadId, text });
    },
    async stop() {
      if (!state.threadId) return;
      await window.castApi.agentStopGeneration({ id: state.threadId });
    },
  };

  const value: AgentChatContextValue = {
    state: {
      open: state.open,
      view: state.view,
      threadId: state.threadId,
      threads: state.threads,
      activeThread,
      threadsLoading: state.threadsLoading,
      config: state.config,
      credentialStatuses: state.credentialStatuses,
      modelValidation: activeThread ? state.modelValidationByThread[activeThread.id] ?? null : null,
      hasActiveRun: Object.keys(state.runs).length > 0,
    },
    actions,
    isRunning,
  };

  return <AgentChatContext.Provider value={value}>{children}</AgentChatContext.Provider>;
}
