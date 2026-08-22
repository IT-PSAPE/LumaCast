import type { ReactNode } from 'react';
import { BindingProvider } from '@lumacast/canvas';
import { useShowScene } from '../../contexts/canvas/canvas-context';
import { useProgramBindingValue } from './use-stage-scene';
import { useNdi } from '../../contexts/app-context';
import { SurfaceFrame } from './surface-frame';
import { LazySceneStage } from './lazy-scene-stage';

export function MonitorSurface({ label }: { label?: ReactNode }) {
  const showScene = useShowScene();
  const bindingValue = useProgramBindingValue();
  // Monitor mirrors what's about to go to the audience NDI feed, so its
  // transparent-background indicator follows the audience output's alpha
  // config. With alpha on, the checker shows through wherever the scene
  // lacks an opaque fill — easier to spot transparent text/elements.
  const { state: { outputConfigs } } = useNdi();
  const checkerboard = outputConfigs.audience.withAlpha;

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label={label} checkerboard={checkerboard}>
        <LazySceneStage scene={showScene} surface="monitor" className="h-full w-full" />
      </SurfaceFrame>
    </BindingProvider>
  );
}
