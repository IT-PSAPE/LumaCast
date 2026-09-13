import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentActionRequest, AgentActionResponse, AgentBatchEvent, SnapshotPatch } from '@lumacast/protocol';

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

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const note = <T extends (...args: never[]) => unknown>(name: string, impl?: T) =>
    vi.fn((...args: Parameters<T>) => {
      calls.push(name);
      return impl?.(...args);
    });

  // The overlay stack has to be real React-observable state: the dialog
  // registers from an effect and only re-reads `isTopmost` once that
  // registration re-renders it.
  const listeners = new Set<() => void>();
  let stack: string[] = [];
  const emit = () => { for (const listener of listeners) listener(); };

  const state = {
    outputState: { audience: false, stage: false },
    snapshot: { mediaAssets: [{ id: 'asset-1', src: 'cast-media://token-1' }] } as never,
    slides: [{ id: 'slide-1' }, { id: 'slide-2' }] as never[],
    currentSlideIndex: 0,
    pendingDeckChanges: false,
  };

  return {
    calls,
    note,
    state,
    overlayStack: {
      listeners,
      emit,
      get stack() { return stack; },
      reset() { stack = []; emit(); },
      register(id: string) { if (!stack.includes(id)) { stack = [...stack, id]; emit(); } },
      unregister(id: string) { if (stack.includes(id)) { stack = stack.filter((entry) => entry !== id); emit(); } },
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    cast: {
      mutatePatch: note('mutatePatch', async (action: () => Promise<SnapshotPatch>) => { await action(); return state.snapshot; }),
      beginHistoryBatch: note('beginHistoryBatch'),
      endHistoryBatch: note('endHistoryBatch'),
      undo: note('undo', async () => undefined),
      redo: note('redo', async () => undefined),
    },
    slideActions: {
      takeSlide: note('takeSlide'),
      activateSlide: note('activateSlide'),
      goNext: note('goNext'),
      goPrev: note('goPrev'),
      setCurrentSlideIndex: note('setCurrentSlideIndex'),
      selectPlaylistEntry: note('selectPlaylistEntry'),
    },
    assetEditor: {
      pushDeckChanges: note('pushDeckChanges', async () => undefined),
      pushThemeChanges: note('pushThemeChanges', async () => null),
    },
    overlayLayers: { activateOverlay: note('activateOverlay') },
    automation: { runMacro: note('runMacro', async () => undefined), cancelActiveMacros: note('cancelActiveMacros') },
    elements: {
      groupSelection: note('groupSelection', async () => 'group-1' as string | null),
      ungroupSelection: note('ungroupSelection', async () => ['el-1', 'el-2'] as string[]),
      alignSelection: note('alignSelection', async () => undefined),
      distributeSelection: note('distributeSelection', async () => undefined),
      setElementRichText: note('setElementRichText', async () => undefined),
    },
    render: {
      renderSlideToImage: note('renderSlideToImage', async (_slideId: string, ..._rest: unknown[]) => ({
        slideId: 'slide-1', dataUrl: 'data:image/png;base64,xyz', width: 100, height: 100, format: 'png' as const,
      })),
      renderContactSheet: note('renderContactSheet', async (_slideIds: string[], ..._rest: unknown[]) => ({
        slideId: 'slide-1', slideIds: ['slide-1', 'slide-2'], dataUrl: 'data:image/png;base64,sheet', width: 200, height: 100, format: 'png' as const,
      })),
    },
  };
});

vi.mock('../../../../../app/renderer/contexts/workbench-context', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  const root = () => {
    const existing = document.getElementById('overlay-root');
    if (existing) return existing;
    const created = document.createElement('div');
    created.id = 'overlay-root';
    document.body.appendChild(created);
    return created;
  };
  return {
    useWorkbench: () => ({
      state: { workbenchMode: 'show' },
      actions: {
        setWorkbenchMode: h.note('setWorkbenchMode'),
        setSlideBrowserMode: h.note('setSlideBrowserMode'),
        setProgramMode: h.note('setProgramMode'),
      },
      overlayStack: {
        rootElement: root(),
        stack: react.useSyncExternalStore(h.overlayStack.subscribe, () => h.overlayStack.stack),
        baseZIndex: 9000,
        register: h.overlayStack.register,
        unregister: h.overlayStack.unregister,
      },
    }),
  };
});

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({ snapshot: h.state.snapshot, canUndo: true, canRedo: false, ...h.cast }),
  useNdi: () => ({ state: { outputState: h.state.outputState }, actions: {} }),
}));

vi.mock('../../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    slides: h.state.slides,
    currentSlide: h.state.slides[h.state.currentSlideIndex] ?? null,
    currentSlideIndex: h.state.currentSlideIndex,
    ...h.slideActions,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentItemRef: { type: 'presentation', id: 'item-1' },
    setCurrentPlaylistId: h.note('setCurrentPlaylistId'),
    browseItem: h.note('browseItem'),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback/playback-context', () => ({
  usePlayback: () => ({
    layers: {
      ...h.overlayLayers,
      clearOverlay: vi.fn(),
      clearAllOverlays: vi.fn(),
      setOverlayMode: vi.fn(),
      setMediaLayerAsset: vi.fn(),
      clearLayer: vi.fn(),
      clearAllLayers: vi.fn(),
    },
    audio: { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(), armAudio: vi.fn(), clearAudio: vi.fn(), playNext: vi.fn(), playPrevious: vi.fn(), toggleLoop: vi.fn(), toggleMuted: vi.fn(), muted: false, loopEnabled: false },
    video: { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(), armVideo: vi.fn(), clearVideo: vi.fn(), playNext: vi.fn(), playPrevious: vi.fn(), toggleLoop: vi.fn(), toggleMuted: vi.fn(), muted: false, loopEnabled: false },
    stage: { setCurrentStageId: vi.fn() },
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback-schedules-context', () => ({
  usePlaybackSchedules: () => ({ resumeSync: vi.fn() }),
}));

vi.mock('../../../../../app/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({
    effectiveElements: [{ id: 'el-1', type: 'text', payload: {} }, { id: 'el-2', type: 'text', payload: {} }],
    selectedElementIds: [],
    selectElement: vi.fn(),
    selectElements: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    nudgeSelection: vi.fn(),
    reorderElements: vi.fn(),
    toggleElementVisibility: vi.fn(),
    toggleElementLock: vi.fn(),
    renameElement: vi.fn(),
    ...h.elements,
  }),
}));

vi.mock('../../../../../app/renderer/features/render/render-slide', async () => {
  const actual = await vi.importActual<typeof import('../../../../../app/renderer/features/render/render-slide')>(
    '../../../../../app/renderer/features/render/render-slide',
  );
  return {
    ...actual,
    renderSlideToImage: (...args: Parameters<typeof actual.renderSlideToImage>) => h.render.renderSlideToImage(...args),
    renderContactSheet: (...args: Parameters<typeof actual.renderContactSheet>) => h.render.renderContactSheet(...args),
  };
});

vi.mock('../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useAssetEditor: () => ({
    theme: { hasPendingChanges: false, pushChanges: h.assetEditor.pushThemeChanges },
    overlay: { hasPendingChanges: false, pushChanges: vi.fn() },
    deck: { hasPendingChanges: h.state.pendingDeckChanges, pushChanges: h.assetEditor.pushDeckChanges },
    stage: { hasPendingChanges: false, pushChanges: vi.fn() },
  }),
}));

vi.mock('../../../../../app/renderer/components/layout/panel-split/split-panel', () => ({
  usePanelRoute: () => ({
    actions: { togglePanel: h.note('togglePanel') },
    meta: { isPanelVisible: () => true },
  }),
}));

vi.mock('../../../../../app/renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({ actions: { ...h.automation, runCue: vi.fn() } }),
}));

vi.mock('../../../../../app/renderer/features/command-palette/command-palette-context', () => ({
  useCommandPalette: () => ({ open: h.note('openCommandPalette') }),
}));

vi.mock('../../../../../app/renderer/features/items/lyric-editor', () => ({
  useLyricEditor: () => ({ open: h.note('openLyricEditor') }),
}));

const { AgentActionDispatcher } = await import('../../../../../app/renderer/features/agent/agent-action-dispatcher');

// ─── Harness ────────────────────────────────────────────────────────

type Emit<T> = (payload: T) => void;

let emitRequest: Emit<AgentActionRequest>;
let emitBatch: Emit<AgentBatchEvent>;
let emitCancelled: Emit<{ requestId: string }>;
let responses: AgentActionResponse[];
let castApi: Record<string, ReturnType<typeof vi.fn>>;

function patchWith(table: string, ids: string[], deletes: string[] = []): SnapshotPatch {
  return {
    version: 1,
    upserts: { [table]: ids.map((id) => ({ id })) },
    deletes: deletes.length > 0 ? { [table]: deletes } : {},
  } as unknown as SnapshotPatch;
}

function makeRequest(overrides: Partial<AgentActionRequest> = {}): AgentActionRequest {
  return {
    requestId: 'r1',
    principal: { kind: 'in-app', threadId: 'thread-1' },
    actionId: 'playlist.create',
    params: { name: 'Sunday' },
    decision: 'auto',
    interlockEnabled: false,
    batchId: null,
    ...overrides,
  };
}

async function dispatch(overrides: Partial<AgentActionRequest> = {}): Promise<AgentActionResponse> {
  const request = makeRequest(overrides);
  await act(async () => { emitRequest(request); });
  await waitFor(() => expect(responses.some((entry) => entry.requestId === request.requestId)).toBe(true));
  return responses.find((entry) => entry.requestId === request.requestId)!;
}

beforeEach(() => {
  h.calls.length = 0;
  h.overlayStack.reset();
  h.state.outputState = { audience: false, stage: false };
  h.state.currentSlideIndex = 0;
  h.state.pendingDeckChanges = false;
  responses = [];

  castApi = {
    agentRespondAction: vi.fn(async (response: AgentActionResponse) => { responses.push(response); }),
    onAgentActionRequest: vi.fn((callback: Emit<AgentActionRequest>) => { emitRequest = callback; return () => {}; }),
    onAgentBatch: vi.fn((callback: Emit<AgentBatchEvent>) => { emitBatch = callback; return () => {}; }),
    onAgentActionCancelled: vi.fn((callback: Emit<{ requestId: string }>) => { emitCancelled = callback; return () => {}; }),
    createPlaylist: vi.fn(async () => patchWith('playlists', ['pl-1'])),
    deletePlaylist: vi.fn(async () => patchWith('playlists', [], ['pl-1'])),
    listPlaylists: vi.fn(async () => [{ id: 'pl-1', name: 'Sunday' }]),
    createItem: vi.fn(async () => ({ itemId: 'item-9', patch: patchWith('presentations', ['item-9']) })),
    createElement: vi.fn(async () => patchWith('slideElements', ['el-1'])),
    createMediaAsset: vi.fn(async () => patchWith('mediaAssets', ['asset-9'])),
    agentImportMedia: vi.fn(async () => patchWith('mediaAssets', ['asset-9'])),
  };
  (window as unknown as { castApi: unknown }).castApi = castApi;

  render(<AgentActionDispatcher />);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('dispatcher gating', () => {
  it('denies an action id that is not in the registry', async () => {
    const response = await dispatch({ actionId: 'playlist.teleport' as AgentActionRequest['actionId'] });
    expect(response).toEqual({ requestId: 'r1', outcome: 'denied', reason: 'unknown-action' });
    expect(castApi.createPlaylist).not.toHaveBeenCalled();
  });

  it('denies invalid params without running the action', async () => {
    const response = await dispatch({ actionId: 'slide.activate', params: {} });
    expect(response).toEqual({ requestId: 'r1', outcome: 'denied', reason: 'invalid-params' });
    expect(h.calls).not.toContain('activateSlide');
  });

  it('denies params that are not an object', async () => {
    const response = await dispatch({ actionId: 'slide.take', params: 'nope' });
    expect(response).toMatchObject({ outcome: 'denied', reason: 'invalid-params' });
  });
});

describe('main-site execution', () => {
  it('runs an auto write through mutatePatch and answers with the changed ids', async () => {
    const response = await dispatch();

    expect(castApi.createPlaylist).toHaveBeenCalledWith('Sunday');
    expect(h.cast.mutatePatch).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      requestId: 'r1',
      outcome: 'succeeded',
      result: { ok: true, changed: { playlists: { upserted: ['pl-1'], deleted: [] } } },
    });
  });

  it('reports deletes in the change summary', async () => {
    const response = await dispatch({ actionId: 'playlist.delete', params: { id: 'pl-1' } });
    expect(response).toMatchObject({
      result: { ok: true, changed: { playlists: { upserted: [], deleted: ['pl-1'] } } },
    });
  });

  it('passes a read result through untouched and never opens a mutation', async () => {
    const response = await dispatch({ actionId: 'playlist.list', params: {} });
    expect(response).toMatchObject({ outcome: 'succeeded', result: [{ id: 'pl-1', name: 'Sunday' }] });
    expect(h.cast.mutatePatch).not.toHaveBeenCalled();
  });

  it('applies the patch of an item-create result and returns the new id', async () => {
    const response = await dispatch({ actionId: 'item.create', params: { type: 'presentation', title: 'New' } });
    expect(h.cast.mutatePatch).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      outcome: 'succeeded',
      result: { ok: true, itemId: 'item-9', changed: { presentations: { upserted: ['item-9'], deleted: [] } } },
    });
  });

  it('reports a thrown RPC error as a failure carrying its message', async () => {
    castApi.createPlaylist.mockRejectedValueOnce(new Error('database is locked'));
    const response = await dispatch();
    expect(response).toEqual({ requestId: 'r1', outcome: 'failed', error: 'database is locked' });
  });

  it('hands a filesystem import straight to main, which authorizes the path', async () => {
    // No `cast-media:` capability is minted here any more: the renderer has
    // no user gesture to base one on, and main is the side that knows which
    // roots the user granted.
    await dispatch({ actionId: 'media.import', params: { path: '/tmp/Logo.PNG' } });
    expect(castApi.agentImportMedia).toHaveBeenCalledWith({ path: '/tmp/Logo.PNG' });
    expect(castApi.createMediaAsset).not.toHaveBeenCalled();
  });

  it('flushes staged editor changes before a write', async () => {
    h.state.pendingDeckChanges = true;
    cleanup();
    render(<AgentActionDispatcher />);

    await dispatch();
    expect(h.calls.indexOf('pushDeckChanges')).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf('pushDeckChanges')).toBeLessThan(h.calls.indexOf('mutatePatch'));
  });

  it('fails the action when a staged flush throws', async () => {
    h.state.pendingDeckChanges = true;
    h.assetEditor.pushDeckChanges.mockRejectedValueOnce(new Error('theme name is empty'));
    cleanup();
    render(<AgentActionDispatcher />);

    const response = await dispatch();
    expect(response).toEqual({ requestId: 'r1', outcome: 'failed', error: 'theme name is empty' });
    expect(castApi.createPlaylist).not.toHaveBeenCalled();
  });
});

describe('media asset references', () => {
  it('resolves an agent-facing assetId to the snapshot src before calling the RPC', async () => {
    await dispatch({
      actionId: 'element.create',
      params: { slideId: 'slide-1', type: 'image', assetId: 'asset-1', x: 0, y: 0 },
    });
    expect(castApi.createElement).toHaveBeenCalledWith({
      slideId: 'slide-1',
      type: 'image',
      src: 'cast-media://token-1',
      x: 0,
      y: 0,
    });
  });

  it('fails naming an asset id the snapshot does not know', async () => {
    const response = await dispatch({
      actionId: 'element.create',
      params: { slideId: 'slide-1', type: 'image', assetId: 'asset-gone' },
    });
    expect(response).toMatchObject({ outcome: 'failed', error: expect.stringContaining('asset-gone') });
    expect(castApi.createElement).not.toHaveBeenCalled();
  });
});

describe('renderer-site execution', () => {
  it('takes the current slide through the slide context', async () => {
    const response = await dispatch({ actionId: 'slide.take', params: {} });
    expect(h.slideActions.takeSlide).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ outcome: 'succeeded', result: { slideId: 'slide-1', index: 0 } });
  });

  it('activates a slide addressed by id', async () => {
    const response = await dispatch({ actionId: 'slide.activate', params: { slideId: 'slide-2' } });
    expect(h.slideActions.activateSlide).toHaveBeenCalledWith(1);
    expect(response).toMatchObject({ result: { slideId: 'slide-2', index: 1 } });
  });

  it('rejects a slide id that is not in the loaded item', async () => {
    const response = await dispatch({ actionId: 'slide.activate', params: { slideId: 'slide-99' } });
    expect(response).toMatchObject({ outcome: 'denied', reason: 'invalid-params' });
  });

  it('rejects an out-of-range jump index', async () => {
    const response = await dispatch({ actionId: 'slide.jumpTo', params: { index: 9 } });
    expect(response).toMatchObject({ outcome: 'denied', reason: 'invalid-params' });
  });

  it('routes history verbs to the store', async () => {
    await dispatch({ actionId: 'edit.undo', params: {} });
    expect(h.cast.undo).toHaveBeenCalledTimes(1);
  });

  it('runs a macro through the automation context', async () => {
    await dispatch({ actionId: 'macro.run', params: { macroId: 'macro-1' }, decision: 'auto' });
    expect(h.automation.runMacro).toHaveBeenCalledWith('macro-1');
  });

  it('groups elements through the canvas context', async () => {
    const response = await dispatch({ actionId: 'element.group', params: { elementIds: ['el-1', 'el-2'], name: 'Logo' } });
    expect(h.elements.groupSelection).toHaveBeenCalledWith(['el-1', 'el-2'], 'Logo');
    expect(response).toMatchObject({ outcome: 'succeeded', result: { groupId: 'group-1' } });
  });

  it('fails element.group when the canvas context refuses (fewer than two groupable elements)', async () => {
    h.elements.groupSelection.mockResolvedValueOnce(null);
    const response = await dispatch({ actionId: 'element.group', params: { elementIds: ['el-1'] } });
    expect(response).toMatchObject({ outcome: 'failed' });
  });

  it('aligns elements through the canvas context, defaulting `to` from the selection size', async () => {
    const response = await dispatch({ actionId: 'element.align', params: { elementIds: ['el-1', 'el-2'], edge: 'left' } });
    expect(h.elements.alignSelection).toHaveBeenCalledWith('left', 'selection', ['el-1', 'el-2']);
    expect(response).toMatchObject({ outcome: 'succeeded', result: { elementIds: ['el-1', 'el-2'], edge: 'left', to: 'selection' } });
  });

  it('renders a slide to an image through the render-slide feature', async () => {
    const response = await dispatch({ actionId: 'slide.render', params: { slideId: 'slide-1', width: 640 } });
    expect(h.render.renderSlideToImage).toHaveBeenCalledWith('slide-1', { width: 640, height: undefined, format: undefined });
    expect(response).toMatchObject({
      outcome: 'succeeded',
      result: { slideId: 'slide-1', dataUrl: 'data:image/png;base64,xyz', width: 100, height: 100, format: 'png' },
    });
  });

  it('reports a slide.render failure with a clear message', async () => {
    const { SlideRenderError } = await import('../../../../../app/renderer/features/render/render-slide');
    h.render.renderSlideToImage.mockRejectedValueOnce(new SlideRenderError('not-found', 'No slide found for id "slide-9".'));
    const response = await dispatch({ actionId: 'slide.render', params: { slideId: 'slide-9' } });
    expect(response).toMatchObject({ outcome: 'failed', error: expect.stringContaining('slide-9') });
  });
});

describe('permission prompts', () => {
  async function dispatchAsk(overrides: Partial<AgentActionRequest> = {}) {
    const request = makeRequest({ decision: 'ask', ...overrides });
    await act(async () => { emitRequest(request); });
    await screen.findByRole('dialog');
    return request;
  }

  it('runs the action after Allow once and reports no standing grant', async () => {
    await dispatchAsk();
    expect(screen.getByText('Create playlist')).toBeInTheDocument();
    expect(screen.getByText('Sunday')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow once' })); });
    await waitFor(() => expect(responses).toHaveLength(1));

    expect(castApi.createPlaylist).toHaveBeenCalled();
    expect(responses[0]).toMatchObject({ outcome: 'succeeded' });
    expect('alwaysAllow' in responses[0]).toBe(false);
  });

  it('carries the risk class back when the user grants Always allow', async () => {
    await dispatchAsk();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Always allow write' })); });
    await waitFor(() => expect(responses).toHaveLength(1));

    expect(responses[0]).toMatchObject({ outcome: 'succeeded', alwaysAllow: 'write' });
  });

  it('denies without running the action', async () => {
    await dispatchAsk();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deny' })); });
    await waitFor(() => expect(responses).toHaveLength(1));

    expect(responses[0]).toEqual({ requestId: 'r1', outcome: 'denied', reason: 'user' });
    expect(castApi.createPlaylist).not.toHaveBeenCalled();
  });

  it('shows one prompt at a time and answers them in arrival order', async () => {
    await act(async () => {
      emitRequest(makeRequest({ requestId: 'r1', decision: 'ask' }));
      emitRequest(makeRequest({ requestId: 'r2', decision: 'ask', params: { name: 'Evening' } }));
    });
    await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('Sunday')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deny' })); });
    await waitFor(() => expect(responses).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Evening')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deny' })); });
    await waitFor(() => expect(responses.map((entry) => entry.requestId)).toEqual(['r1', 'r2']));
  });
});

describe('show-safety interlock', () => {
  it('forces a prompt for a broadcast action while an output is live', async () => {
    h.state.outputState = { audience: true, stage: false };
    cleanup();
    render(<AgentActionDispatcher />);

    await act(async () => {
      emitRequest(makeRequest({ actionId: 'slide.take', params: {}, decision: 'auto', interlockEnabled: true }));
    });
    await screen.findByRole('dialog');

    expect(screen.getByText('An output is live.')).toBeInTheDocument();
    // A standing grant is exactly what the interlock exists to prevent.
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
    expect(h.slideActions.takeSlide).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deny' })); });
    await waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual({ requestId: 'r1', outcome: 'denied', reason: 'interlock' });
  });

  it('does not force a prompt when no output is live', async () => {
    const response = await dispatch({ actionId: 'slide.take', params: {}, interlockEnabled: true });
    expect(response).toMatchObject({ outcome: 'succeeded' });
  });

  it('does not force a prompt when the principal has the interlock off', async () => {
    h.state.outputState = { audience: true, stage: false };
    cleanup();
    render(<AgentActionDispatcher />);

    const response = await dispatch({ actionId: 'slide.take', params: {}, interlockEnabled: false });
    expect(response).toMatchObject({ outcome: 'succeeded' });
  });
});

describe('batches', () => {
  it('wraps the actions between begin and end in one history batch', async () => {
    await act(async () => {
      emitBatch({ batchId: 'b1', phase: 'begin', principal: { kind: 'in-app', threadId: 'thread-1' } });
      emitRequest(makeRequest({ requestId: 'r1' }));
      emitBatch({ batchId: 'b1', phase: 'end', principal: { kind: 'in-app', threadId: 'thread-1' } });
    });
    await waitFor(() => expect(responses).toHaveLength(1));

    expect(h.calls.filter((entry) => entry.startsWith('begin') || entry === 'mutatePatch' || entry.startsWith('end')))
      .toEqual(['beginHistoryBatch', 'mutatePatch', 'endHistoryBatch']);
  });

  it('ignores a duplicate begin and an end for a batch that was never opened', async () => {
    const principal = { kind: 'in-app' as const, threadId: 'thread-1' };
    await act(async () => {
      emitBatch({ batchId: 'b1', phase: 'begin', principal });
      emitBatch({ batchId: 'b1', phase: 'begin', principal });
      emitBatch({ batchId: 'b2', phase: 'end', principal });
      emitBatch({ batchId: 'b1', phase: 'end', principal });
    });
    await waitFor(() => expect(h.cast.endHistoryBatch).toHaveBeenCalledTimes(1));
    expect(h.cast.beginHistoryBatch).toHaveBeenCalledTimes(1);
  });
});

describe('cancellation', () => {
  it('cancels a queued request without running it', async () => {
    let release!: () => void;
    castApi.createPlaylist.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve(patchWith('playlists', ['pl-1']));
    }));

    await act(async () => {
      emitRequest(makeRequest({ requestId: 'r1' }));
      emitRequest(makeRequest({ requestId: 'r2' }));
      emitCancelled({ requestId: 'r2' });
    });

    await waitFor(() => expect(responses).toContainEqual({ requestId: 'r2', outcome: 'cancelled' }));
    expect(castApi.createPlaylist).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(responses).toHaveLength(2));
  });

  it('cancels a request whose cancellation arrived before it did', async () => {
    await act(async () => { emitCancelled({ requestId: 'r1' }); });
    const response = await dispatch({ requestId: 'r1' });
    expect(response).toEqual({ requestId: 'r1', outcome: 'cancelled' });
    expect(castApi.createPlaylist).not.toHaveBeenCalled();
  });
});

describe('sequential processing', () => {
  it('runs one action at a time, in arrival order', async () => {
    const releases: (() => void)[] = [];
    castApi.createPlaylist.mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve(patchWith('playlists', ['pl-1'])));
    }));

    await act(async () => {
      emitRequest(makeRequest({ requestId: 'r1', params: { name: 'One' } }));
      emitRequest(makeRequest({ requestId: 'r2', params: { name: 'Two' } }));
      emitRequest(makeRequest({ requestId: 'r3', params: { name: 'Three' } }));
    });

    await waitFor(() => expect(castApi.createPlaylist).toHaveBeenCalledTimes(1));
    expect(castApi.createPlaylist).toHaveBeenLastCalledWith('One');

    await act(async () => { releases[0](); });
    await waitFor(() => expect(castApi.createPlaylist).toHaveBeenCalledTimes(2));
    expect(castApi.createPlaylist).toHaveBeenLastCalledWith('Two');

    await act(async () => { releases[1](); });
    await waitFor(() => expect(castApi.createPlaylist).toHaveBeenCalledTimes(3));

    await act(async () => { releases[2](); });
    await waitFor(() => expect(responses.map((entry) => entry.requestId)).toEqual(['r1', 'r2', 'r3']));
  });
});
