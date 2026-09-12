import { SceneStage } from '../../features/canvas/scene-stage';
import { useCast } from '../../contexts/app-context';

export function DeckEditorScreen(): JSX.Element {
  useCast();
  return <SceneStage />;
}