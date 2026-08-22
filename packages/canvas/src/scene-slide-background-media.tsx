import { useEffect, useMemo, useRef } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import type { SlideBackgroundFit, SceneSurface } from '@lumacast/composition';
import { MISSING_MEDIA_SURFACES, MissingMediaPlaceholder } from './missing-media-placeholder';
import { resolveMediaFit } from './resolve-media-cover';
import { useKImage } from './use-k-image';
import { useKVideo } from './use-k-video';
import { buildVideoBackgroundClaimKey } from './video-claim-keys';

const LIVE_SURFACES: ReadonlySet<SceneSurface> = new Set<SceneSurface>([
  'show', 'monitor', 'stage', 'ndi-show', 'ndi-stage',
]);

function SceneSlideBackgroundMedia({
  kind,
  src,
  proxySrc,
  ownerId,
  fit,
  width,
  height,
  surface,
  onLoad,
}: {
  kind: 'image' | 'video';
  src: string;
  proxySrc?: string | null;
  ownerId?: string | null;
  fit: SlideBackgroundFit;
  width: number;
  height: number;
  surface: SceneSurface;
  onLoad?: () => void;
}) {
  const imageRef = useRef<Konva.Image | null>(null);
  const isLive = LIVE_SURFACES.has(surface);
  const isThumbnailSurface = surface === 'list';
  const imageState = useKImage(kind === 'image' && !isThumbnailSurface ? src : null);
  const proxyImageState = useKImage(proxySrc ?? null);
  const videoState = useKVideo(
    kind === 'video' && !isThumbnailSurface ? src : null,
    { autoplay: isLive, loop: true, muted: true, playbackRate: 1 },
    false,
    buildVideoBackgroundClaimKey(surface, ownerId ?? src),
  );
  const primaryState = isThumbnailSurface
    ? ({ status: 'loading' } as const)
    : kind === 'image'
      ? imageState
      : videoState;
  const resource = primaryState.status === 'loaded'
    ? primaryState.resource
    : proxyImageState.status === 'loaded'
      ? proxyImageState.resource
      : null;

  useEffect(() => {
    if (!resource) return;
    onLoad?.();
  }, [onLoad, resource]);

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
    // A background whose file cannot be read reports it on authoring surfaces
    // instead of silently painting nothing. Thumbnail surfaces never decode the
    // full source, so there only the proxy can report the fault.
    const isMediaUnavailable = primaryState.status === 'broken'
      || (isThumbnailSurface && proxyImageState.status === 'broken');
    if (isMediaUnavailable && MISSING_MEDIA_SURFACES.has(surface)) {
      return <MissingMediaPlaceholder width={width} height={height} listening={false} />;
    }
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

export { SceneSlideBackgroundMedia };
