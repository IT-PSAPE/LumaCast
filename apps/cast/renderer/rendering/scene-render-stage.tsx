import { memo, useEffect, useMemo, useRef } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { NdiOutputName } from '@lumacast/protocol';
import type { RenderScene, SceneSurface } from '@lumacast/composition';
import { traverseSceneNodes } from '@lumacast/composition';
import { SceneSlideBackground, useSceneStageViewport, type SceneViewportTransform } from '@lumacast/canvas';
import { setCaptureSurface } from './capture-surface-registry';
import { SceneNode } from './scene-node';

/** Read-only scene projection shared by previews and playback; editor state stays in the canvas feature. */
export interface SceneRenderStageProps {
  scene: RenderScene;
  surface?: SceneSurface;
  className?: string;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  fixedViewport?: { width: number; height: number } | null;
  onViewportChange?: (viewport: SceneViewportTransform) => void;
  ndiCaptureSource?: NdiOutputName;
}

type CaptureStageLike = Pick<Konva.Stage, 'getLayers' | 'batchDraw'>;

export function pinFixedViewportStagePixelRatio(
  stage: CaptureStageLike | null,
  fixedViewport: { width: number; height: number } | null,
): void {
  if (!stage || !fixedViewport) return;

  let changed = false;
  for (const layer of stage.getLayers()) {
    const canvas = layer.getCanvas();
    if (canvas.getPixelRatio() === 1) continue;
    canvas.setPixelRatio(1);
    changed = true;
  }

  if (changed) stage.batchDraw();
}

export function publishCaptureSurface(
  stage: CaptureStageLike | null,
  fixedViewport: { width: number; height: number } | null,
  source: NdiOutputName,
): void {
  pinFixedViewportStagePixelRatio(stage, fixedViewport);
  const layer = stage?.getLayers()[0];
  setCaptureSurface(source, layer?.getNativeCanvasElement() ?? null);
}

export function viewportStyle(displayScale: number, viewportWidth: number, viewportHeight: number): React.CSSProperties | undefined {
  if (displayScale === 1) return undefined;
  return {
    transform: `scale(${displayScale})`,
    transformOrigin: 'top left',
    width: viewportWidth,
    height: viewportHeight,
  };
}

export function useViewportChangeEffect(
  onViewportChange: SceneRenderStageProps['onViewportChange'],
  viewport: ReturnType<typeof useSceneStageViewport>,
  scene: RenderScene,
): void {
  useEffect(() => {
    if (!onViewportChange) return;
    onViewportChange({
      viewportWidth: viewport.viewportWidth,
      viewportHeight: viewport.viewportHeight,
      sceneScale: viewport.sceneScale,
      sceneOffsetX: viewport.sceneOffsetX,
      sceneOffsetY: viewport.sceneOffsetY,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
    });
  }, [
    onViewportChange,
    scene.height,
    scene.width,
    viewport.sceneOffsetX,
    viewport.sceneOffsetY,
    viewport.sceneScale,
    viewport.viewportHeight,
    viewport.viewportWidth,
  ]);
}

export function useCaptureSurfaceEffect(
  stageRef: React.RefObject<Konva.Stage | null>,
  fixedViewport: { width: number; height: number } | null,
  ndiCaptureSource: NdiOutputName | undefined,
  scene: RenderScene,
  viewport: ReturnType<typeof useSceneStageViewport>,
): void {
  const fixedViewportWidth = fixedViewport?.width ?? null;
  const fixedViewportHeight = fixedViewport?.height ?? null;

  useEffect(() => {
    if (!ndiCaptureSource) return;
    const captureViewport = fixedViewportWidth === null || fixedViewportHeight === null
      ? null
      : { width: fixedViewportWidth, height: fixedViewportHeight };

    const syncCaptureSource = () => {
      publishCaptureSurface(stageRef.current, captureViewport, ndiCaptureSource);
    };

    syncCaptureSource();
    const frameId = requestAnimationFrame(syncCaptureSource);

    return () => {
      cancelAnimationFrame(frameId);
      setCaptureSurface(ndiCaptureSource, null);
    };
  }, [
    stageRef,
    fixedViewportHeight,
    fixedViewportWidth,
    ndiCaptureSource,
    scene.height,
    scene.width,
    viewport.viewportHeight,
    viewport.viewportWidth,
  ]);
}

function propsEqual(previous: SceneRenderStageProps, next: SceneRenderStageProps): boolean {
  const previousViewport = previous.fixedViewport;
  const nextViewport = next.fixedViewport;
  const viewportEqual = (!previousViewport && !nextViewport)
    || (previousViewport !== null && previousViewport !== undefined
      && nextViewport !== null && nextViewport !== undefined
      && previousViewport.width === nextViewport.width
      && previousViewport.height === nextViewport.height);
  return previous.scene === next.scene
    && previous.surface === next.surface
    && previous.className === next.className
    && previous.onDrop === next.onDrop
    && previous.onDragOver === next.onDragOver
    && previous.onViewportChange === next.onViewportChange
    && previous.ndiCaptureSource === next.ndiCaptureSource
    && viewportEqual;
}

function SceneRenderStageImpl({
  scene,
  surface = 'show',
  className = '',
  onDrop,
  onDragOver,
  fixedViewport = null,
  onViewportChange,
  ndiCaptureSource,
}: SceneRenderStageProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const viewport = useSceneStageViewport(scene.width, scene.height, fixedViewport);
  const sceneNodes = useMemo(() => traverseSceneNodes(scene.nodes), [scene.nodes]);
  const stageWrapperStyle = viewportStyle(viewport.displayScale, viewport.viewportWidth, viewport.viewportHeight);

  useViewportChangeEffect(onViewportChange, viewport, scene);
  useCaptureSurfaceEffect(stageRef, fixedViewport, ndiCaptureSource, scene, viewport);

  return (
    <div
      ref={viewport.containerRef}
      className={`relative h-full w-full overflow-hidden ${className}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div style={stageWrapperStyle}>
        <Stage
          ref={stageRef}
          width={viewport.viewportWidth}
          height={viewport.viewportHeight}
          className={viewport.displayScale === 1 ? 'h-full w-full' : ''}
        >
          <Layer listening={false}>
            <Group
              name="scene-root"
              x={viewport.sceneOffsetX}
              y={viewport.sceneOffsetY}
              scaleX={viewport.sceneScale}
              scaleY={viewport.sceneScale}
            >
              <SceneSlideBackground background={scene.slide.background} width={scene.width} height={scene.height} surface={surface} ownerId={scene.slide.id} />
              {sceneNodes.map(({ node }) => (
                <SceneNode
                  key={node.id}
                  node={node}
                  surface={surface}
                />
              ))}
            </Group>
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

export const SceneRenderStage = memo(SceneRenderStageImpl, propsEqual);
