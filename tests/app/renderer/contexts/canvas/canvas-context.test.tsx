import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAsset, RenderScene, Slide, SlideElement } from '@lumacast/composition';
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
    currentItemRef: null,
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
