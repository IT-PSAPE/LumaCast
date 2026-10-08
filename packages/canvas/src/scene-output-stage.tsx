import { useCallback, useLayoutEffect, useRef } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import type Konva from 'konva';
import { traverseSceneNodes, type RenderScene, type SceneSurface } from '@lumacast/composition';
import { SceneSlideBackground } from './scene-slide-background';
import { renderSceneNodeContent } from './scene-node-content';

/** Read-only scene surface. Chromium owns capture; this component only paints. */
export function SceneOutputStage({ scene, surface, width, height, redrawVersion, onDraw }: {
  scene: RenderScene; surface: SceneSurface; width: number; height: number; redrawVersion?: number; onDraw?: () => void;
}) {
  const stage = useRef<Konva.Stage | null>(null);
  const draw = useCallback(() => { stage.current?.draw(); onDraw?.(); }, [onDraw]);
  useLayoutEffect(draw, [draw, scene, width, height, redrawVersion]);
  useLayoutEffect(() => {
    let current = true;
    void document.fonts?.ready.then(() => { if (current) draw(); });
    document.fonts?.addEventListener?.('loadingdone', draw);
    return () => {
      current = false;
      document.fonts?.removeEventListener?.('loadingdone', draw);
    };
  }, [draw]);
  return <Stage ref={stage} width={width} height={height} listening={false}>
    <Layer listening={false}>
      <Group scaleX={width / scene.width} scaleY={height / scene.height}>
        <SceneSlideBackground background={scene.slide.background} width={scene.width} height={scene.height} surface={surface} ownerId={scene.slide.id} onMediaLoad={draw} />
        {traverseSceneNodes(scene.nodes).map(({ node, frame }) => <Group key={node.id}
          x={frame.x} y={frame.y} width={frame.width} height={frame.height}
          rotation={frame.rotation} opacity={frame.opacity} scaleX={frame.scaleX} scaleY={frame.scaleY}
          offsetX={frame.offsetX} offsetY={frame.offsetY}>
          {renderSceneNodeContent(node, surface, { onMediaLoad: draw })}
        </Group>)}
      </Group>
    </Layer>
  </Stage>;
}
