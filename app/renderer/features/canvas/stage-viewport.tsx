import { useStageViewportController } from '@lumacast/canvas';
import { SceneFrame } from '../../components/display/scene-frame';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useActiveEditorSource } from '../../contexts/canvas/use-active-editor-source';
import { useWorkbench } from '../../contexts/workbench-context';
import { SceneStage } from './scene-stage';

export function StageViewport() {
  const activeEditorSource = useActiveEditorSource();
  // Reaches the shared workbench context directly (not through the inspector
  // feature's useInspector() facade) so the canvas feature never depends on
  // the inspector feature — see inspector-context.tsx for the reasoning.
  const { actions: { setInspectorTab } } = useWorkbench();
  const { editScene, showScene } = useRenderScenes();
  const { createFromMedia } = useElements();
  const { actions, state } = useStageViewportController({
    activeEditorSource, setInspectorTab, editScene, showScene, createFromMedia,
  });

  return (
    <div className="grid h-full min-h-0 place-items-center overflow-hidden bg-primary">
      <SceneFrame width={state.scene.width} height={state.scene.height} fit="contain" className="border border-primary shadow-2xl" stageClassName="z-10" checkerboard>
        <SceneStage
          scene={state.scene}
          surface="deck-editor"
          editable={state.editable}
          className="h-full w-full"
          onDragOver={actions.handleDragOver}
          onDrop={actions.handleDrop}
          onViewportChange={actions.handleViewportChange}
        />
      </SceneFrame>
    </div>
  );
}
