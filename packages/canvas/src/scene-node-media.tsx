import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Line, Rect } from 'react-konva';
import { LAYER_VIDEO_NODE_ID } from '@lumacast/composition';
import type { VideoElementPayload } from '@lumacast/composition';
import type { RenderNode, ResolvedMediaState, SceneSurface } from '@lumacast/composition';
import { resolveMediaCover } from './resolve-media-cover';
import { useKImage } from './use-k-image';
import { useKVideo } from './use-k-video';
import { buildVideoNodeClaimKey } from './video-claim-keys';

interface SceneNodeMediaProps {
  node: RenderNode;
  surface?: SceneSurface;
  onLoad?: () => void;
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

function resolveCrop(media: LoadedMedia, width: number, height: number) {
  if (media.kind === 'image') {
    return resolveMediaCover(media.resource.naturalWidth, media.resource.naturalHeight, width, height);
  }

  return resolveMediaCover(media.resource.videoWidth, media.resource.videoHeight, width, height);
}

function renderBrokenPlaceholder(node: RenderNode) {
  const stripeSpacing = 28;
  const stripes = Array.from({ length: Math.ceil((node.element.width + node.element.height) / stripeSpacing) }, (_value, index) => {
    const offset = index * stripeSpacing;
    return (
      <Line
        key={`stripe-${offset}`}
        points={[offset, node.element.height, offset - node.element.height, 0]}
        stroke="#050505"
        strokeWidth={12}
        opacity={0.9}
      />
    );
  });

  return (
    <Group>
      <Rect x={0} y={0} width={node.element.width} height={node.element.height} fill="#101114" />
      {stripes}
    </Group>
  );
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
  const imageSrc = node.element.type === 'image' ? (node.element.payload as { src: string }).src ?? null : null;
  const videoPayload = node.element.type === 'video' ? node.element.payload as VideoElementPayload : null;
  const videoSrc = videoPayload?.src ?? null;
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
      onLoad();
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

  const crop = displayedMedia ? resolveCrop(displayedMedia, node.element.width, node.element.height) : null;
  const shouldRenderBrokenPlaceholder = isPrimaryBroken
    && proxyImageState.status !== 'loaded'
    && surface === 'deck-editor';

  return displayedMedia ? (
    <KonvaImage
      ref={imageRef}
      image={displayedMedia.resource}
      x={0}
      y={0}
      width={node.element.width}
      height={node.element.height}
      crop={crop ?? undefined}
    />
  ) : shouldRenderBrokenPlaceholder ? (
    renderBrokenPlaceholder(node)
  ) : (
    <Rect x={0} y={0} width={node.element.width} height={node.element.height} fill="#2b303900" />
  );
}
