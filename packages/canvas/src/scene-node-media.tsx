import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Context } from 'konva/lib/Context';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import type { Id } from '@lumacast/kernel';
import { LAYER_VIDEO_NODE_ID, readMediaFit } from '@lumacast/composition';
import type { ImageElementPayload, VideoElementPayload } from '@lumacast/composition';
import type { RenderNode, ResolvedMediaState, SceneSurface, SlideBackgroundFit } from '@lumacast/composition';
import { MISSING_MEDIA_SURFACES, MissingMediaPlaceholder } from './missing-media-placeholder';
import { resolveMediaFit } from './resolve-media-cover';
import { useKImage } from './use-k-image';
import { useKVideo } from './use-k-video';
import { buildVideoNodeClaimKey } from './video-claim-keys';

/** Empty/no-fill sentinel: fully transparent, but a real color so the element
 *  stays hit-testable in its own bounds (Konva hit-tests a Rect's painted
 *  shape, not its alpha) even when no visible fill is authored. */
const NO_FILL_COLOR = '#2b303900';

interface SceneNodeMediaProps {
  node: RenderNode;
  surface?: SceneSurface;
  /** Called with this node's own id (see SceneNodeContentOptions.onMediaLoad). */
  onLoad?: (nodeId: Id) => void;
}

type LoadedMedia =
  | {
    key: string;
    kind: 'image';
    resource: HTMLImageElement;
  }
  | {
    key: string;
    kind: 'video';
    resource: HTMLVideoElement;
  };

function resolveVideoOptions(videoPayload: VideoElementPayload | null, surface: SceneSurface): {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
} {
  const isLiveSurface = surface === 'show' || surface === 'monitor' || surface === 'stage' || surface === 'ndi-show' || surface === 'ndi-stage';
  const allowAudio = surface === 'show';
  return {
    autoplay: isLiveSurface ? (videoPayload?.autoplay ?? false) : false,
    loop: videoPayload?.loop ?? false,
    muted: allowAudio ? (videoPayload?.muted ?? false) : true,
    playbackRate: videoPayload?.playbackRate ?? 1,
  };
}

function getMediaRequestKey(node: RenderNode): string | null {
  if (node.element.type === 'image') {
    const payload = node.element.payload as { src: string };
    return payload.src ? `image:${payload.src}` : null;
  }

  if (node.element.type === 'video') {
    const payload = node.element.payload as VideoElementPayload;
    return payload.src ? `video:${payload.src}` : null;
  }

  return null;
}

function resolveDraw(media: LoadedMedia, fit: SlideBackgroundFit, width: number, height: number) {
  const sourceWidth = media.kind === 'image' ? media.resource.naturalWidth : media.resource.videoWidth;
  const sourceHeight = media.kind === 'image' ? media.resource.naturalHeight : media.resource.videoHeight;
  return resolveMediaFit(sourceWidth, sourceHeight, width, height, fit);
}

// Konva's Image has no `cornerRadius`, so a rounded corner clips the media
// (and, via the same Group, the fill painted behind it) through an explicit
// path instead. Paint-only (path construction calls only), memoized on the
// geometry that determines it, per the canvas package's paint-only-sceneFunc
// convention (see docs/ARCHITECTURE.md's rich-text note).
function roundedRectClipFunc(radius: number, width: number, height: number): (ctx: Context) => void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return (ctx) => {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(width - r, 0);
    ctx.arcTo(width, 0, width, r, r);
    ctx.lineTo(width, height - r);
    ctx.arcTo(width, height, width - r, height, r);
    ctx.lineTo(r, height);
    ctx.arcTo(0, height, 0, height - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
  };
}

function resolveLoadedMedia(
  node: RenderNode,
  requestKey: string | null,
  primaryState: ResolvedMediaState,
  proxyState: ResolvedMediaState,
): LoadedMedia | null {
  if (!requestKey) return null;
  if (primaryState.status === 'loaded') {
    if (node.element.type === 'image' && primaryState.resource instanceof HTMLImageElement) {
      return { key: requestKey, kind: 'image', resource: primaryState.resource };
    }
    if (node.element.type === 'video' && primaryState.resource instanceof HTMLVideoElement) {
      return { key: requestKey, kind: 'video', resource: primaryState.resource };
    }
  }
  if (proxyState.status === 'loaded' && proxyState.resource instanceof HTMLImageElement) {
    return { key: requestKey, kind: 'image', resource: proxyState.resource };
  }
  return null;
}

export function SceneNodeMedia({ node, surface = 'show', onLoad }: SceneNodeMediaProps) {
  const imageRef = useRef<Konva.Image | null>(null);
  const isThumbnailSurface = surface === 'list';
  const isVideoNode = node.element.type === 'video';
  const imagePayload = node.element.type === 'image' ? node.element.payload as ImageElementPayload : null;
  const imageSrc = imagePayload?.src ?? null;
  const videoPayload = isVideoNode ? node.element.payload as VideoElementPayload : null;
  const videoSrc = videoPayload?.src ?? null;
  const fit = readMediaFit(isVideoNode ? 'video' : 'image', (isVideoNode ? videoPayload : imagePayload) ?? { src: '' });
  const proxyImageSrc = node.proxyMediaKey && node.proxyMediaKey !== imageSrc && node.proxyMediaKey !== videoSrc
    ? node.proxyMediaKey
    : null;
  const videoOptions = resolveVideoOptions(videoPayload, surface);
  const imageState = useKImage(isThumbnailSurface ? null : imageSrc);
  const proxyImageState = useKImage(proxyImageSrc);
  const isLayerVideoNode = node.element.id === LAYER_VIDEO_NODE_ID;
  const videoState = useKVideo(isThumbnailSurface ? null : videoSrc, {
    autoplay: videoOptions.autoplay,
    loop: videoOptions.loop,
    muted: videoOptions.muted,
    playbackRate: videoOptions.playbackRate,
  }, isLayerVideoNode, isLayerVideoNode ? null : buildVideoNodeClaimKey(surface, node.element.id));
  const requestKey = getMediaRequestKey(node);
  const primaryState = isThumbnailSurface
    ? ({ status: 'loading' } satisfies ResolvedMediaState)
    : node.element.type === 'image'
      ? imageState
      : videoState;
  const loadedMedia = useMemo<LoadedMedia | null>(() => {
    return resolveLoadedMedia(node, requestKey, primaryState, proxyImageState);
  }, [node, primaryState, proxyImageState, requestKey]);
  const [displayedMedia, setDisplayedMedia] = useState<LoadedMedia | null>(loadedMedia);

  useEffect(() => {
    if (!requestKey) {
      setDisplayedMedia(null);
      return;
    }

    if (!loadedMedia) {
      // The node's src changed and the incoming media has not resolved yet.
      // Holding the outgoing element on screen would paint the previous
      // slide's media here, so drop it and fall through to the placeholder.
      setDisplayedMedia((current) => (current && current.key !== requestKey ? null : current));
      return;
    }

    setDisplayedMedia((current) => {
      if (current?.key === loadedMedia.key && current.resource === loadedMedia.resource) return current;
      return loadedMedia;
    });
  }, [loadedMedia, requestKey]);

  const isPrimaryBroken = primaryState.status === 'broken';

  useEffect(() => {
    if (!requestKey || !isPrimaryBroken || proxyImageState.status === 'loaded') return;
    setDisplayedMedia(null);
  }, [isPrimaryBroken, proxyImageState.status, requestKey]);

  useEffect(() => {
    if (!loadedMedia || !onLoad) return;

    const frameId = requestAnimationFrame(() => {
      onLoad(node.id);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [loadedMedia, onLoad]);

  useEffect(() => {
    if (!displayedMedia || displayedMedia.kind !== 'video') return;

    const displayedVideo = displayedMedia.resource;
    let rafId: number | null = null;
    let frameCallbackId: number | null = null;
    let cancelled = false;

    const draw = () => {
      imageRef.current?.getLayer()?.batchDraw();
    };

    if ('requestVideoFrameCallback' in displayedVideo) {
      const handleFrame: VideoFrameRequestCallback = () => {
        if (cancelled) return;
        draw();
        frameCallbackId = displayedVideo.requestVideoFrameCallback(handleFrame);
      };

      frameCallbackId = displayedVideo.requestVideoFrameCallback(handleFrame);
      return () => {
        cancelled = true;
        if (frameCallbackId !== null && 'cancelVideoFrameCallback' in displayedVideo) {
          displayedVideo.cancelVideoFrameCallback(frameCallbackId);
        }
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
  }, [displayedMedia]);

  const draw = displayedMedia
    ? resolveDraw(displayedMedia, fit, node.element.width, node.element.height)
    : null;
  // Thumbnail surfaces never decode the full source (ADR-0013 keeps them
  // derivative-only), so there the proxy is the only thing that can report a
  // missing file.
  const isMediaUnavailable = isPrimaryBroken || (isThumbnailSurface && proxyImageState.status === 'broken');
  const shouldRenderMissingPlaceholder = isMediaUnavailable
    && proxyImageState.status !== 'loaded'
    && MISSING_MEDIA_SURFACES.has(surface);

  const { visual } = node;
  const cornerRadius = Math.max(0, visual.borderRadius);
  const clipFunc = useMemo(
    () => (cornerRadius > 0 ? roundedRectClipFunc(cornerRadius, node.element.width, node.element.height) : undefined),
    [cornerRadius, node.element.width, node.element.height],
  );

  return (
    <>
      {/* Fill + shadow behind the media: visible in any letterboxed margin a
          'contain'/'fill' fit leaves uncovered, and (like scene-node-shape.tsx)
          left unclipped so a blurred/offset shadow can extend past the box. */}
      <Rect
        x={0}
        y={0}
        width={node.element.width}
        height={node.element.height}
        fill={visual.fillEnabled ? visual.fillColor : NO_FILL_COLOR}
        cornerRadius={cornerRadius}
        shadowEnabled={visual.shadowEnabled}
        shadowColor={visual.shadowColor}
        shadowBlur={visual.shadowBlur}
        shadowOffsetX={visual.shadowOffsetX}
        shadowOffsetY={visual.shadowOffsetY}
      />
      {displayedMedia && draw ? (
        <Group clipFunc={clipFunc}>
          <KonvaImage
            ref={imageRef}
            image={displayedMedia.resource}
            x={draw.x}
            y={draw.y}
            width={draw.width}
            height={draw.height}
            crop={draw.crop}
          />
        </Group>
      ) : shouldRenderMissingPlaceholder ? (
        <MissingMediaPlaceholder width={node.element.width} height={node.element.height} />
      ) : null}
      {visual.strokeEnabled ? (
        <Rect
          x={0}
          y={0}
          width={node.element.width}
          height={node.element.height}
          stroke={visual.strokeColor}
          strokeWidth={visual.strokeWidth}
          cornerRadius={cornerRadius}
          listening={false}
        />
      ) : null}
    </>
  );
}
