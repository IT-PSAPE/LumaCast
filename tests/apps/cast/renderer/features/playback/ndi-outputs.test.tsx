import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NdiOutputs } from '../../../../../../apps/cast/renderer/features/playback/ndi-outputs';

const mocks = vi.hoisted(() => ({
  outputState: { audience: false, stage: false },
  programScene: { nodes: [], sceneId: 'program-scene' },
  stageScene: { nodes: [], sceneId: 'stage-scene' },
  programBindingValue: { currentSlideText: 'program' },
  stageBindingValue: { currentSlideText: 'stage' },
  publish: vi.fn(),
}));
vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useNdi: () => ({ state: { outputState: mocks.outputState } }),
}));
vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({ currentOutputPlaylistEntryId: 'playlist-entry-1', currentOutputItemRef: { type: 'presentation', id: 'item-1' } }),
}));
vi.mock('../../../../../../apps/cast/renderer/features/playback/ndi-gpu-scene-publisher', () => ({
  useNdiGpuScenePublisher: mocks.publish,
}));
vi.mock('../../../../../../apps/cast/renderer/features/playback/use-stage-scene', () => ({
  useStageScene: () => mocks.stageScene,
  useProgramBindingValue: () => mocks.programBindingValue,
  useStageBindingValue: () => mocks.stageBindingValue,
}));
vi.mock('../../../../../../apps/cast/renderer/features/playback/use-program-output', () => ({
  useProgramOutput: () => ({ scene: mocks.programScene }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.outputState.audience = false; mocks.outputState.stage = false; });
afterEach(cleanup);

describe('NdiOutputs', () => {
  it('publishes each live output with its own scene, binding, and audience take scope', () => {
    mocks.outputState.audience = true;
    mocks.outputState.stage = true;
    const view = render(<NdiOutputs />);
    expect(mocks.publish).toHaveBeenCalledWith('audience', true, mocks.programScene, mocks.programBindingValue, 'entry:playlist-entry-1');
    expect(mocks.publish).toHaveBeenCalledWith('stage', true, mocks.stageScene, mocks.stageBindingValue, null);
    mocks.publish.mockClear();
    mocks.outputState.audience = false;
    mocks.outputState.stage = false;
    view.rerender(<NdiOutputs />);
    expect(mocks.publish).toHaveBeenCalledWith('audience', false, mocks.programScene, mocks.programBindingValue, 'entry:playlist-entry-1');
    expect(mocks.publish).toHaveBeenCalledWith('stage', false, mocks.stageScene, mocks.stageBindingValue, null);
  });
});
