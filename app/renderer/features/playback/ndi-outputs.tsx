import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { BindingProvider } from '@lumacast/canvas';
import { NdiFrameCapture } from './ndi-frame-capture';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';
import { buildNdiTakeScopeKey } from '../../utils/ndi-take-correlation';

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
  const { currentOutputPlaylistEntryId, currentOutputItemRef } = useNavigation();
  const { scene: programScene } = useProgramOutput();
  const stageScene = useStageScene();
  const programBindingValue = useProgramBindingValue();
  const stageBindingValue = useStageBindingValue();
  const outputScopeKey = buildNdiTakeScopeKey(currentOutputPlaylistEntryId, currentOutputItemRef);

  return (
    <>
      {outputState.audience ? (
        <BindingProvider value={programBindingValue}>
          <NdiFrameCapture
            senderName="audience"
            scene={programScene}
            surface="ndi-show"
            outputScopeKey={outputScopeKey}
            enabled
          />
        </BindingProvider>
      ) : null}
      {outputState.stage ? (
        <BindingProvider value={stageBindingValue}>
          <NdiFrameCapture
            senderName="stage"
            scene={stageScene}
            surface="ndi-stage"
            outputScopeKey={null}
            enabled
          />
        </BindingProvider>
      ) : null}
    </>
  );
}
