import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useNdiGpuScenePublisher } from './ndi-gpu-scene-publisher';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';
import { buildNdiTakeScopeKey } from '../../utils/ndi-take-correlation';

export function NdiOutputs() {
  const { state: { outputState } } = useNdi();
  const { currentOutputPlaylistEntryId, currentOutputItemRef } = useNavigation();
  const { scene: programScene } = useProgramOutput();
  const stageScene = useStageScene();
  const programBindingValue = useProgramBindingValue();
  const stageBindingValue = useStageBindingValue();
  const outputScopeKey = buildNdiTakeScopeKey(currentOutputPlaylistEntryId, currentOutputItemRef);

  useNdiGpuScenePublisher('audience', outputState.audience, programScene, programBindingValue, outputScopeKey);
  useNdiGpuScenePublisher('stage', outputState.stage, stageScene, stageBindingValue, null);
  return null;
}
