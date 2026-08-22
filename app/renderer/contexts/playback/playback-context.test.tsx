import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackProvider, usePresentationLayers, usePresentationRenderLayer, useProgramOverlayPlayback } from './playback-context';

const mocks = vi.hoisted(() => ({
  setStatusText: vi.fn(),
  clearOutputItem: vi.fn(),
  mediaAssetsById: new Map(),
  overlaysById: new Map<string, unknown>(),
  retainHandle: {
    setOptions: vi.fn(),
    release: vi.fn(),
  },
  overlay: {
    id: 'overlay-1',
    slideId: 'overlay-slide',
    name: 'Overlay 1',
    enabled: true,
    order: 0,
    elements: [
      {
        id: 'overlay-node-1',
        slideId: 'overlay-slide',
        type: 'shape',
        x: 0,
        y: 0,
        width: 300,
        height: 180,
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
      },
    ],
    animation: { kind: 'dissolve', durationMs: 400, autoClearDurationMs: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
}));

vi.mock('../app-context', () => ({
  useCast: () => ({
    setStatusText: mocks.setStatusText,
  }),
}));

vi.mock('../navigation-context', () => ({
  useNavigation: () => ({
    currentOutputItemRef: { id: 'item-1', type: 'presentation' },
    outputArmVersion: 0,
    clearOutputItem: mocks.clearOutputItem,
  }),
}));

vi.mock('../use-project-content', () => ({
  useProjectContent: () => ({
    mediaAssets: [],
    mediaAssetsById: mocks.mediaAssetsById,
    overlaysById: mocks.overlaysById,
  }),
}));

vi.mock('@lumacast/canvas', () => ({
  getLayerVideoElement: vi.fn(() => null),
  retainVideoSource: vi.fn(() => mocks.retainHandle),
  subscribeToVideoPool: vi.fn(() => () => {}),
}));

vi.mock('../../features/playback/ndi-audio-capture', () => ({
  addNdiAudioElement: vi.fn(),
  removeNdiAudioElement: vi.fn(),
}));

vi.mock('../../features/observability/metrics-store', () => ({
  recordObsEvent: vi.fn(),
}));

function RenderLayerProbe({ onRender }: { onRender: () => void }) {
  usePresentationRenderLayer();
  onRender();
  return null;
}

function LayersProbe({ onRender }: { onRender: () => void }) {
  usePresentationLayers();
  onRender();
  return null;
}

function ProgramOverlayProbe({ onRender }: { onRender: () => void }) {
  useProgramOverlayPlayback();
  onRender();
  return null;
}

function Controls({ onReady }: { onReady: (activate: (overlayId: string) => void) => void }) {
  const { activateOverlay } = usePresentationLayers();

  useEffect(() => {
    onReady(activateOverlay);
  }, [activateOverlay, onReady]);

  return null;
}

function Harness({
  onRenderLayerRender,
  onLayersRender,
  onProgramOverlayRender,
  onReady,
}: {
  onRenderLayerRender: () => void;
  onLayersRender: () => void;
  onProgramOverlayRender: () => void;
  onReady: (activate: (overlayId: string) => void) => void;
}) {
  return (
    <PlaybackProvider>
      <LayersProbe onRender={onLayersRender} />
      <RenderLayerProbe onRender={onRenderLayerRender} />
      <ProgramOverlayProbe onRender={onProgramOverlayRender} />
      <Controls onReady={onReady} />
    </PlaybackProvider>
  );
}

describe('PlaybackProvider overlay timing isolation', () => {
  const rafQueue = new Map<number, FrameRequestCallback>();
  let nextAnimationFrameId = 0;
  let nowMs = 0;

  beforeEach(() => {
    cleanup();
    mocks.overlaysById.clear();
    mocks.overlaysById.set(mocks.overlay.id, mocks.overlay);
    vi.useFakeTimers();
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      nextAnimationFrameId += 1;
      rafQueue.set(nextAnimationFrameId, callback);
      return nextAnimationFrameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafQueue.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    rafQueue.clear();
    nextAnimationFrameId = 0;
    nowMs = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-renders only the program overlay timing consumer on animation frames', () => {
    let layersRenders = 0;
    let renderLayerRenders = 0;
    let programOverlayRenders = 0;
    let activateOverlay: ((overlayId: string) => void) | null = null;

    render(
      <Harness
        onLayersRender={() => { layersRenders += 1; }}
        onRenderLayerRender={() => { renderLayerRenders += 1; }}
        onProgramOverlayRender={() => { programOverlayRenders += 1; }}
        onReady={(activate) => { activateOverlay = activate; }}
      />,
    );

    expect(layersRenders).toBe(1);
    expect(renderLayerRenders).toBe(1);
    expect(programOverlayRenders).toBe(1);
    expect(activateOverlay).not.toBeNull();

    act(() => {
      activateOverlay?.('overlay-1');
    });

    expect(layersRenders).toBe(2);
    expect(renderLayerRenders).toBe(2);
    expect(programOverlayRenders).toBe(2);
    expect(rafQueue.size).toBe(1);

    const [frameId, callback] = Array.from(rafQueue.entries())[0]!;
    rafQueue.delete(frameId);

    act(() => {
      nowMs = 120;
      callback(nowMs);
    });

    expect(layersRenders).toBe(2);
    expect(renderLayerRenders).toBe(2);
    expect(programOverlayRenders).toBe(3);
  });
});
