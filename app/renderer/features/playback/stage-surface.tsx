import type { ReactNode } from 'react';
import { BindingProvider } from '@lumacast/canvas';
import { useStageScene, useStageBindingValue } from './use-stage-scene';
import { useNdi } from '../../contexts/app-context';
import { SurfaceFrame } from './surface-frame';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@lumacast/protocol';
import { LazySceneStage } from './lazy-scene-stage';

const NDI_FIXED_VIEWPORT: { width: number; height: number } = { width: NDI_OUTPUT_WIDTH, height: NDI_OUTPUT_HEIGHT };

export function StageSurface({ label }: { label?: ReactNode }) {
  const stageScene = useStageScene();
  const bindingValue = useStageBindingValue();

  // Mirrors the configured alpha for the stage NDI sender so the operator
  // sees exactly what the stage feed would look like over a transparent base.
  const { state: { outputConfigs } } = useNdi();
  const checkerboard = outputConfigs.stage.withAlpha;

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label={label} checkerboard={checkerboard}>
        <LazySceneStage
          scene={stageScene}
          surface="stage"
          className="h-full w-full"
          fixedViewport={NDI_FIXED_VIEWPORT}
          ndiCaptureSource="stage"
        />
      </SurfaceFrame>
    </BindingProvider>
  );
}
