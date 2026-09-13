import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  AgentConfig,
  AgentCredentialStatus,
  AgentModelInfo,
  AgentThread,
  AgentThreadEvent,
  AgentThreadSummary,
} from '@lumacast/protocol';
import { createDefaultAgentConfig } from '@lumacast/protocol';
import { ConfirmProvider } from '@renderer/components/overlays/confirm-dialog';
import { AgentChatProvider } from '@renderer/features/agent/chat/agent-chat-context';
import { AgentChatPopup } from '@renderer/features/agent/chat/agent-chat-popup';
import { AgentChatTrigger } from '@renderer/features/agent/chat/agent-chat-trigger';

// Base UI positioners measure through ResizeObserver and wait out popup
// transitions with getAnimations(); jsdom implements neither.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
}

// ─── Workbench / overlay-stack mock ────────────────────────────────
// A real, React-observable stack — overlays register from an effect and only
// re-read `isTopmost` once that registration re-renders them (same reasoning
// as tests/app/renderer/components/overlays/workbench-overlay-stack.ts).

const workbench = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let stack: string[] = [];
  function emit() { for (const listener of listeners) listener(); }
  return {
    setWorkbenchMode: vi.fn(),
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getStack: () => stack,
    register: (id: string) => { if (!stack.includes(id)) { stack = [...stack, id]; emit(); } },
    unregister: (id: string) => { if (stack.includes(id)) { stack = stack.filter((entry) => entry !== id); emit(); } },
    reset() { stack = []; emit(); },
  };
});

function overlayRoot(): HTMLElement {
  const existing = document.getElementById('overlay-root');
  if (existing) return existing;
  const created = document.createElement('div');
  created.id = 'overlay-root';
  document.body.appendChild(created);
  return created;
}

vi.mock('@renderer/contexts/workbench-context', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    useWorkbench: () => ({
      state: {},
      actions: { setWorkbenchMode: workbench.setWorkbenchMode },
      overlayStack: {
        rootElement: overlayRoot(),
        stack: react.useSyncExternalStore(workbench.subscribe, workbench.getStack),
        baseZIndex: 9000,
        register: workbench.register,
        unregister: workbench.unregister,
      },
    }),
  };
});

// ─── Fixtures ───────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { ...createDefaultAgentConfig(), provider: 'anthropic', model: 'claude-sonnet', ...overrides };
}

function makeCredentialStatuses(hasKey = true): AgentCredentialStatus[] {
  return [{ provider: 'anthropic', hasKey, keyHint: hasKey ? 'abcd' : null }];
}

function makeSummary(overrides: Partial<AgentThreadSummary> = {}): AgentThreadSummary {
  return {
    id: 't-1',
    title: 'New chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 0,
    provider: null,
    model: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return { ...makeSummary(), messages: [], ...overrides };
}

// ─── castApi mock ───────────────────────────────────────────────────

let emitThreadEvent: (event: AgentThreadEvent) => void = () => {};
let castApi: Record<string, ReturnType<typeof vi.fn>>;
let threadsById: Map<string, AgentThread>;

function buildCastApi() {
  threadsById = new Map();
  const api = {
    agentListThreads: vi.fn(async (): Promise<AgentThreadSummary[]> => []),
    agentGetThread: vi.fn(async ({ id }: { id: string }) => threadsById.get(id) ?? null),
    agentCreateThread: vi.fn(async () => {
      const thread = makeThread({ id: 'new-thread', title: 'New chat' });
      threadsById.set(thread.id, thread);
      return thread;
    }),
    agentDeleteThread: vi.fn(async () => undefined),
    agentRenameThread: vi.fn(async ({ id, title }: { id: string; title: string }) => makeSummary({ id, title })),
    agentSetThreadModel: vi.fn(async ({ id, provider, model }: { id: string; provider: string | null; model: string | null }) =>
      makeSummary({ id, provider: provider as AgentThreadSummary['provider'], model })),
    agentSendMessage: vi.fn(async () => ({ runId: 'run-1' })),
    agentStopGeneration: vi.fn(async () => undefined),
    agentGetConfig: vi.fn(async () => makeConfig()),
    agentGetCredentialStatus: vi.fn(async () => makeCredentialStatuses()),
    agentListModels: vi.fn(async (): Promise<AgentModelInfo[]> => [
      { id: 'model-a', label: 'Model A', contextWindow: null, maxOutputTokens: null, supportsTools: true },
    ]),
    agentValidateModel: vi.fn(async () => 'valid' as const),
    onAgentThreadEvent: vi.fn((callback: (event: AgentThreadEvent) => void) => {
      emitThreadEvent = callback;
      return () => { emitThreadEvent = () => {}; };
    }),
  };
  return api;
}

function Harness() {
  return (
    <ConfirmProvider>
      <AgentChatProvider>
        <AgentChatTrigger />
        <AgentChatPopup.Root />
      </AgentChatProvider>
    </ConfirmProvider>
  );
}

async function openPopup() {
  fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
  await waitFor(() => expect(document.querySelector('[data-popover-content="true"]')).not.toBeNull());
}

async function openConfiguredPopup() {
  await openPopup();
  await waitFor(() => expect(screen.getByPlaceholderText('Message the assistant')).toBeInTheDocument());
}

beforeEach(() => {
  workbench.reset();
  castApi = buildCastApi();
  (window as unknown as { castApi: unknown }).castApi = castApi;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('trigger', () => {
  it('toggles the popup open and closed', async () => {
    render(<Harness />);
    expect(document.querySelector('[data-popover-content="true"]')).toBeNull();

    await openPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    await waitFor(() => expect(document.querySelector('[data-popover-content="true"]')).toBeNull());
  });
});

describe('not-configured state', () => {
  it('replaces the composer with an "Open settings" affordance', async () => {
    castApi.agentGetConfig.mockResolvedValue(makeConfig({ provider: null, model: null }));
    render(<Harness />);
    await openPopup();

    const openSettings = await screen.findByRole('button', { name: 'Open settings' });
    expect(screen.queryByPlaceholderText('Message the assistant')).toBeNull();

    fireEvent.click(openSettings);
    expect(workbench.setWorkbenchMode).toHaveBeenCalledWith('settings');
    // Closing on navigation is a deliberate call, not spec-mandated.
    await waitFor(() => expect(document.querySelector('[data-popover-content="true"]')).toBeNull());
  });

  it('treats a configured model with no stored credential as not configured', async () => {
    castApi.agentGetCredentialStatus.mockResolvedValue(makeCredentialStatuses(false));
    render(<Harness />);
    await openPopup();
    await screen.findByRole('button', { name: 'Open settings' });
  });
});

describe('sending', () => {
  it('appends a user message, creates a thread on the fly, and calls agentSendMessage', async () => {
    render(<Harness />);
    await openConfiguredPopup();

    const textarea = screen.getByPlaceholderText('Message the assistant');
    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(castApi.agentCreateThread).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalledWith({ threadId: 'new-thread', text: 'Hello there' }));
  });

  it('does not send on Shift+Enter, only inserts a newline', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    const textarea = screen.getByPlaceholderText('Message the assistant');
    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(castApi.agentSendMessage).not.toHaveBeenCalled();
  });
});

describe('streaming', () => {
  it('streams text deltas into the in-progress assistant message', async () => {
    render(<Harness />);
    await openConfiguredPopup();

    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
    });
    act(() => {
      emitThreadEvent({ type: 'text_delta', threadId: 'new-thread', messageId: 'asst-1', text: 'Hi ' });
    });
    act(() => {
      emitThreadEvent({ type: 'text_delta', threadId: 'new-thread', messageId: 'asst-1', text: 'there' });
    });

    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument());
  });

  it('renders a tool_call part as a card with the action title and status, expandable to its arguments', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Make a playlist' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({
        type: 'tool_call_updated',
        threadId: 'new-thread',
        messageId: 'asst-1',
        part: {
          type: 'tool_call',
          callId: 'call-1',
          actionId: 'playlist.create',
          arguments: { name: 'Sunday' },
          status: 'running',
          result: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      });
    });

    expect(await screen.findByText('Create playlist')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText(/"name"/)).toBeNull();

    fireEvent.click(screen.getByText('Create playlist').closest('button')!);
    expect(screen.getByText(/"name"/)).toBeInTheDocument();
    expect(screen.getByText(/Sunday/)).toBeInTheDocument();
  });

  it('appends an error part on run_error', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({ type: 'run_error', threadId: 'new-thread', code: 'network', message: 'Connection lost' });
    });

    expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  });
});

describe('send / stop swap', () => {
  it('swaps Send for Stop while a run is active and calls agentStopGeneration', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
    });

    const stopButton = await screen.findByRole('button', { name: 'Stop' });
    fireEvent.click(stopButton);
    expect(castApi.agentStopGeneration).toHaveBeenCalledWith({ id: 'new-thread' });

    act(() => {
      emitThreadEvent({ type: 'run_finished', threadId: 'new-thread', runId: 'run-1', reason: 'stopped' });
    });
    await screen.findByRole('button', { name: 'Send' });
  });
});

describe('thread list', () => {
  it('shows threads, selects one, and deletes one', async () => {
    threadsById = new Map([
      ['t-1', makeThread({ id: 't-1', title: 'Sunday service', messageCount: 3, updatedAt: '2026-01-02T00:00:00.000Z' })],
      ['t-2', makeThread({ id: 't-2', title: 'Wednesday notes', messageCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' })],
    ]);
    castApi.agentListThreads.mockResolvedValue([
      makeSummary({ id: 't-1', title: 'Sunday service', messageCount: 3, updatedAt: '2026-01-02T00:00:00.000Z' }),
      makeSummary({ id: 't-2', title: 'Wednesday notes', messageCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();

    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    expect(await screen.findByText('Sunday service')).toBeInTheDocument();
    expect(screen.getByText('Wednesday notes')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sunday service'));
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalledWith({ id: 't-1' }));
    await waitFor(() => expect(screen.queryByText('Wednesday notes')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    const wednesdayRow = screen.getByText('Wednesday notes').closest('[role="button"]') as HTMLElement;
    fireEvent.click(within(wednesdayRow).getByRole('button', { name: 'Delete thread' }));

    const confirmDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(castApi.agentDeleteThread).toHaveBeenCalledWith({ id: 't-2' }));
    await waitFor(() => expect(screen.queryByText('Wednesday notes')).toBeNull());
  });
});

describe('rename', () => {
  it('renames the active thread from the header menu', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    fireEvent.click(await screen.findByText('Rename'));

    const input = document.querySelector('input:not([type])') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Evening service' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(castApi.agentRenameThread).toHaveBeenCalledWith({ id: 't-1', title: 'Evening service' }));
  });
});

describe('model picker', () => {
  it('calls agentSetThreadModel when a model is chosen', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalled());

    const picker = await screen.findByRole('button', { name: 'Model' });
    expect(within(picker).getByText('Default')).toBeInTheDocument();
    fireEvent.click(picker);

    fireEvent.click(await screen.findByText('Model A'));
    await waitFor(() => expect(castApi.agentSetThreadModel).toHaveBeenCalledWith({ id: 't-1', provider: 'anthropic', model: 'model-a' }));
  });
});

describe('invalid model banner', () => {
  it('shows a not-found banner and focuses the model picker', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service', model: 'ghost-model', provider: 'anthropic' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', model: 'ghost-model', provider: 'anthropic' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    castApi.agentValidateModel.mockResolvedValue('not-found');

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));

    expect(await screen.findByText('Model ghost-model is no longer available.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model' })));
  });
});

describe('auto-scroll', () => {
  it('suppresses auto-scroll once the user has scrolled up, and resumes at the bottom', async () => {
    threadsById = new Map([
      ['t-1', makeThread({
        id: 't-1',
        title: 'Sunday service',
        messages: [{ id: 'm-1', role: 'user', parts: [{ type: 'text', text: 'first' }], createdAt: '2026-01-01T00:00:00.000Z', usage: null }],
      })],
    ]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', messageCount: 1 })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    const scroller = screen.getByText('first').closest('div.overflow-y-auto') as HTMLDivElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    scroller.scrollTop = 0;

    // Establish the baseline with the overridden metrics in place: a fresh
    // message arrives and the (still un-scrolled) transcript auto-scrolls.
    act(() => {
      emitThreadEvent({ type: 'text_delta', threadId: 't-1', messageId: 'asst-1', text: 'streaming' });
    });
    await waitFor(() => expect(screen.getByText('streaming')).toBeInTheDocument());
    expect(scroller.scrollTop).toBe(500);

    // User scrolls away from the bottom.
    scroller.scrollTop = 50;
    fireEvent.scroll(scroller);

    act(() => {
      emitThreadEvent({ type: 'text_delta', threadId: 't-1', messageId: 'asst-1', text: ' more' });
    });
    await waitFor(() => expect(screen.getByText('streaming more')).toBeInTheDocument());
    expect(scroller.scrollTop).toBe(50);

    // Scrolling back to the bottom re-arms auto-scroll.
    scroller.scrollTop = 500;
    fireEvent.scroll(scroller);
    act(() => {
      emitThreadEvent({ type: 'text_delta', threadId: 't-1', messageId: 'asst-1', text: ' still' });
    });
    await waitFor(() => expect(screen.getByText('streaming more still')).toBeInTheDocument());
    expect(scroller.scrollTop).toBe(500);
  });
});

describe('persistence', () => {
  it('restores open state and the active thread from localStorage', async () => {
    threadsById = new Map([
      ['t-1', makeThread({
        id: 't-1',
        title: 'Restored thread',
        messages: [{ id: 'm-1', role: 'assistant', parts: [{ type: 'text', text: 'Welcome back' }], createdAt: '2026-01-01T00:00:00.000Z', usage: null }],
      })],
    ]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Restored thread' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    window.localStorage.setItem('lumacast.agent-chat.v1', JSON.stringify({ open: true, threadId: 't-1' }));

    render(<Harness />);

    expect(document.querySelector('[data-popover-content="true"]')).not.toBeNull();
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalledWith({ id: 't-1' }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('persists open state as it changes', async () => {
    render(<Harness />);
    expect(window.localStorage.getItem('lumacast.agent-chat.v1')).toBe(JSON.stringify({ open: false, threadId: null }));

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    await waitFor(() => expect(window.localStorage.getItem('lumacast.agent-chat.v1')).toBe(JSON.stringify({ open: true, threadId: null })));
    // Flush the config/credentials fetch the open-effect kicks off, so no
    // pending promise resolves outside of an act() in a later test.
    await waitFor(() => expect(castApi.agentGetConfig).toHaveBeenCalled());
  });

  // jsdom's Storage is a Web-Storage-spec proxy (arbitrary property writes
  // become string entries, not JS overrides), so `setItem` cannot be forced
  // to throw here the way a real quota error would in a browser. This
  // exercises the read side of the same try/catch instead: a corrupted
  // stored value must not crash the provider.
  it('tolerates a corrupted stored value and falls back to closed', async () => {
    window.localStorage.setItem('lumacast.agent-chat.v1', '{not json');
    expect(() => render(<Harness />)).not.toThrow();
    expect(document.querySelector('[data-popover-content="true"]')).toBeNull();
    await waitFor(() => expect(castApi.agentListThreads).toHaveBeenCalled());
  });
});
