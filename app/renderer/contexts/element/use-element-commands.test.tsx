import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MediaAsset } from '@core/types';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import type { ActiveEditorSource } from '../canvas/editor-source';
import { useElementCommands } from './use-element-commands';

vi.mock('@renderer/contexts/use-project-content', () => ({ useProjectContent: vi.fn() }));
vi.mock('@renderer/contexts/workbench-context', () => ({ useWorkbench: vi.fn() }));

const useProjectContentMock = vi.mocked(useProjectContent);
const useWorkbenchMock = vi.mocked(useWorkbench);

function makeStageSource(replaceElements: ReturnType<typeof vi.fn>): ActiveEditorSource {
  return {
    mode: 'stage-editor',
    entityId: 'stage-1',
    hasSource: true,
    frame: { width: 1920, height: 1080 },
    elements: [],
    replaceElements: replaceElements as (elements: ActiveEditorSource['elements']) => void,
    historyKey: 'stage-1',
    emptyStateLabel: 'No stage selected.',
    editable: true,
    createCapabilities: { text: true, shape: true, image: true, video: true },
    meta: { stage: { id: 'stage-1', slideId: 'stage-1:slide', name: 'Stage', width: 1920, height: 1080, order: 0, elements: [], collectionId: 'stage-default', createdAt: '', updatedAt: '' } },
  };
}

describe('useElementCommands', () => {
  beforeEach(() => {
    useWorkbenchMock.mockReturnValue({
      state: {
        overlayDefaults: {
          animationKind: 'dissolve',
          durationMs: 400,
          autoClearDurationMs: null,
        },
      },
    } as never);
    useProjectContentMock.mockReturnValue({
      slideElementsBySlideId: new Map(),
    } as never);
  });

  it('writes new stage text into the stage draft even when a lyric deck item is selected elsewhere', async () => {
    const replaceElements = vi.fn();
    const setStatusText = vi.fn();
    const { result } = renderHook(() => useElementCommands({
      activeEditorSource: makeStageSource(replaceElements),
      currentDeckItem: { id: 'deck-1', type: 'lyric' } as never,
      mutatePatch: vi.fn().mockResolvedValue({}),
      setStatusText,
      pushHistorySnapshot: vi.fn(),
    }));

    await act(async () => {
      await result.current.createText();
    });

    expect(replaceElements).toHaveBeenCalledTimes(1);
    expect(replaceElements.mock.calls[0][0][0]).toMatchObject({ slideId: 'stage-1', type: 'text' });
    expect(setStatusText).toHaveBeenCalledWith('Added stage text');
  });

  it('writes new stage shapes into the current stage draft', async () => {
    const replaceElements = vi.fn();
    const { result } = renderHook(() => useElementCommands({
      activeEditorSource: makeStageSource(replaceElements),
      currentDeckItem: null,
      mutatePatch: vi.fn().mockResolvedValue({}),
      setStatusText: vi.fn(),
      pushHistorySnapshot: vi.fn(),
    }));

    await act(async () => {
      await result.current.createShape();
    });

    expect(replaceElements).toHaveBeenCalledTimes(1);
    expect(replaceElements.mock.calls[0][0][0]).toMatchObject({ slideId: 'stage-1', type: 'shape' });
  });

  it('writes dropped media into the current stage draft', async () => {
    const replaceElements = vi.fn();
    const asset: MediaAsset = {
      id: 'asset-1',
      name: 'Photo',
      type: 'image',
      order: 0,
      src: '/photo.jpg',
      collectionId: 'image-default',
      createdAt: '',
      updatedAt: '',
    };
    const { result } = renderHook(() => useElementCommands({
      activeEditorSource: makeStageSource(replaceElements),
      currentDeckItem: null,
      mutatePatch: vi.fn().mockResolvedValue({}),
      setStatusText: vi.fn(),
      pushHistorySnapshot: vi.fn(),
    }));

    await act(async () => {
      await result.current.createFromMedia(asset, 120, 180);
    });

    expect(replaceElements).toHaveBeenCalledTimes(1);
    expect(replaceElements.mock.calls[0][0][0]).toMatchObject({ slideId: 'stage-1', type: 'image' });
  });
});
