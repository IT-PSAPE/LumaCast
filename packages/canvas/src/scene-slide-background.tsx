import { Rect } from 'react-konva';
import type { RenderSceneBackground, SlideBackground, SlideGradient } from '@lumacast/composition';
import type { SceneSurface } from '@lumacast/composition';
import { SceneSlideBackgroundMedia } from './scene-slide-background-media';

// Shared slide/stage background renderer for the Konva surfaces. The editor
// preview (scene-stage.tsx) and the NDI capture path (ndi-frame-capture.tsx)
// both render through this single component so a configured colour,
// gradient, or image/video background looks identical everywhere — see
// scene-traversal.ts and scene-node-content.tsx for the sibling shared
// modules this follows the same prop-driven style as. Editor-only selection
// state stays out of this component entirely; it is pure background paint
// driven by resolved SlideBackground data passed in as props.

interface SceneSlideBackgroundProps {
  background: RenderSceneBackground | SlideBackground | null | undefined;
  width: number;
  height: number;
  surface: SceneSurface;
  ownerId?: string | null;
  onMediaLoad?: () => void;
}

// NDI-only alpha-compositing helper: an output frame with no alpha channel
// needs an explicit opaque backdrop wherever the slide's own background (or
// its absence) would otherwise leave uncovered/transparent pixels. A keyed
// (withAlpha) frame must never get one forced on top of it. Kept alongside
// the background renderer (rather than inside the NDI adapter) purely so it
// stays a small, dependency-free, independently testable predicate; the NDI
// adapter owns deciding *what* to paint as that backdrop.
export function needsOpaqueBackdrop(withAlpha: boolean): boolean {
  return !withAlpha;
}

function gradientColorStops(gradient: SlideGradient): Array<number | string> {
  return [...gradient.stops]
    .sort((a, b) => a.position - b.position)
    .flatMap((stop) => [Math.min(1, Math.max(0, stop.position / 100)), stop.color]);
}

function linearGradientPoints(angle: number, width: number, height: number) {
  const rad = (angle * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    start: { x: cx - dx * half, y: cy - dy * half },
    end: { x: cx + dx * half, y: cy + dy * half },
  };
}

export function SceneSlideBackground({ background, width, height, surface, ownerId, onMediaLoad }: SceneSlideBackgroundProps) {
  if (!background) return null;

  if (background.type === 'color') {
    return <Rect x={0} y={0} width={width} height={height} fill={background.color} listening={false} />;
  }

  if (background.type === 'gradient') {
    const { gradient } = background;
    const colorStops = gradientColorStops(gradient);
    if (gradient.kind === 'radial') {
      return (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fillRadialGradientStartPoint={{ x: width / 2, y: height / 2 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndPoint={{ x: width / 2, y: height / 2 }}
          fillRadialGradientEndRadius={Math.hypot(width, height) / 2}
          fillRadialGradientColorStops={colorStops}
          listening={false}
        />
      );
    }
    const { start, end } = linearGradientPoints(gradient.angle ?? 0, width, height);
    return (
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fillLinearGradientStartPoint={start}
        fillLinearGradientEndPoint={end}
        fillLinearGradientColorStops={colorStops}
        listening={false}
      />
    );
  }

  return (
    <SceneSlideBackgroundMedia
      kind={background.type}
      src={background.src}
      proxySrc={'proxyMediaKey' in background ? background.proxyMediaKey : null}
      ownerId={ownerId}
      fit={background.fit}
      width={width}
      height={height}
      surface={surface}
      onLoad={onMediaLoad}
    />
  );
}
