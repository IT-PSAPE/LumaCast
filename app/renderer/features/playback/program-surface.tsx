import type { ReactNode } from 'react';
import { BindingProvider } from '@lumacast/canvas';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue } from './use-stage-scene';
import { SceneStage } from '../canvas/scene-stage';
import { SurfaceFrame } from './surface-frame';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@lumacast/protocol';

export function ProgramSurface({ label }: { label?: ReactNode }) {
  const { scene, background } = useProgramOutput();
  const bindingValue = useProgramBindingValue();
  const checkerboard = background === 'transparent';

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label={label} checkerboard={checkerboard}>
        <SceneStage
          scene={scene}
          surface="show"
          className="h-full w-full"
          fixedViewport={{ width: NDI_OUTPUT_WIDTH, height: NDI_OUTPUT_HEIGHT }}
          ndiCaptureSource="audience"
        />
      </SurfaceFrame>
    </BindingProvider>
  );
}
