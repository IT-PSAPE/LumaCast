import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlideElement } from '@lumacast/composition';
import { CanvasProvider, useElements } from './canvas-context';

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
  };
});

vi.mock('../app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.mutatePatch,
    setStatusText: mocks.setStatusText,
  }),
}));

vi.mock('../navigation-context', () => ({
  useNavigation: () => ({
    currentItemRef: null,
  }),
}));

vi.mock('../asset-editor/asset-editor-context', () => ({
  useDeckEditor: () => ({
    getSlideElements: vi.fn(() => []),
    replaceSlideElements: mocks.replaceSlideElements,
  }),
}));

vi.mock('../playback/playback-context', () => ({
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

vi.mock('../slide-context', () => ({
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

vi.mock('../use-project-content', () => ({
  useProjectContent: () => ({
    slides: [mocks.slideA, mocks.slideB],
    slideElementsBySlideId: new Map(),
    mediaAssets: [],
  }),
}));

vi.mock('../workbench-context', () => ({
  useWorkbench: () => ({
    state: {
      workbenchMode: 'edit',
    },
  }),
}));

vi.mock('./use-active-editor-source', () => ({
  useActiveEditorSource: () => mocks.activeEditorSource,
}));

vi.mock('../element/use-element-commands', () => ({
  useElementCommands: () => mocks.elementCommands,
}));

vi.mock('../element/use-element-history', () => ({
  useElementHistory: () => mocks.historyState,
}));

vi.mock('../element/use-element-inspector-sync', () => ({
  useElementInspectorSync: () => mocks.inspectorState,
}));

vi.mock('@lumacast/canvas', () => ({
  useElementSelection: () => mocks.selectionState,
}));

vi.mock('../../features/canvas/build-render-scene', () => ({
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
  buildThumbnailScene: (slide: { id: string } | null, _elements: SlideElement[], _surface: string) => (
    slide ? {
      sceneId: slide.id,
      slide,
      width: 640,
      height: 360,
      nodes: [],
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
