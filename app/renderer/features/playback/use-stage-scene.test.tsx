import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Stage } from '@lumacast/composition';
import { useStageScene } from './use-stage-scene';

const mockState = vi.hoisted(() => ({
  stagePlayback: {
    currentStageId: null as string | null,
  },
  project: {
    stagesById: new Map<string, Stage>(),
  },
}));

vi.mock('../../contexts/playback/playback-context', () => ({
  useStagePlayback: () => mockState.stagePlayback,
}));

vi.mock('../../contexts/use-project-content', () => ({
  useProjectContent: () => mockState.project,
}));

vi.mock('../../hooks/use-media-proxy-map', () => ({
  useMediaProxyMap: () => new Map(),
}));

describe('useStageScene', () => {
  afterEach(() => {
    mockState.stagePlayback.currentStageId = null;
    mockState.project.stagesById = new Map();
  });

  it('preserves the active stage id on the rendered scene slide for background claim ownership', () => {
    const stage: Stage = {
      id: 'stage-1',
      slideId: 'stage-slide',
      name: 'Stage',
      width: 1920,
      height: 1080,
      background: { type: 'video', mediaAssetId: 'asset://stage-background.mp4', src: 'asset://stage-background.mp4', fit: 'cover' },
      elements: [],
      order: 0,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
    };
    mockState.stagePlayback.currentStageId = stage.id;
    mockState.project.stagesById = new Map([[stage.id, stage]]);

    const { result } = renderHook(() => useStageScene());

    expect(result.current.slide.id).toBe(stage.id);
  });
});
