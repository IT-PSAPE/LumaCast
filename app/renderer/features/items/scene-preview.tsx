import { SceneFrame } from '../../components/display/scene-frame';
import { buildThumbnailScene } from '../canvas/build-render-scene';
import { LazySceneStage } from '../../components/display/lazy-scene-stage';

export function ScenePreview({ scene }: { scene: ReturnType<typeof buildThumbnailScene> | null }) {
  if (!scene) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-tertiary text-sm uppercase tracking-wider text-tertiary">
        Empty
      </div>
    );
  }

  return (
    <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
      <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
    </SceneFrame>
  );
}
