import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderScene } from '@lumacast/composition';
import { useProgramOutput } from './use-program-output';

function buildOverlayRenderNodeId(overlayId: string, stackOrder: number, elementId: string): string {
  return `${overlayId}::${stackOrder}::${elementId}`;
}

const mocks = vi.hoisted(() => {
  const programScene: RenderScene = {
    slide: { background: null } as never,
    width: 1920,
    height: 1080,
    nodes: [
      {
        id: buildOverlayRenderNodeId('overlay-1', 0, 'overlay-node-1'),
        element: {
          id: 'overlay-node-1',
          slideId: 'overlay-slide',
          type: 'shape',
          x: 0,
          y: 0,
          width: 300,
          height: 180,
          rotation: 0,
          opacity: 0.8,
          zIndex: 10,
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
        } as never,
        visual: { visible: true, locked: false, flipX: false, flipY: false } as never,
        isVideo: false,
      },
      {
        id: buildOverlayRenderNodeId('overlay-2', 1, 'overlay-node-1'),
        element: {
          id: 'overlay-node-1',
          slideId: 'overlay-slide',
          type: 'shape',
          x: 10,
          y: 10,
          width: 300,
          height: 180,
          rotation: 0,
          opacity: 0.6,
          zIndex: 11,
          layer: 'content',
          payload: {
            fillEnabled: true,
            fillColor: '#FF0000',
            strokeEnabled: false,
            locked: false,
            visible: true,
            flipX: false,
            flipY: false,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
        visual: { visible: true, locked: false, flipX: false, flipY: false } as never,
        isVideo: false,
      },
      {
        id: 'content-node-1',
        element: {
          id: 'overlay-node-1',
          slideId: 'slide-1',
          type: 'shape',
          x: 20,
          y: 30,
          width: 400,
          height: 200,
          rotation: 0,
          opacity: 0.9,
          zIndex: 0,
          layer: 'content',
          payload: {
            fillEnabled: true,
            fillColor: '#00FF00',
            strokeEnabled: false,
            locked: false,
            visible: true,
            flipX: false,
            flipY: false,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
        visual: { visible: true, locked: false, flipX: false, flipY: false } as never,
        isVideo: false,
      },
    ],
  };

  return {
    outputConfigs: { audience: { withAlpha: false } },
    currentOutputItemRef: { id: 'item-1', type: 'presentation' },
    liveSlide: { id: 'slide-1' },
    programScene,
    activeOverlays: [
      {
        overlayId: 'overlay-1',
        overlay: {
          id: 'overlay-1',
          slideId: 'overlay-slide',
          name: 'Overlay 1',
          enabled: true,
          order: 0,
          elements: [{ id: 'overlay-node-1' } as never],
          animation: { kind: 'dissolve', durationMs: 400, autoClearDurationMs: null },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
        opacityMultiplier: 0.5,
        name: 'Overlay 1',
        state: 'entering',
        startedAt: 0,
        remainingAutoClearMs: null,
        stackOrder: 0,
      },
      {
        overlayId: 'overlay-2',
        overlay: {
          id: 'overlay-2',
          slideId: 'overlay-slide',
          name: 'Overlay 2',
          enabled: true,
          order: 1,
          elements: [{ id: 'overlay-node-1' } as never],
          animation: { kind: 'dissolve', durationMs: 400, autoClearDurationMs: null },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
        opacityMultiplier: 0.25,
        name: 'Overlay 2',
        state: 'exiting',
        startedAt: 50,
        remainingAutoClearMs: null,
        stackOrder: 1,
      },
    ],
  };
});

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: {
      outputConfigs: mocks.outputConfigs,
    },
  }),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentOutputItemRef: mocks.currentOutputItemRef,
  }),
}));

vi.mock('../../contexts/slide-context', () => ({
  useSlides: () => ({
    liveSlide: mocks.liveSlide,
  }),
}));

vi.mock('../../contexts/canvas/canvas-context', () => ({
  useProgramScene: () => mocks.programScene,
}));

vi.mock('../../contexts/playback/playback-context', () => ({
  useProgramOverlayPlayback: () => ({
    activeOverlays: mocks.activeOverlays,
  }),
}));

describe('useProgramOutput overlay opacity', () => {
  beforeEach(() => {
    mocks.activeOverlays = [
      {
        overlayId: 'overlay-1',
        overlay: mocks.activeOverlays[0]!.overlay,
        opacityMultiplier: 0.5,
        name: 'Overlay 1',
        state: 'entering',
        startedAt: 0,
        remainingAutoClearMs: null,
        stackOrder: 0,
      },
      {
        overlayId: 'overlay-2',
        overlay: mocks.activeOverlays[1]!.overlay,
        opacityMultiplier: 0.25,
        name: 'Overlay 2',
        state: 'exiting',
        startedAt: 50,
        remainingAutoClearMs: null,
        stackOrder: 1,
      },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it('applies the overlay opacity multiplier on the program output path without touching unrelated nodes', () => {
    const { result } = renderHook(() => useProgramOutput());

    expect(result.current.scene.nodes[0]?.element.opacity).toBeCloseTo(0.4);
    expect(result.current.scene.nodes[1]?.element.opacity).toBeCloseTo(0.15);
    expect(result.current.scene.nodes[2]?.element.opacity).toBe(0.9);
  });

  it('keeps stacked overlay instances isolated even when they reuse the same bare element id', () => {
    const { result } = renderHook(() => useProgramOutput());

    expect(result.current.scene.nodes.slice(0, 2).map((node) => node.element.opacity)).toEqual([0.4, 0.15]);
  });

  it('applies exiting overlay opacity only to the exiting overlay-scoped node', () => {
    const { result } = renderHook(() => useProgramOutput());

    expect(
      result.current.scene.nodes.find(
        (node) => node.id === buildOverlayRenderNodeId('overlay-2', 1, 'overlay-node-1'),
      )?.element.opacity,
    ).toBeCloseTo(0.15);
  });

  it('recomputes the program scene when timed overlay opacity changes without changing the base program scene', () => {
    const { result, rerender } = renderHook(() => useProgramOutput());
    const initialScene = result.current.scene;

    mocks.activeOverlays = [
      {
        ...mocks.activeOverlays[0]!,
        opacityMultiplier: 0.25,
      },
      mocks.activeOverlays[1]!,
    ];

    rerender();

    expect(result.current.scene).not.toBe(initialScene);
    expect(result.current.scene.nodes[0]?.element.opacity).toBeCloseTo(0.2);
    expect(mocks.programScene.nodes[0]?.element.opacity).toBe(0.8);
  });
});
