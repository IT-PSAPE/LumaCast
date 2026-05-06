import { useEffect } from 'react';
import type { NdiOutputName } from '@core/types';
import { useNdi } from '../../contexts/app-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { BindingProvider } from '../canvas/binding-context';
import { NdiFrameCapture } from './ndi-frame-capture';
import { setNdiAudioEnabledOutputs } from './ndi-audio-capture';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';

// Mounts one NdiFrameCapture per configured NDI output. Each instance owns its
// own off-screen Konva stage and capture loop — they only run when their
// respective output is enabled. Routing rules:
//  - audience  → programScene (program-out, surface 'show')
//  - stage     → active stage layout's elements (surface 'stage')
//
// The stage feed is fed from the operator-selected stage layout via
// `useStageScene()`. When no stage is selected the scene is empty and the
// off-screen stage renders a black frame.
export function NdiOutputs() {
  const { state: { outputState } } = useNdi();
  const { programScene } = useRenderScenes();
  const stageScene = useStageScene();
  const programBindingValue = useProgramBindingValue();
  const stageBindingValue = useStageBindingValue();

  // Audio rides the audience feed only — the stage NDI is a presenter monitor
  // and is intentionally silent. If that ever changes, add 'stage' here too.
  useEffect(() => {
    const enabled = new Set<NdiOutputName>();
    if (outputState.audience) enabled.add('audience');
    setNdiAudioEnabledOutputs(enabled);
  }, [outputState.audience]);

  return (
    <>
      <BindingProvider value={programBindingValue}>
        <NdiFrameCapture
          senderName="audience"
          scene={programScene}
          surface="ndi-show"
          enabled={outputState.audience}
        />
      </BindingProvider>
      <BindingProvider value={stageBindingValue}>
        <NdiFrameCapture
          senderName="stage"
          scene={stageScene}
          surface="ndi-stage"
          enabled={outputState.stage}
        />
      </BindingProvider>
    </>
  );
}
