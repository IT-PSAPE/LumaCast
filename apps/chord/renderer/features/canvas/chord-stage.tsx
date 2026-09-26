// The single Konva render surface both the live preview (preview-canvas.tsx)
// and the export encoder (../export/export-engine.ts) draw a FrameScene
// through, so what plays back while editing is pixel-for-pixel what gets
// exported.
import { useEffect, useMemo, useRef } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage } from 'react-konva';
import Konva from 'konva';
import { SceneNodeText, SceneSlideBackground, resolveMediaFit } from '@lumacast/canvas';
import { sceneNodeFrame } from '@lumacast/composition';
import type { FrameScene } from './build-frame-scene';

export interface StageFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Fit-to-viewport math shared by preview and export: uniform scale, letterboxed, centred. */
export function computeStageFit(
  composition: { width: number; height: number },
  viewport: { width: number; height: number },
): StageFit {
  const compW = Math.max(1, composition.width);
  const compH = Math.max(1, composition.height);
  const viewW = Math.max(1, viewport.width);
  const viewH = Math.max(1, viewport.height);
  const scale = Math.min(viewW / compW, viewH / compH);
  return {
    scale,
    offsetX: (viewW - compW * scale) / 2,
    offsetY: (viewH - compH * scale) / 2,
  };
}

function mediaSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  if (source instanceof HTMLVideoElement) {
    return source.videoWidth > 0 ? { width: source.videoWidth, height: source.videoHeight } : null;
  }
  if (source instanceof HTMLImageElement) {
    return source.naturalWidth > 0 ? { width: source.naturalWidth, height: source.naturalHeight } : null;
  }
  if (source instanceof HTMLCanvasElement) {
    return source.width > 0 ? { width: source.width, height: source.height } : null;
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return { width: source.width, height: source.height };
  }
  return null;
}

function BackgroundFrameImage({ frame, scene }: { frame: CanvasImageSource; scene: FrameScene }) {
  const size = mediaSourceSize(frame);
  if (!size || scene.background.type === 'color' || scene.background.type === 'gradient') return null;
  const draw = resolveMediaFit(size.width, size.height, scene.width, scene.height, scene.background.fit);
  if (!draw) return null;
  return (
    <Group listening={false} clipX={0} clipY={0} clipWidth={scene.width} clipHeight={scene.height}>
      <KonvaImage image={frame} x={draw.x} y={draw.y} width={draw.width} height={draw.height} crop={draw.crop} listening={false} />
    </Group>
  );
}

function backgroundContentKey(scene: FrameScene): string {
  if (scene.background.type === 'color') return `color:${scene.background.color}`;
  if (scene.background.type === 'gradient') return 'gradient';
  return `${scene.background.type}:${scene.background.src}:${scene.background.fit}`;
}

interface ChordStageBackgroundProps {
  scene: FrameScene;
  backgroundFrame: CanvasImageSource | null;
}

function ChordStageBackground({ scene, backgroundFrame }: ChordStageBackgroundProps) {
  const groupRef = useRef<Konva.Group | null>(null);
  const contentKey = backgroundContentKey(scene);

  // Konva filters only run against a cached raster, so blurring the
  // background means caching this whole subtree. For a static image or
  // color background that cache is rebuilt only when `blur` or the
  // background's own content changes — cheap. For a *live-preview* video
  // background (no `backgroundFrame` supplied: SceneSlideBackground drives
  // its own imperative redraw loop outside React) this effect never fires
  // again after mount, so a blurred preview video shows a single stale
  // blurred frame rather than continuously reblurring — a known limitation.
  // The export path is unaffected: it supplies a fresh `backgroundFrame`
  // every call, which is exactly what re-triggers this cache below, so
  // export blurs correctly frame-by-frame (at the cost of one re-cache per
  // exported frame — acceptable for a one-shot render, documented here so
  // nobody "optimizes" it into the preview's broken behavior).
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (scene.blur > 0) {
      group.cache();
      group.filters([Konva.Filters.Blur]);
      group.blurRadius(scene.blur);
    } else {
      group.clearCache();
      group.filters([]);
    }
    group.getLayer()?.batchDraw();
  }, [scene.blur, contentKey, backgroundFrame]);

  return (
    <Group ref={groupRef} listening={false}>
      {backgroundFrame ? (
        <BackgroundFrameImage frame={backgroundFrame} scene={scene} />
      ) : (
        <SceneSlideBackground background={scene.background} width={scene.width} height={scene.height} surface="deck-editor" />
      )}
    </Group>
  );
}

function ChordStageCue({ cue }: { cue: NonNullable<FrameScene['cue']> }) {
  const frame = sceneNodeFrame(cue.node);
  return (
    <Group
      {...frame}
      opacity={frame.opacity * cue.transition.opacity}
      x={frame.x + cue.transition.offsetX}
      y={frame.y + cue.transition.offsetY}
      scaleX={cue.transition.scale}
      scaleY={cue.transition.scale}
      listening={false}
    >
      <SceneNodeText node={cue.node} />
    </Group>
  );
}

export interface ChordStageViewport {
  width: number;
  height: number;
}

export interface ChordStageProps {
  scene: FrameScene;
  viewport: ChordStageViewport;
  /** A frame the caller already drew (export drives this per output frame); omitted in preview, where the background renders itself via SceneSlideBackground. */
  backgroundFrame?: CanvasImageSource | null;
  /** Export-only: lets the encoder reach the mounted Konva.Stage to grab its layer canvas after each render. */
  stageRef?: React.RefObject<Konva.Stage | null>;
}

export function ChordStage({ scene, viewport, backgroundFrame = null, stageRef }: ChordStageProps) {
  const fallbackStageRef = useRef<Konva.Stage | null>(null);
  const resolvedStageRef = stageRef ?? fallbackStageRef;
  const fit = useMemo(
    () => computeStageFit({ width: scene.width, height: scene.height }, viewport),
    [scene.width, scene.height, viewport.width, viewport.height],
  );

  return (
    <Stage ref={resolvedStageRef} width={viewport.width} height={viewport.height}>
      <Layer>
        <Group x={fit.offsetX} y={fit.offsetY} scaleX={fit.scale} scaleY={fit.scale}>
          <ChordStageBackground scene={scene} backgroundFrame={backgroundFrame} />
          {scene.dim > 0 ? (
            <Rect x={0} y={0} width={scene.width} height={scene.height} fill="#000000" opacity={scene.dim} listening={false} />
          ) : null}
          {scene.cue ? <ChordStageCue cue={scene.cue} /> : null}
        </Group>
      </Layer>
    </Stage>
  );
}
