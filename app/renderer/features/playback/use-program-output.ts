import { useMemo } from 'react';
import type { NdiSourceStatus } from '@lumacast/protocol';
import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import type { RenderScene } from '@lumacast/composition';

export interface ProgramOutput {
  scene: RenderScene;
  status: NdiSourceStatus;
  background: 'black' | 'transparent';
}

export function useProgramOutput(): ProgramOutput {
  const { state: { outputConfigs } } = useNdi();
  const { currentOutputDeckItemId } = useNavigation();
  const { liveSlide } = useSlides();
  const { programScene } = useRenderScenes();
  const outputConfig = outputConfigs.audience;
  const status: NdiSourceStatus = currentOutputDeckItemId && liveSlide ? 'live' : 'idle';
  const background = outputConfig.withAlpha ? 'transparent' : 'black';

  return useMemo<ProgramOutput>(() => ({
    scene: programScene,
    status,
    background,
  }), [programScene, status, background]);
}
