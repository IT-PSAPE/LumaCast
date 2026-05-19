import { useEffect, useMemo, useRef } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import type { SlideBackground, SlideBackgroundFit, SlideGradient } from '@core/types';
import type { SceneSurface } from './scene-types';
import { resolveMediaFit } from './resolve-media-cover';
import { useKImage } from './use-k-image';
import { useKVideo } from './use-k-video';

interface SceneSlideBackgroundProps {
  background: SlideBackground | null | undefined;
  width: number;
  height: number;
  surface: SceneSurface;
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

const LIVE_SURFACES: ReadonlySet<SceneSurface> = new Set<SceneSurface>([
  'show', 'monitor', 'stage', 'ndi-show', 'ndi-stage',
]);

export function SceneSlideBackground({ background, width, height, surface }: SceneSlideBackgroundProps) {
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
      fit={background.fit}
      width={width}
      height={height}
      surface={surface}
    />
  );
}

function SceneSlideBackgroundMedia({
  kind,
  src,
  fit,
  width,
  height,
  surface,
}: {
  kind: 'image' | 'video';
  src: string;
  fit: SlideBackgroundFit;
  width: number;
  height: number;
  surface: SceneSurface;
}) {
  const imageRef = useRef<Konva.Image | null>(null);
  const isLive = LIVE_SURFACES.has(surface);
  const imageState = useKImage(kind === 'image' ? src : null);
  const videoState = useKVideo(
    kind === 'video' ? src : null,
    { autoplay: isLive, loop: true, muted: true, playbackRate: 1 },
    false,
  );
  const state = kind === 'image' ? imageState : videoState;
  const resource = state.status === 'loaded' ? state.resource : null;

  const naturalSize = useMemo(() => {
    if (!resource) return null;
    if (resource instanceof HTMLImageElement) return { w: resource.naturalWidth, h: resource.naturalHeight };
    return { w: resource.videoWidth, h: resource.videoHeight };
  }, [resource]);

  // Keep the canvas repainting while a background video plays.
  useEffect(() => {
    if (!resource || !(resource instanceof HTMLVideoElement)) return;
    let cancelled = false;
    let rafId: number | null = null;
    let frameId: number | null = null;
    const draw = () => imageRef.current?.getLayer()?.batchDraw();

    if ('requestVideoFrameCallback' in resource) {
      const onFrame: VideoFrameRequestCallback = () => {
        if (cancelled) return;
        draw();
        frameId = resource.requestVideoFrameCallback(onFrame);
      };
      frameId = resource.requestVideoFrameCallback(onFrame);
      return () => {
        cancelled = true;
        if (frameId !== null && 'cancelVideoFrameCallback' in resource) resource.cancelVideoFrameCallback(frameId);
      };
    }

    const tick = () => {
      if (cancelled) return;
      draw();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [resource]);

  if (!resource || !naturalSize) {
    return <Rect x={0} y={0} width={width} height={height} fill="#00000000" listening={false} />;
  }

  const draw = resolveMediaFit(naturalSize.w, naturalSize.h, width, height, fit);
  if (!draw) return null;

  return (
    <Group listening={false} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
      <KonvaImage
        ref={imageRef}
        image={resource}
        x={draw.x}
        y={draw.y}
        width={draw.width}
        height={draw.height}
        crop={draw.crop}
        listening={false}
      />
    </Group>
  );
}
