import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMultiview } from '../../../../apps/stream/renderer/features/multiview/use-multiview';
import type { StreamProject } from '../../../../apps/stream/shared/desktop-api';

const projectorWindowMocks = vi.hoisted(() => ({
  closeProjectorWindow: vi.fn(),
  createProjectorWindowSession: vi.fn(() => ({ popup: null, stream: null, animationFrameId: null, watcherId: null, generation: 0 })),
  openCanvasProjector: vi.fn(() => true),
}));

const multiviewWindowMocks = vi.hoisted(() => ({
  multiviewTileCapacityFor: vi.fn(() => 8 as const),
  openMultiviewWindow: vi.fn(),
}));

vi.mock('../../../../apps/stream/renderer/projector-window', () => projectorWindowMocks);
vi.mock('../../../../apps/stream/renderer/multiview-window', () => multiviewWindowMocks);

function makeProject(frameRate: number, studioMode = true): StreamProject {
  return {
    version: 1,
    output: { frameRate } as StreamProject['output'],
    studioMode,
    activeSceneId: 'preview',
    liveSceneId: 'program',
    hotkeys: {} as StreamProject['hotkeys'],
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [],
  };
}

function setup(programFrameRate: number | null, studioMode = true) {
  const project = makeProject(60, studioMode);
  const previewCanvas = document.createElement('canvas');
  const programCanvas = document.createElement('canvas');
  const setActionError = vi.fn();
  const { result, rerender } = renderHook(
    ({ committedFrameRate }: { committedFrameRate: number | null }) => useMultiview({
      project,
      projectRef: { current: project },
      programSceneId: 'program',
      programFrameRate: committedFrameRate,
      previewCanvasRef: { current: previewCanvas },
      programCanvasRef: { current: programCanvas },
      chooseScene: vi.fn(),
      transitionToScene: vi.fn(),
      setActionError,
      multiviewWindowOpen: false,
      setMultiviewWindowOpen: vi.fn(),
    }),
    { initialProps: { committedFrameRate: programFrameRate } },
  );
  return { result, rerender, previewCanvas, programCanvas, setActionError };
}

describe('useMultiview projector frame rates', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('uses the committed Program rate and draft Preview rate, including updated commits', () => {
    const { result, rerender, previewCanvas, programCanvas, setActionError } = setup(30);

    act(() => result.current.openProjector('program'));
    act(() => result.current.openProjector('preview'));

    expect(projectorWindowMocks.openCanvasProjector).toHaveBeenNthCalledWith(
      1, 'program', programCanvas, 30, expect.any(Object), setActionError,
    );
    expect(projectorWindowMocks.openCanvasProjector).toHaveBeenNthCalledWith(
      2, 'preview', previewCanvas, 60, expect.any(Object), setActionError,
    );

    rerender({ committedFrameRate: 60 });
    act(() => result.current.openProjector('program'));

    expect(projectorWindowMocks.openCanvasProjector).toHaveBeenNthCalledWith(
      3, 'program', programCanvas, 60, expect.any(Object), setActionError,
    );
  });

  it('does not open a Program projector without a committed Program rate', () => {
    const { result, setActionError } = setup(null);

    act(() => result.current.openProjector('program'));

    expect(projectorWindowMocks.openCanvasProjector).not.toHaveBeenCalled();
    expect(setActionError).toHaveBeenCalledWith('The program output is not ready.');
  });
});
