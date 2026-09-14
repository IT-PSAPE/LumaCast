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
import { summarizeToolCall, toolCallLabel, type ToolCallPart } from '@renderer/features/agent/chat/tool-call-summary';

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
    setSettingsTab: vi.fn(),
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
      actions: { setWorkbenchMode: workbench.setWorkbenchMode, setSettingsTab: workbench.setSettingsTab },
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

// Every field the protocol declares, always present — the transcript's
// activity groups branch on all of them (status, timestamps, result shape).
function makeToolCall(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: 'tool_call',
    callId: 'call-1',
    actionId: 'playlist.create',
    arguments: { name: 'Sunday' },
    status: 'running',
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
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
      { id: 'model-a', label: 'Model A', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'openai' },
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

  // Regression: ReacstButton's base classes have no `flex`, and Tailwind's
  // preflight gives `svg` `display: block`, so the Sparkles icon forced a
  // line break and `gap-1.5` did nothing — the icon and label stacked.
  it('lays the icon and label out on one line', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Assistant' });
    expect(trigger.className).toEqual(expect.stringContaining('inline-flex'));
    expect(trigger.className).toEqual(expect.stringContaining('items-center'));
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
    expect(workbench.setSettingsTab).toHaveBeenCalledWith('assistant');
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

  it('renders a running tool_call as an activity group narrating the step, never raw JSON', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Make a playlist' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    const part = makeToolCall({ status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({ type: 'tool_call_updated', threadId: 'new-thread', messageId: 'asst-1', part });
    });

    const expectedLabel = toolCallLabel(part);
    const header = await screen.findByRole('button', { name: expectedLabel });
    expect(screen.queryByText(/"name"/)).toBeNull();

    fireEvent.click(header);
    expect(screen.queryByText(/"name"/)).toBeNull();
    expect(screen.queryByText(/"Sunday"/)).toBeNull();
  });

  it('groups a two-step run into one activity group that narrates each step and stays expanded once it settles', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Do two things' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    const first = makeToolCall({ callId: 'call-1', actionId: 'playlist.list', arguments: {}, status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
    const second = makeToolCall({ callId: 'call-2', actionId: 'playlist.create', status: 'pending' });

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({ type: 'tool_call_updated', threadId: 'new-thread', messageId: 'asst-1', part: first });
      emitThreadEvent({ type: 'tool_call_updated', threadId: 'new-thread', messageId: 'asst-1', part: second });
    });

    // Still running: the group header narrates the first unsettled call, and
    // is itself already open (matched by role so it can't collide with the
    // same label repeated in the expanded step row below).
    expect(await screen.findByRole('button', { name: toolCallLabel(first) })).toBeInTheDocument();

    const firstSucceeded = { ...first, status: 'succeeded' as const, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:02.000Z' };
    const secondSucceeded = { ...second, status: 'succeeded' as const, result: { name: 'Sunday' }, startedAt: '2026-01-01T00:00:02.000Z', finishedAt: '2026-01-01T00:00:05.000Z' };

    act(() => {
      emitThreadEvent({ type: 'tool_call_updated', threadId: 'new-thread', messageId: 'asst-1', part: firstSucceeded });
      emitThreadEvent({ type: 'tool_call_updated', threadId: 'new-thread', messageId: 'asst-1', part: secondSucceeded });
    });

    expect(await screen.findByRole('button', { name: /Worked for .* · 2 steps|2 steps/ })).toBeInTheDocument();
    // Stays expanded — it was open before settling, so the step labels don't get yanked away.
    expect(screen.getByText(toolCallLabel(firstSucceeded))).toBeInTheDocument();
    expect(screen.getByText(toolCallLabel(secondSucceeded))).toBeInTheDocument();
  });

  it('mounts a settled group loaded from history collapsed, and expands on click', async () => {
    const first = makeToolCall({ callId: 'call-1', actionId: 'playlist.list', arguments: {}, status: 'succeeded', result: [{ name: 'Sunday' }], startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' });
    const second = makeToolCall({ callId: 'call-2', actionId: 'playlist.create', status: 'succeeded', result: { name: 'Sunday' }, startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:02.000Z' });
    threadsById = new Map([
      ['t-1', makeThread({
        id: 't-1',
        title: 'Sunday service',
        messages: [{ id: 'm-1', role: 'assistant', parts: [first, second], createdAt: '2026-01-01T00:00:00.000Z', usage: null }],
      })],
    ]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', messageCount: 1 })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalled());

    const header = await screen.findByRole('button', { name: /2 steps/ });
    expect(screen.queryByText(toolCallLabel(first))).toBeNull();

    fireEvent.click(header);
    expect(screen.getByText(toolCallLabel(first))).toBeInTheDocument();
    expect(screen.getByText(toolCallLabel(second))).toBeInTheDocument();
  });

  it("renders a succeeded list call's result names joined by a comma", async () => {
    const part = makeToolCall({
      actionId: 'playlist.list',
      arguments: {},
      status: 'succeeded',
      result: [{ name: 'Sunday' }, { name: 'Youth' }],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
    });
    threadsById = new Map([
      ['t-1', makeThread({
        id: 't-1',
        title: 'Sunday service',
        messages: [{ id: 'm-1', role: 'assistant', parts: [part], createdAt: '2026-01-01T00:00:00.000Z', usage: null }],
      })],
    ]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', messageCount: 1 })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    await waitFor(() => expect(castApi.agentGetThread).toHaveBeenCalled());

    // A single-call group is settled at mount, so it starts collapsed.
    fireEvent.click(await screen.findByRole('button', { name: /1 step/ }));

    const expectedItems = summarizeToolCall(part).items.join(', ');
    expect(screen.getByText(expectedItems)).toBeInTheDocument();
  });

  it('shows a "Thinking…" ticker for an empty in-progress message, and clears it once the run finishes', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
    });
    expect(await screen.findByText('Thinking…')).toBeInTheDocument();

    act(() => {
      emitThreadEvent({
        type: 'message_completed',
        threadId: 'new-thread',
        message: { id: 'asst-1', role: 'assistant', parts: [{ type: 'text', text: 'Done' }], createdAt: '2026-01-01T00:00:00.000Z', usage: null },
      });
      emitThreadEvent({ type: 'run_finished', threadId: 'new-thread', runId: 'run-1', reason: 'completed' });
    });

    await waitFor(() => expect(screen.queryByText('Thinking…')).toBeNull());
  });

  it('renders assistant markdown: bold text and a list', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({ type: 'text_delta', threadId: 'new-thread', messageId: 'asst-1', text: '**bold** and a list:\n\n- one\n- two' });
    });

    const strong = await screen.findByText('bold');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('escapes raw HTML in assistant text instead of rendering it', async () => {
    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message the assistant'), { key: 'Enter' });
    await waitFor(() => expect(castApi.agentSendMessage).toHaveBeenCalled());

    act(() => {
      emitThreadEvent({ type: 'run_started', threadId: 'new-thread', runId: 'run-1', assistantMessageId: 'asst-1' });
      emitThreadEvent({ type: 'text_delta', threadId: 'new-thread', messageId: 'asst-1', text: '<script>alert(1)</script>' });
    });

    expect(await screen.findByText(/alert\(1\)/)).toBeInTheDocument();
    expect(document.querySelectorAll('script')).toHaveLength(0);
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

describe('composer', () => {
  it('disables Send until there is text', async () => {
    render(<Harness />);
    await openConfiguredPopup();

    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Message the assistant'), { target: { value: 'Hi' } });
    expect(sendButton).not.toBeDisabled();
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
  it('shows the effective model display name before a thread is created', async () => {
    castApi.agentGetConfig.mockResolvedValue(makeConfig({ model: 'model-a' }));
    render(<Harness />);
    await openConfiguredPopup();

    expect(await screen.findByText('Model A')).toBeInTheDocument();
    expect(screen.queryByText('Default')).toBeNull();
  });

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
    // The catalog loaded for this test only contains "model-a" — "claude-sonnet"
    // (the config default) isn't in it, so the picker falls back to a
    // prettified id rather than the raw wire id.
    expect(within(picker).getByText('Claude Sonnet')).toBeInTheDocument();
    fireEvent.click(picker);

    fireEvent.click(await screen.findByText('Model A'));
    await waitFor(() => expect(castApi.agentSetThreadModel).toHaveBeenCalledWith({ id: 't-1', provider: 'anthropic', model: 'model-a' }));
  });

  it('exposes a retry when model loading fails', async () => {
    castApi.agentListModels
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce([]);

    render(<Harness />);
    await openConfiguredPopup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load models.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(castApi.agentListModels).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('marks free models in the picker', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    castApi.agentListModels.mockResolvedValue([
      { id: 'big-pickle', label: 'Big Pickle', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: true, vendor: 'opencode' },
    ]);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    const picker = await screen.findByRole('button', { name: 'Model' });
    fireEvent.click(picker);

    expect(await screen.findByText('Big Pickle')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('shows the vendor mark for a catalog model', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    // Default agentListModels mock returns "model-a" with vendor 'openai'.

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    const picker = await screen.findByRole('button', { name: 'Model' });
    fireEvent.click(picker);

    const item = (await screen.findByText('Model A')).closest('[data-dropdown-item]');
    expect(item?.querySelector('title')?.textContent).toBe('OpenAI');
  });

  it('shows the Free badge on the closed trigger pill for a free selected model', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service', model: 'big-pickle', provider: 'opencode' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', model: 'big-pickle', provider: 'opencode' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    castApi.agentListModels.mockResolvedValue([
      { id: 'big-pickle', label: 'Big Pickle', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: true, vendor: 'opencode' },
    ]);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));

    const picker = await screen.findByRole('button', { name: 'Model' });
    expect(within(picker).getByText('Big Pickle')).toBeInTheDocument();
    expect(within(picker).getByText('Free')).toBeInTheDocument();
  });

  it('limits the picker to the configured shortlist, always keeping the active selection visible', async () => {
    threadsById = new Map([['t-1', makeThread({ id: 't-1', title: 'Sunday service', model: 'model-b', provider: 'anthropic' })]]);
    castApi.agentListThreads.mockResolvedValue([makeSummary({ id: 't-1', title: 'Sunday service', model: 'model-b', provider: 'anthropic' })]);
    castApi.agentGetThread.mockImplementation(async ({ id }: { id: string }) => threadsById.get(id) ?? null);
    castApi.agentGetConfig.mockResolvedValue(makeConfig({ composerModels: { anthropic: ['model-a'] } }));
    castApi.agentListModels.mockResolvedValue([
      { id: 'model-a', label: 'Model A', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'openai' },
      { id: 'model-b', label: 'Model B', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: null },
      { id: 'model-c', label: 'Model C', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: null },
    ]);

    render(<Harness />);
    await openConfiguredPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(await screen.findByText('Sunday service'));
    const picker = await screen.findByRole('button', { name: 'Model' });
    fireEvent.click(picker);

    // Model A: shortlisted. Model B: not shortlisted, but it's the thread's
    // active model so it must still show. Model C: neither, hidden.
    expect(await screen.findByText('Model A')).toBeInTheDocument();
    expect(screen.getByText('Model B')).toBeInTheDocument();
    expect(screen.queryByText('Model C')).toBeNull();
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
