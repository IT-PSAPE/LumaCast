import { Suspense, lazy } from 'react';
import type { RenderScene, SceneSurface } from '@lumacast/composition';
import type { NdiOutputName } from '@lumacast/protocol';

const SceneRenderStage = lazy(() =>
  import('../../rendering/scene-render-stage').then((module) => ({ default: module.SceneRenderStage })),
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
      <SceneRenderStage {...props} />
    </Suspense>
  );
}
