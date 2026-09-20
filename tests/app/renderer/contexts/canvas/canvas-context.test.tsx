import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupElementPayload, MediaAsset, RenderScene, Slide, SlideElement } from '@lumacast/composition';
import { groupElements } from '@lumacast/composition';
import { CanvasProvider, useElements, useThumbnailScene } from '../../../../../app/renderer/contexts/canvas/canvas-context';

const mocks = vi.hoisted(() => {
  const slideA = {
    id: 'slide-a',
    background: null,
  };
  const slideB = {
    id: 'slide-b',
    background: null,
  };
  const elementA: SlideElement = {
    id: 'element-a',
    slideId: 'slide-a',
    type: 'shape',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: {
      fillEnabled: true,
      fillColor: '#FFFFFF',
      strokeEnabled: false,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as never;
  const elementB: SlideElement = {
    ...elementA,
    id: 'element-b',
    slideId: 'slide-b',
    x: 10,
  } as SlideElement;

  function createEditorSource(slideId: 'slide-a' | 'slide-b') {
    const slide = slideId === 'slide-a' ? slideA : slideB;
    const elements = slideId === 'slide-a' ? [elementA] : [elementB];
    return {
      mode: 'item-editor' as const,
      editable: true,
      hasSource: true,
      entityId: slideId,
      historyKey: slideId,
      frame: slide,
      elements,
      replaceElements: vi.fn(),
      meta: {
        slideId,
      },
    };
  }

  return {
    activeEditorSource: createEditorSource('slide-a'),
    slideA,
    slideB,
    replaceSlideElements: vi.fn(),
    setStatusText: vi.fn(),
    mutatePatch: vi.fn(),
    selectionState: {
      primarySelectedElementId: null,
      selectedElementIds: [],
      selectedElement: null,
      selectElement: vi.fn(),
      selectElements: vi.fn(),
      toggleElementSelection: vi.fn(),
      clearSelection: vi.fn(),
    },
    inspectorState: {
      elementDraft: null,
      elementPayloadDraft: null,
      lockAspectRatio: false,
      setElementDraft: vi.fn(),
      setElementPayloadDraft: vi.fn(),
      setLockAspectRatio: vi.fn(),
    },
    historyState: {
      commitElementUpdates: vi.fn().mockResolvedValue(undefined),
      nudgeSelection: vi.fn(),
      copySelection: vi.fn(),
      pasteSelection: vi.fn().mockResolvedValue(undefined),
      duplicateSelection: vi.fn().mockResolvedValue(undefined),
      undo: vi.fn(),
      redo: vi.fn(),
      pushHistorySnapshot: vi.fn(),
    },
    elementCommands: {
      createText: vi.fn(),
      createShape: vi.fn(),
      createFromMedia: vi.fn(),
      createOverlay: vi.fn(),
      toggleOverlay: vi.fn(),
      importMedia: vi.fn(),
      deleteMedia: vi.fn(),
      changeMediaSrc: vi.fn(),
    },
    mediaAssets: [] as MediaAsset[],
    liveSlidesById: new Map<string, Slide>([
      ['slide-a', slideA as Slide],
      ['slide-b', slideB as Slide],
    ]),
    liveElementsBySlideId: new Map<string, SlideElement[]>(),
    currentItemRef: null as { id: string; type: 'presentation' | 'lyric' } | null,
  };
});

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.mutatePatch,
    setStatusText: mocks.setStatusText,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentItemRef: mocks.currentItemRef,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useDeckEditor: () => ({
    getSlideElements: vi.fn(() => []),
    replaceSlideElements: mocks.replaceSlideElements,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback/playback-context', () => ({
  usePresentationRenderLayer: () => ({
    mediaLayerAsset: null,
    videoLayerAsset: null,
    videoLayerPlayback: {
      autoplay: true,
      loop: true,
      muted: false,
      playbackRate: 1,
    },
    activeOverlays: [],
    contentLayerVisible: true,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    currentSlide: mocks.slideB,
    liveSlide: mocks.slideB,
    liveElements: [],
    slideElementsById: new Map([
      ['slide-a', [mocks.activeEditorSource.elements[0]]],
      ['slide-b', [{ ...mocks.activeEditorSource.elements[0], id: 'slide-b-view', slideId: 'slide-b' }]],
    ]),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({
    slides: [mocks.slideA, mocks.slideB],
    slideElementsBySlideId: new Map(),
    liveSlidesById: mocks.liveSlidesById,
    liveSlideElementsBySlideId: mocks.liveElementsBySlideId,
    mediaAssets: mocks.mediaAssets,
    resolveElementsForSlide: (_slideId: string, elements: SlideElement[]) => elements,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: {
      workbenchMode: 'edit',
    },
  }),
}));

vi.mock('../../../../../app/renderer/contexts/timers/timers-context', () => ({
  useTimers: () => ({ readings: {} }),
}));

vi.mock('../../../../../app/renderer/contexts/canvas/use-active-editor-source', () => ({
  useActiveEditorSource: () => mocks.activeEditorSource,
}));

vi.mock('../../../../../app/renderer/contexts/element/use-element-commands', () => ({
  useElementCommands: () => mocks.elementCommands,
}));

vi.mock('../../../../../app/renderer/contexts/element/use-element-history', () => ({
  useElementHistory: () => mocks.historyState,
}));

vi.mock('../../../../../app/renderer/contexts/element/use-element-inspector-sync', () => ({
  useElementInspectorSync: () => mocks.inspectorState,
}));

vi.mock('@lumacast/canvas', () => ({
  useElementSelection: () => mocks.selectionState,
}));

vi.mock('../../../../../app/renderer/features/canvas/build-render-scene', () => ({
  buildRenderScene: (frame: { id: string } | null, elements: SlideElement[]) => ({
    sceneId: frame?.id ?? 'empty',
    slide: frame ?? { id: 'empty', background: null },
    width: 1920,
    height: 1080,
    nodes: elements,
  }),
  buildLayeredRenderScene: ({ slide, overlays }: { slide: { id: string } | null; overlays: unknown[] }) => ({
    sceneId: slide?.id ?? 'empty',
    slide: slide ?? { id: 'empty', background: null },
    width: 1920,
    height: 1080,
    nodes: overlays,
  }),
  buildThumbnailScene: (
    slide: { id: string; background?: unknown } | null,
    elements: SlideElement[],
    options: { proxyMediaBySource?: ReadonlyMap<string, string> } = {},
  ) => (
    slide ? {
      sceneId: slide.id,
      slide,
      width: 640,
      height: 360,
      nodes: elements.map((element) => {
        const src = element.type === 'image' || element.type === 'video'
          ? (element.payload as { src?: string }).src ?? null
          : null;
        return {
          id: element.id,
          element,
          proxyMediaKey: src ? options.proxyMediaBySource?.get(src) ?? null : null,
        };
      }),
    } : null
  ),
}));

function Probe({ onReady }: { onReady: (value: ReturnType<typeof useElements>) => void }) {
  const elements = useElements();

  useEffect(() => {
    onReady(elements);
  }, [elements, onReady]);

  return null;
}

function Harness({ onReady }: { onReady: (value: ReturnType<typeof useElements>) => void }) {
  return (
    <CanvasProvider>
      <Probe onReady={onReady} />
    </CanvasProvider>
  );
}

function StrictHarness({ onReady }: { onReady: (value: ReturnType<typeof useElements>) => void }) {
  return (
    <StrictMode>
      <Harness onReady={onReady} />
    </StrictMode>
  );
}

function ThumbnailProbe({ onReady }: { onReady: (value: ReturnType<typeof useThumbnailScene>) => void }) {
  const getThumbnailScene = useThumbnailScene();

  useEffect(() => {
    onReady(getThumbnailScene);
  }, [getThumbnailScene, onReady]);

  return null;
}

function ThumbnailHarness({ onReady }: { onReady: (value: ReturnType<typeof useThumbnailScene>) => void }) {
  return (
    <CanvasProvider>
      <ThumbnailProbe onReady={onReady} />
    </CanvasProvider>
  );
}

describe('CanvasProvider deck slide snapshots', () => {
  beforeEach(() => {
    mocks.activeEditorSource = {
      ...mocks.activeEditorSource,
      mode: 'item-editor',
      editable: true,
      hasSource: true,
      entityId: 'slide-a',
      historyKey: 'slide-a',
      frame: mocks.slideA,
      elements: [{
        ...mocks.activeEditorSource.elements[0],
        id: 'element-a',
        slideId: 'slide-a',
        x: 0,
      }],
      replaceElements: vi.fn(),
      meta: { slideId: 'slide-a' },
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('commits the latest draft when a slide switch lands in the same render batch', () => {
    let latestElements: ReturnType<typeof useElements> | null = null;
    const onReady = (value: ReturnType<typeof useElements>) => {
      latestElements = value;
    };

    const view = render(<Harness onReady={onReady} />);

    expect(latestElements).not.toBeNull();

    act(() => {
      latestElements?.setDraftElements((current) => ({
        ...current,
        'element-a': { x: 48 },
      }));
      mocks.activeEditorSource = {
        ...mocks.activeEditorSource,
        entityId: 'slide-b',
        historyKey: 'slide-b',
        frame: mocks.slideB,
        elements: [{
          ...mocks.activeEditorSource.elements[0],
          id: 'element-b',
          slideId: 'slide-b',
          x: 10,
        }],
        replaceElements: vi.fn(),
        meta: { slideId: 'slide-b' },
      };
      view.rerender(<Harness onReady={onReady} />);
    });

    expect(mocks.replaceSlideElements).toHaveBeenCalledWith(
      'slide-a',
      [expect.objectContaining({ id: 'element-a', slideId: 'slide-a', x: 48 })],
    );
  });

  it('keeps the latest draft snapshot replay-safe under StrictMode', () => {
    let latestElements: ReturnType<typeof useElements> | null = null;
    const onReady = (value: ReturnType<typeof useElements>) => {
      latestElements = value;
    };

    const view = render(<StrictHarness onReady={onReady} />);

    act(() => {
      latestElements?.setDraftElements((current) => ({
        ...current,
        'element-a': { x: 64 },
      }));
      mocks.activeEditorSource = {
        ...mocks.activeEditorSource,
        entityId: 'slide-b',
        historyKey: 'slide-b',
        frame: mocks.slideB,
        elements: [{
          ...mocks.activeEditorSource.elements[0],
          id: 'element-b',
          slideId: 'slide-b',
          x: 10,
        }],
        replaceElements: vi.fn(),
        meta: { slideId: 'slide-b' },
      };
      view.rerender(<StrictHarness onReady={onReady} />);
    });

    expect(mocks.replaceSlideElements).toHaveBeenCalledWith(
      'slide-a',
      [expect.objectContaining({ id: 'element-a', slideId: 'slide-a', x: 64 })],
    );
  });
});

describe('CanvasProvider thumbnail scene cache', () => {
  const mediaSrc = 'cast-media://image-source';
  const thumbnailSrc = 'cast-media://image-thumbnail';
  const imageElement: SlideElement = {
    ...mocks.activeEditorSource.elements[0],
    id: 'image-element',
    slideId: 'slide-a',
    type: 'image',
    payload: { src: mediaSrc },
  } as SlideElement;

  beforeEach(() => {
    mocks.mediaAssets = [];
    mocks.liveSlidesById = new Map<string, Slide>([
      ['slide-a', mocks.slideA as Slide],
      ['slide-b', mocks.slideB as Slide],
    ]);
    mocks.liveElementsBySlideId = new Map([['slide-a', [imageElement]]]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('rebuilds a cached thumbnail scene when a media derivative becomes available', () => {
    let getThumbnailScene!: ReturnType<typeof useThumbnailScene>;
    const onReady = (value: ReturnType<typeof useThumbnailScene>) => {
      getThumbnailScene = value;
    };
    const view = render(<ThumbnailHarness onReady={onReady} />);

    const first = getThumbnailScene('slide-a', 'list') as RenderScene | null;
    expect(first?.nodes[0]?.proxyMediaKey).toBeNull();

    mocks.mediaAssets = [{
      id: 'image-asset',
      name: 'Image',
      type: 'image',
      src: mediaSrc,
      thumbnailSrc,
      width: 1920,
      height: 1080,
      duration: null,
      codec: null,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as MediaAsset];
    view.rerender(<ThumbnailHarness onReady={onReady} />);

    const refreshed = getThumbnailScene('slide-a', 'list') as RenderScene | null;
    expect(refreshed?.nodes[0]?.proxyMediaKey).toBe(thumbnailSrc);
  });

  it('rebuilds a cached thumbnail scene when the resolved slide frame changes', () => {
    let getThumbnailScene!: ReturnType<typeof useThumbnailScene>;
    const onReady = (value: ReturnType<typeof useThumbnailScene>) => {
      getThumbnailScene = value;
    };
    const view = render(<ThumbnailHarness onReady={onReady} />);

    const first = getThumbnailScene('slide-a', 'list') as RenderScene | null;
    expect(first?.slide.background).toBeNull();

    const resolvedFrame = {
      ...mocks.slideA,
      background: { type: 'color' as const, color: '#123456' },
    };
    mocks.liveSlidesById = new Map<string, Slide>([
      ['slide-a', resolvedFrame as Slide],
      ['slide-b', mocks.slideB as Slide],
    ]);
    view.rerender(<ThumbnailHarness onReady={onReady} />);

    const refreshed = getThumbnailScene('slide-a', 'list') as RenderScene | null;
    expect(refreshed?.slide.background).toEqual({ type: 'color', color: '#123456' });
  });
});

describe('CanvasProvider group/ungroup/align/distribute', () => {
  function makeShape(overrides: Partial<SlideElement> = {}): SlideElement {
    return {
      id: 'el',
      slideId: 'slide-a',
      type: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      payload: {
        fillEnabled: true,
        fillColor: '#FFFFFF',
        strokeEnabled: false,
        locked: false,
        visible: true,
        flipX: false,
        flipY: false,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as SlideElement;
  }

  function setEditorElements(elements: SlideElement[]) {
    mocks.activeEditorSource = {
      mode: 'item-editor' as const,
      editable: true,
      hasSource: true,
      entityId: 'slide-a',
      historyKey: 'slide-a',
      frame: mocks.slideA,
      elements,
      replaceElements: vi.fn(),
      meta: { slideId: 'slide-a' },
    };
  }

  async function renderElements(): Promise<ReturnType<typeof useElements>> {
    let latest!: ReturnType<typeof useElements>;
    render(<Harness onReady={(value) => { latest = value; }} />);
    return latest;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.historyState.commitElementUpdates.mockResolvedValue(undefined);
    mocks.currentItemRef = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('groups ≥2 elements into one group with correct children/coords, as one history entry', async () => {
    const a = makeShape({ id: 'a', x: 10, y: 20, width: 100, height: 50, zIndex: 0 });
    const b = makeShape({ id: 'b', x: 200, y: 10, width: 40, height: 40, zIndex: 1 });
    setEditorElements([a, b]);
    const elements = await renderElements();

    let groupId: string | null = null;
    await act(async () => {
      groupId = await elements.groupSelection(['a', 'b']);
    });

    expect(groupId).not.toBeNull();
    expect(mocks.historyState.pushHistorySnapshot).toHaveBeenCalledTimes(1);
    const replaceElements = mocks.activeEditorSource.replaceElements as ReturnType<typeof vi.fn>;
    expect(replaceElements).toHaveBeenCalledTimes(1);
    const nextElements = replaceElements.mock.calls[0][0] as SlideElement[];
    expect(nextElements).toHaveLength(1);

    const group = nextElements[0];
    expect(group.id).toBe(groupId);
    expect(group.type).toBe('group');
    expect(group.x).toBe(10);
    expect(group.y).toBe(10);
    expect(group.width).toBe(230);
    expect(group.height).toBe(60);

    const children = (group.payload as GroupElementPayload).children;
    expect(children.map((c) => c.id).sort()).toEqual(['a', 'b']);
    const childA = children.find((c) => c.id === 'a')!;
    expect(childA.x).toBe(0);
    expect(childA.y).toBe(10);

    expect(mocks.selectionState.selectElements).toHaveBeenCalledWith([groupId]);
  });

  it('excludes locked elements; fewer than 2 groupable elements is a no-op', async () => {
    const a = makeShape({ id: 'a' });
    const lockedB = makeShape({ id: 'b', x: 200, payload: { ...a.payload, locked: true } });
    setEditorElements([a, lockedB]);
    const elements = await renderElements();

    const result = await elements.groupSelection(['a', 'b']);

    expect(result).toBeNull();
    expect(mocks.historyState.pushHistorySnapshot).not.toHaveBeenCalled();
    expect(mocks.activeEditorSource.replaceElements).not.toHaveBeenCalled();
  });

  it('excludes protected lyric text elements from grouping', async () => {
    mocks.currentItemRef = { id: 'item-1', type: 'lyric' };
    const lyricText = makeShape({
      id: 'a',
      type: 'text',
      payload: { text: 'Verse', fontFamily: 'Inter', fontSize: 32, color: '#fff', alignment: 'left', locked: false, visible: true } as never,
    });
    const shape = makeShape({ id: 'b', x: 300 });
    setEditorElements([lyricText, shape]);
    const elements = await renderElements();

    const result = await elements.groupSelection(['a', 'b']);

    expect(result).toBeNull();
    expect(mocks.historyState.pushHistorySnapshot).not.toHaveBeenCalled();
  });

  it('is a no-op with fewer than 2 elements selected', async () => {
    const a = makeShape({ id: 'a' });
    setEditorElements([a]);
    const elements = await renderElements();

    const result = await elements.groupSelection(['a']);

    expect(result).toBeNull();
    expect(mocks.historyState.pushHistorySnapshot).not.toHaveBeenCalled();
  });

  it('ungroups a group back into independent top-level elements, as one history entry', async () => {
    const a = makeShape({ id: 'a', x: 10, y: 20, width: 100, height: 50 });
    const b = makeShape({ id: 'b', x: 200, y: 10, width: 40, height: 40 });
    const group = groupElements([a, b], { id: 'group-1', zIndex: 5 });
    setEditorElements([group]);
    const elements = await renderElements();

    let ids: string[] = [];
    await act(async () => {
      ids = await elements.ungroupSelection('group-1');
    });

    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(mocks.historyState.pushHistorySnapshot).toHaveBeenCalledTimes(1);
    const replaceElements = mocks.activeEditorSource.replaceElements as ReturnType<typeof vi.fn>;
    expect(replaceElements).toHaveBeenCalledTimes(1);
    const nextElements = replaceElements.mock.calls[0][0] as SlideElement[];
    expect(nextElements).toHaveLength(2);

    const restoredA = nextElements.find((el) => el.id === 'a')!;
    expect(restoredA.x).toBeCloseTo(a.x, 6);
    expect(restoredA.y).toBeCloseTo(a.y, 6);
    const restoredB = nextElements.find((el) => el.id === 'b')!;
    expect(restoredB.x).toBeCloseTo(b.x, 6);
    expect(restoredB.y).toBeCloseTo(b.y, 6);

    expect(mocks.selectionState.selectElements).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']));
  });

  it('does not ungroup a locked group', async () => {
    const a = makeShape({ id: 'a' });
    const group = groupElements([a], { id: 'group-1', zIndex: 0 });
    const lockedGroup = { ...group, payload: { ...group.payload, locked: true } };
    setEditorElements([lockedGroup]);
    const elements = await renderElements();

    const ids = await elements.ungroupSelection('group-1');

    expect(ids).toEqual([]);
    expect(mocks.historyState.pushHistorySnapshot).not.toHaveBeenCalled();
  });

  it('does not ungroup a non-group element or a missing id', async () => {
    const a = makeShape({ id: 'a' });
    setEditorElements([a]);
    const elements = await renderElements();

    expect(await elements.ungroupSelection('a')).toEqual([]);
    expect(await elements.ungroupSelection('missing')).toEqual([]);
    expect(mocks.historyState.pushHistorySnapshot).not.toHaveBeenCalled();
  });

  it('aligns ≥2 selected elements to each other (selection target)', async () => {
    const a = makeShape({ id: 'a', x: 10, y: 30, width: 100, height: 40 });
    const b = makeShape({ id: 'b', x: 400, y: 300, width: 60, height: 20 });
    setEditorElements([a, b]);
    const elements = await renderElements();

    await act(async () => {
      await elements.alignSelection('left', 'selection', ['a', 'b']);
    });

    expect(mocks.historyState.commitElementUpdates).toHaveBeenCalledTimes(1);
    const [updates, withHistory] = mocks.historyState.commitElementUpdates.mock.calls[0];
    expect(withHistory).toBe(true);
    // union left edge is min(10, 400) = 10; a is already there, only b moves.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 'b', x: 10 });
  });

  it('aligns a single selected element to the slide when only 1 is selected', async () => {
    const a = makeShape({ id: 'a', x: 500, y: 30, width: 100, height: 40 });
    setEditorElements([a]);
    const elements = await renderElements();

    await act(async () => {
      await elements.alignSelection('left', 'slide', ['a']);
    });

    expect(mocks.historyState.commitElementUpdates).toHaveBeenCalledTimes(1);
    const [updates] = mocks.historyState.commitElementUpdates.mock.calls[0];
    expect(updates).toEqual([{ id: 'a', x: 0, y: 30 }]);
  });

  it('is a no-op for a single element aligned to the selection', async () => {
    const a = makeShape({ id: 'a' });
    setEditorElements([a]);
    const elements = await renderElements();

    await elements.alignSelection('left', 'selection', ['a']);

    expect(mocks.historyState.commitElementUpdates).not.toHaveBeenCalled();
  });

  it('excludes locked elements from alignment', async () => {
    const a = makeShape({ id: 'a', x: 10 });
    const lockedB = makeShape({ id: 'b', x: 400, payload: { ...a.payload, locked: true } });
    setEditorElements([a, lockedB]);
    const elements = await renderElements();

    await elements.alignSelection('left', 'selection', ['a', 'b']);

    // only 'a' survives the locked filter, and a single element can't align
    // to "the selection" — a no-op, same as passing a single id directly.
    expect(mocks.historyState.commitElementUpdates).not.toHaveBeenCalled();
  });

  it('distributes ≥3 selected elements evenly along an axis', async () => {
    const a = makeShape({ id: 'a', x: 0, width: 20 });
    const b = makeShape({ id: 'b', x: 500, width: 40 });
    const c = makeShape({ id: 'c', x: 1000, width: 60 });
    setEditorElements([a, b, c]);
    const elements = await renderElements();

    await act(async () => {
      await elements.distributeSelection('horizontal', ['a', 'b', 'c']);
    });

    expect(mocks.historyState.commitElementUpdates).toHaveBeenCalledTimes(1);
    const [updates, withHistory] = mocks.historyState.commitElementUpdates.mock.calls[0];
    expect(withHistory).toBe(true);
    // first/last stay fixed; only the middle element (b) may move.
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('b');
  });

  it('is a no-op for fewer than 3 selected elements', async () => {
    const a = makeShape({ id: 'a' });
    const b = makeShape({ id: 'b', x: 100 });
    setEditorElements([a, b]);
    const elements = await renderElements();

    await elements.distributeSelection('horizontal', ['a', 'b']);

    expect(mocks.historyState.commitElementUpdates).not.toHaveBeenCalled();
  });
});
