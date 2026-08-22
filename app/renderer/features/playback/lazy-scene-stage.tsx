import { Suspense, lazy } from 'react';
import type { RenderScene, SceneSurface } from '@lumacast/composition';
import type { NdiOutputName } from '@lumacast/protocol';

const SceneStage = lazy(() =>
  import('../canvas/scene-stage').then((module) => ({ default: module.SceneStage })),
);

interface LazySceneStageProps {
  scene: RenderScene;
  surface: SceneSurface;
  className?: string;
  fixedViewport?: { width: number; height: number } | null;
  ndiCaptureSource?: NdiOutputName;
}

export function LazySceneStage(props: LazySceneStageProps) {
  return (
    <Suspense fallback={<div data-testid="lazy-scene-stage-fallback" className={props.className} />}>
      <SceneStage {...props} />
    </Suspense>
  );
}
