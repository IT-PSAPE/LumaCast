import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { mediaAssetUrl, type SourceCrop, type StreamProject, type StreamScene, type StreamSource } from '../shared/desktop-api';
import type { SourceStatus } from './source-availability';
import { getOriginSourceId, getSourceRuntimeId, toRuntimeSource, type RuntimeSource } from './source-runtime';
import { ChromaKeyProcessor } from './chroma-key';
import { setMediaPlaybackActive, shouldShowMediaFrame } from './media-playback';
import { currentSlideshowSlideIndex, forgetSlideshow, setSlideshowActive, slideshowImageElementKey } from './slideshow';
import type { SceneTransition } from './scene-transition';
import { drawCameraColorBars, drawUnavailablePlaceholder } from './source-placeholders';
import { drawTextSource } from './text-overlay';
import { fitCanvasToOutput } from './output-scaling';
import { getRenderableSources } from './source-render-list';
import { MAX_SCENE_REFERENCE_DEPTH } from '../shared/scene-reference-graph';
import { sceneSourceBufferSize } from './scene-source-buffer';
import { sourceContainsPoint } from './source-transform';

function rotateSourceContext(context: CanvasRenderingContext2D, source: StreamSource): void {
  const rotation = source.transform.rotation ?? 0;
  if (rotation === 0) return;
  const centerX = source.transform.x + source.transform.width / 2;
  const centerY = source.transform.y + source.transform.height / 2;
  context.translate(centerX, centerY);
  context.rotate(rotation * Math.PI / 180);
  context.translate(-centerX, -centerY);
}

interface Props {
  project: StreamProject;
  scene: StreamScene;
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  renderScale?: number;
  /** Limits thumbnail composition work while keeping Program output uncapped by default. */
  maxFrameRate?: number;
  /** Stops rendering offscreen thumbnails while preserving their last frame. */
  renderEnabled?: boolean;
  /** Frozen outgoing graph for animated Program transitions. */
  outgoingProject?: StreamProject | null;
  outgoingScene?: StreamScene | null;
  transition?: SceneTransition | null;
  onTransitionEnd?: () => void;
}

function clampCrop(crop: SourceCrop | undefined, width: number, height: number): SourceCrop {
  const left = Math.min(crop?.left ?? 0, width);
  const right = Math.min(crop?.right ?? 0, width - left);
  const top = Math.min(crop?.top ?? 0, height);
  const bottom = Math.min(crop?.bottom ?? 0, height - top);
  return { left, right, top, bottom };
}

function drawSources(
  context: CanvasRenderingContext2D,
  sources: readonly StreamSource[],
  canvasWidth: number,
  canvasHeight: number,
  videos: Map<string, HTMLVideoElement>,
  images: Map<string, HTMLImageElement>,
  keyProcessor: ChromaKeyProcessor | null,
  scenesById: Map<string, StreamScene>,
  sceneCanvases: Map<string, HTMLCanvasElement>,
  scenePath: Set<string>,
  referenceDepth: number,
  pixelScaleX: number,
  pixelScaleY: number,
): void {
  for (const source of getRenderableSources(sources)) {
    const runtimeSourceId = getSourceRuntimeId(source);
    context.save();
    const filters = source.filters;
    const filterOperations = [
      'brightness(' + (filters?.brightness ?? 100) + '%)',
      'contrast(' + (filters?.contrast ?? 100) + '%)',
      'saturate(' + (filters?.saturation ?? 100) + '%)',
      'blur(' + (filters?.blur ?? 0) + 'px)',
    ];
    context.filter = filterOperations.join(' ');
    context.globalAlpha *= (filters?.opacity ?? 100) / 100;
    const { x, y, width: boxWidth, height: boxHeight } = source.transform;
    if (source.kind === 'scene') {
      rotateSourceContext(context, source);
      const referencedSceneId = source.referencedSceneId;
      const referencedScene = referencedSceneId ? scenesById.get(referencedSceneId) : undefined;
      if (referencedScene && referenceDepth < MAX_SCENE_REFERENCE_DEPTH && !scenePath.has(referencedScene.id)) {
        const bufferSize = sceneSourceBufferSize(boxWidth, boxHeight, pixelScaleX, pixelScaleY);
        let sceneCanvas = sceneCanvases.get(runtimeSourceId);
        if (!sceneCanvas) {
          sceneCanvas = document.createElement('canvas');
          sceneCanvases.set(runtimeSourceId, sceneCanvas);
        }
        if (sceneCanvas.width !== bufferSize.width) sceneCanvas.width = bufferSize.width;
        if (sceneCanvas.height !== bufferSize.height) sceneCanvas.height = bufferSize.height;
        const sceneContext = sceneCanvas.getContext('2d');
        if (sceneContext) {
          sceneContext.setTransform(1, 0, 0, 1, 0, 0);
          sceneContext.globalAlpha = 1;
          sceneContext.filter = 'none';
          sceneContext.clearRect(0, 0, sceneCanvas.width, sceneCanvas.height);
          const nestedPixelScaleX = bufferSize.width / canvasWidth;
          const nestedPixelScaleY = bufferSize.height / canvasHeight;
          sceneContext.setTransform(nestedPixelScaleX, 0, 0, nestedPixelScaleY, 0, 0);
          scenePath.add(referencedScene.id);
          drawSources(sceneContext, referencedScene.sources, canvasWidth, canvasHeight, videos, images, keyProcessor, scenesById, sceneCanvases, scenePath, referenceDepth + 1, nestedPixelScaleX, nestedPixelScaleY);
          scenePath.delete(referencedScene.id);
          try { context.drawImage(sceneCanvas, x, y, boxWidth, boxHeight); } catch { /* The target scene may be changing while its frame is drawn. */ }
        }
      }
    } else if (source.kind === 'color') {
      rotateSourceContext(context, source);
      context.fillStyle = source.color ?? '#17191f';
      context.fillRect(x, y, boxWidth, boxHeight);
    } else if (source.kind === 'text') {
      rotateSourceContext(context, source);
      drawTextSource(context, source);
    } else if (source.kind === 'image' || source.kind === 'browser' || source.kind === 'slideshow') {
      const slideshowImages = source.kind === 'slideshow' ? source.slideshowImages ?? [] : [];
      const slideIndex = source.kind === 'slideshow'
        ? currentSlideshowSlideIndex(runtimeSourceId, slideshowImages.length, source.slideshowIntervalSeconds ?? 5, source.slideshowLoop ?? true)
        : -1;
      const imageKey = slideshowImageElementKey(runtimeSourceId, slideshowImages, slideIndex);
      const image = images.get(imageKey);
      if (image?.complete && image.naturalWidth > 0) {
        const crop = clampCrop(source.crop, image.naturalWidth, image.naturalHeight);
        const cropWidth = image.naturalWidth - crop.left - crop.right;
        const cropHeight = image.naturalHeight - crop.top - crop.bottom;
        if (cropWidth > 0 && cropHeight > 0) {
          let keyed: HTMLCanvasElement | null = null;
          if (source.chromaKey?.enabled && keyProcessor) {
            try { keyed = keyProcessor.render(image, source.transform, source.chromaKey, crop, image.naturalWidth, image.naturalHeight); } catch { /* Keep drawing the original if a frame cannot be keyed. */ }
          }
          try {
            if (keyed) context.drawImage(keyed, 0, 0, canvasWidth, canvasHeight);
            else {
              rotateSourceContext(context, source);
              context.drawImage(image, crop.left, crop.top, cropWidth, cropHeight, x, y, boxWidth, boxHeight);
            }
          } catch { /* The image may become unavailable while it decodes. */ }
        }
      } else if (source.kind === 'image' && (!source.assetId || !image || image.dataset.sourceUnavailable === 'true')) {
        rotateSourceContext(context, source);
        drawUnavailablePlaceholder(context, x, y, boxWidth, boxHeight, 'Image unavailable');
      } else if (source.kind === 'browser' && (!image || image.dataset.sourceUnavailable === 'true')) {
        rotateSourceContext(context, source);
        drawUnavailablePlaceholder(context, x, y, boxWidth, boxHeight, 'Browser unavailable');
      } else if (source.kind === 'slideshow' && (slideIndex < 0 || !image || image.dataset.sourceUnavailable === 'true')) {
        rotateSourceContext(context, source);
        drawUnavailablePlaceholder(context, x, y, boxWidth, boxHeight, 'Image unavailable');
      }
    } else {
      const video = videos.get(runtimeSourceId);
      const isCaptureSource = source.kind === 'camera' || source.kind === 'display' || source.kind === 'window';
      const hasLiveCaptureTrack = isCaptureSource && hasLiveVideoTrack(video);
      const hasVideoFrame = video
        && (!isCaptureSource || hasLiveCaptureTrack)
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && video.videoWidth > 0 && video.videoHeight > 0;
      const canDrawVideoFrame = hasVideoFrame && video && shouldShowMediaFrame(video.ended, source.showNothingWhenPlaybackEnds ?? true);
      if (canDrawVideoFrame && video) {
        const crop = clampCrop(source.crop, video.videoWidth, video.videoHeight);
        const cropWidth = video.videoWidth - crop.left - crop.right;
        const cropHeight = video.videoHeight - crop.top - crop.bottom;
        if (cropWidth > 0 && cropHeight > 0) {
          let keyed: HTMLCanvasElement | null = null;
          if (source.chromaKey?.enabled && keyProcessor) {
            try { keyed = keyProcessor.render(video, source.transform, source.chromaKey, crop, video.videoWidth, video.videoHeight); } catch { /* Keep drawing the original if a frame cannot be keyed. */ }
          }
          try {
            if (keyed) context.drawImage(keyed, 0, 0, canvasWidth, canvasHeight);
            else {
              rotateSourceContext(context, source);
              context.drawImage(video, crop.left, crop.top, cropWidth, cropHeight, x, y, boxWidth, boxHeight);
            }
          } catch { /* A frame may become unavailable while capture ends. */ }
        }
      } else if (isCaptureSource) {
        rotateSourceContext(context, source);
        drawCameraColorBars(context, x, y, boxWidth, boxHeight);
      } else if (source.kind === 'media' && source.mediaKind === 'video'
        && (!source.assetId || !video || video.error || video.dataset.sourceUnavailable === 'true')) {
        rotateSourceContext(context, source);
        drawUnavailablePlaceholder(context, x, y, boxWidth, boxHeight, 'Media unavailable');
      }
    }
    context.restore();
  }
}

function hasLiveVideoTrack(video: HTMLVideoElement | undefined): boolean {
  const stream = video?.srcObject;
  if (!stream || !('getVideoTracks' in stream) || typeof stream.getVideoTracks !== 'function') return false;
  return stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);
}

function drawScene(
  context: CanvasRenderingContext2D,
  scene: StreamScene,
  canvasWidth: number,
  canvasHeight: number,
  videos: Map<string, HTMLVideoElement>,
  images: Map<string, HTMLImageElement>,
  keyProcessor: ChromaKeyProcessor | null,
  scenesById: Map<string, StreamScene>,
  sceneCanvases: Map<string, HTMLCanvasElement>,
  pixelScaleX: number,
  pixelScaleY: number,
  alpha: number,
  offsetX = 0,
): void {
  context.save();
  context.globalAlpha = alpha;
  if (offsetX !== 0) context.translate(offsetX, 0);
  drawSources(context, scene.sources, canvasWidth, canvasHeight, videos, images, keyProcessor, scenesById, sceneCanvases, new Set([scene.id]), 0, pixelScaleX, pixelScaleY);
  context.restore();
}

export const CanvasComposition = forwardRef<HTMLCanvasElement, Props>(function CanvasComposition(
  { project, scene, videoElements, imageElements, renderScale = 1, maxFrameRate, renderEnabled = true, outgoingProject, outgoingScene, transition, onTransitionEnd },
  canvasRef,
) {
  const localCanvas = useRef<HTMLCanvasElement | null>(null);
  const setCanvas = useCallback((element: HTMLCanvasElement | null) => {
    localCanvas.current = element;
    if (typeof canvasRef === 'function') canvasRef(element);
    else if (canvasRef) canvasRef.current = element;
  }, [canvasRef]);
  const onTransitionEndRef = useRef(onTransitionEnd);
  onTransitionEndRef.current = onTransitionEnd;
  useEffect(() => {
    const canvas = localCanvas.current;
    if (!canvas || !renderEnabled) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    const scale = Math.max(0.1, Math.min(1, renderScale));
    const { baseWidth, baseHeight, width: outputWidth, height: outputHeight } = project.output;
    const canvasViewport = fitCanvasToOutput(
      { width: baseWidth, height: baseHeight },
      { width: outputWidth, height: outputHeight },
    );
    const canvasWidth = Math.max(1, Math.round(outputWidth * scale));
    const canvasHeight = Math.max(1, Math.round(outputHeight * scale));
    if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
    const sourcePixelScale = (canvas.width / outputWidth) * canvasViewport.scale;
    let frame = 0;
    let finishedTransition = false;
    let lastDrawAt = Number.NEGATIVE_INFINITY;
    let keyProcessor: ChromaKeyProcessor | null = null;
    const scenesById = new Map(project.scenes.map((item) => [item.id, item]));
    const outgoingScenesById = new Map((outgoingProject ?? project).scenes.map((item) => [item.id, item]));
    const sceneCanvases = new Map<string, HTMLCanvasElement>();
    const keyRenderScale = scale * Math.min(1, canvasViewport.scale);
    try { keyProcessor = new ChromaKeyProcessor(baseWidth, baseHeight, keyRenderScale); } catch { /* Chroma key is unavailable when WebGL cannot initialize. */ }
    const draw = (now = performance.now()) => {
      if (!renderEnabled) return;
      if (maxFrameRate && maxFrameRate > 0 && now - lastDrawAt < 1000 / maxFrameRate) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDrawAt = now;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(canvas.width / outputWidth, canvas.height / outputHeight);
      const drawToOutput = (targetScene: StreamScene, targetScenesById: Map<string, StreamScene>, alpha: number, offsetX = 0) => {
        context.save();
        context.translate(canvasViewport.x, canvasViewport.y);
        context.scale(canvasViewport.scale, canvasViewport.scale);
        drawScene(context, targetScene, baseWidth, baseHeight, videoElements, imageElements, keyProcessor, targetScenesById, sceneCanvases, sourcePixelScale, sourcePixelScale, alpha, offsetX);
        context.restore();
      };
      const fromScene = transition
        ? (outgoingScene?.id === transition.fromSceneId ? outgoingScene : (outgoingProject ?? project).scenes.find((item) => item.id === transition.fromSceneId))
        : null;
      const progress = transition ? Math.min(1, Math.max(0, (performance.now() - transition.startedAt) / transition.durationMs)) : 1;
      if (transition && fromScene && progress < 1) {
        if (transition.type === 'Fade') {
          drawToOutput(fromScene, outgoingScenesById, 1 - progress);
          drawToOutput(scene, scenesById, progress);
        } else if (transition.type === 'FadeToColor') {
          if (progress < 0.5) {
            drawToOutput(fromScene, outgoingScenesById, 1);
            context.save();
            context.globalAlpha = progress * 2;
            context.fillStyle = transition.color ?? '#000000';
            context.fillRect(0, 0, outputWidth, outputHeight);
            context.restore();
          } else {
            context.fillStyle = transition.color ?? '#000000';
            context.fillRect(0, 0, outputWidth, outputHeight);
            drawToOutput(scene, scenesById, (progress - 0.5) * 2);
          }
        } else if (transition.type === 'Swipe') {
          drawToOutput(fromScene, outgoingScenesById, 1);
          context.save();
          context.beginPath();
          context.rect(canvasViewport.x, canvasViewport.y, canvasViewport.width * progress, canvasViewport.height);
          context.clip();
          drawToOutput(scene, scenesById, 1);
          context.restore();
        } else {
          drawToOutput(fromScene, outgoingScenesById, 1, -baseWidth * progress);
          drawToOutput(scene, scenesById, 1, baseWidth * (1 - progress));
        }
      } else drawToOutput(scene, scenesById, 1);
      context.restore();
      if (transition && progress >= 1 && !finishedTransition) {
        finishedTransition = true;
        onTransitionEndRef.current?.();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      keyProcessor?.dispose();
      for (const sceneCanvas of sceneCanvases.values()) {
        sceneCanvas.width = 0;
        sceneCanvas.height = 0;
      }
      sceneCanvases.clear();
    };
  }, [project.output.baseWidth, project.output.baseHeight, project.output.width, project.output.height, project.scenes, scene, videoElements, imageElements, renderScale, maxFrameRate, renderEnabled, outgoingProject, outgoingScene, transition]);
  return <canvas ref={setCanvas} className="composition-canvas" />;
});

export function RuntimeVideoBank({ sources, runtimes, elements, mediaElements, images, activeSourceIds, programSourceIds, playbackSourceIds, onMediaElement, onMediaPlaybackState, onBrowserElement, onSourceStatus }: {
  sources: Array<StreamSource | RuntimeSource>;
  runtimes: Map<string, MediaStream>;
  elements: Map<string, HTMLVideoElement>;
  mediaElements: Map<string, HTMLMediaElement>;
  images: Map<string, HTMLImageElement>;
  activeSourceIds: Set<string>;
  /** Runtime IDs currently committed to Program for audio routing. */
  programSourceIds: Set<string>;
  /** Media and slideshow IDs allowed to advance (Program plus outgoing fade). */
  playbackSourceIds: Set<string>;
  onMediaElement: (source: RuntimeSource, element: HTMLMediaElement, programActive: boolean) => Promise<void>;
  onMediaPlaybackState: (sourceId: string, element: HTMLMediaElement | null) => void;
  onBrowserElement: (sourceId: string, element: HTMLImageElement) => void;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const runtimeSources = new Map<string, RuntimeSource>();
  for (const source of sources) {
    const runtimeSource = 'originSourceId' in source ? source as RuntimeSource : toRuntimeSource(source);
    // Program config takes priority when more than one view has the same
    // runtime identity. Distinct resources retain distinct runtime IDs.
    // The source list is ordered draft, outgoing, Program by mergeRuntimeSources;
    // overwriting preserves the committed config when the same resource exists
    // in more than one project snapshot.
    runtimeSources.set(runtimeSource.id, runtimeSource);
  }
  const sourceList = [...runtimeSources.values()];
  const includes = (ids: Set<string>, source: RuntimeSource) => ids.has(source.id);
  return <div className="video-staging" aria-hidden="true">
    {sourceList.filter((source) => source.kind === 'image').map((source) => <StageImage key={source.id} sourceId={source.id} assetId={source.assetId} assetExtension={source.assetExtension} elements={images} onSourceStatus={onSourceStatus} />)}
    {sourceList.filter((source) => source.kind === 'slideshow').map((source) => <StageSlideshow key={source.id} source={source} elements={images} isPlaybackActive={includes(playbackSourceIds, source)} onSourceStatus={onSourceStatus} />)}
    {sourceList.filter((source) => source.kind === 'browser').map((source) => <StageBrowser key={source.id} source={source} elements={images} onBrowserElement={onBrowserElement} onSourceStatus={onSourceStatus} />)}
    {sourceList.filter((source) => ['display', 'window', 'camera'].includes(source.kind) || (source.kind === 'media' && source.mediaKind === 'video')).map((source) => (
      <StageVideo key={source.id} source={source} stream={runtimes.get(source.id)} elements={elements} mediaElements={mediaElements} isActive={includes(activeSourceIds, source)} isPlaybackActive={includes(playbackSourceIds, source)} programActive={includes(programSourceIds, source)} onMediaElement={onMediaElement} onMediaPlaybackState={onMediaPlaybackState} onSourceStatus={onSourceStatus} />
    ))}
    {sourceList.filter((source) => source.kind === 'media' && source.mediaKind === 'audio').map((source) => (
      <StageAudio key={source.id} source={source} mediaElements={mediaElements} isPlaybackActive={includes(playbackSourceIds, source)} programActive={includes(programSourceIds, source)} onMediaElement={onMediaElement} onMediaPlaybackState={onMediaPlaybackState} onSourceStatus={onSourceStatus} />
    ))}
  </div>;
}

function StageBrowser({ source, elements, onBrowserElement, onSourceStatus }: {
  source: RuntimeSource;
  elements: Map<string, HTMLImageElement>;
  onBrowserElement: (sourceId: string, element: HTMLImageElement) => void;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const onBrowserElementRef = useRef(onBrowserElement);
  const onSourceStatusRef = useRef(onSourceStatus);
  onBrowserElementRef.current = onBrowserElement;
  onSourceStatusRef.current = onSourceStatus;
  useEffect(() => {
    const image = new Image();
    elements.set(source.id, image);
    image.dataset.sourceUnavailable = 'true';
    image.onload = () => {
      image.dataset.sourceUnavailable = 'false';
      onSourceStatusRef.current?.(source.id, { state: 'ready' });
    };
    image.onerror = () => {
      image.dataset.sourceUnavailable = 'true';
      onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'The browser source could not provide a frame.' });
    };
    onSourceStatusRef.current?.(source.id, { state: 'starting' });
    onBrowserElementRef.current(source.id, image);
    return () => {
      if (elements.get(source.id) === image) elements.delete(source.id);
      const frameUrl = image.dataset.browserFrameUrl;
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
  }, [source.id, elements]);
  return null;
}

function StageImage({ sourceId, assetId, assetExtension, elements, onSourceStatus }: {
  sourceId: string;
  assetId?: string;
  assetExtension?: string;
  elements: Map<string, HTMLImageElement>;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const onSourceStatusRef = useRef(onSourceStatus);
  onSourceStatusRef.current = onSourceStatus;
  useEffect(() => {
    if (!assetId) {
      onSourceStatusRef.current?.(sourceId, { state: 'unavailable', message: 'No image asset is selected.' });
      return;
    }
    const image = new Image();
    onSourceStatusRef.current?.(sourceId, { state: 'starting' });
    image.onload = () => {
      image.dataset.sourceUnavailable = 'false';
      onSourceStatusRef.current?.(sourceId, { state: 'ready' });
    };
    image.onerror = () => {
      image.dataset.sourceUnavailable = 'true';
      onSourceStatusRef.current?.(sourceId, { state: 'unavailable', message: 'The image asset could not be loaded.' });
    };
    elements.set(sourceId, image);
    image.src = mediaAssetUrl(assetId, assetExtension ?? 'png');
    if (image.complete) {
      if (image.naturalWidth > 0) {
        image.dataset.sourceUnavailable = 'false';
        onSourceStatusRef.current?.(sourceId, { state: 'ready' });
      } else {
        image.dataset.sourceUnavailable = 'true';
        onSourceStatusRef.current?.(sourceId, { state: 'unavailable', message: 'The image asset could not be loaded.' });
      }
    }
    return () => {
      if (elements.get(sourceId) === image) elements.delete(sourceId);
      image.src = '';
    };
  }, [sourceId, assetId, assetExtension, elements]);
  return null;
}

function StageSlideshow({ source, elements, isPlaybackActive, onSourceStatus }: {
  source: RuntimeSource;
  elements: Map<string, HTMLImageElement>;
  isPlaybackActive: boolean;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const slideshowImages = source.slideshowImages ?? [];
  const slideStatuses = useRef(new Map<string, SourceStatus>());
  const reportSlideStatus = useCallback((slideSourceId: string, status: SourceStatus) => {
    slideStatuses.current.set(slideSourceId, status);
    const statuses = [...slideStatuses.current.values()];
    const unavailable = statuses.find((item) => item.state === 'unavailable');
    if (unavailable) onSourceStatus?.(source.id, unavailable);
    else if (statuses.length === slideshowImages.length && statuses.every((item) => item.state === 'ready')) {
      onSourceStatus?.(source.id, { state: 'ready' });
    } else onSourceStatus?.(source.id, { state: 'starting' });
  }, [onSourceStatus, slideshowImages.length, source.id]);
  useEffect(() => {
    setSlideshowActive(source.id, isPlaybackActive);
  }, [source.id, isPlaybackActive]);
  useEffect(() => {
    if (slideshowImages.length === 0) onSourceStatus?.(source.id, { state: 'unavailable', message: 'No slideshow images are configured.' });
  }, [onSourceStatus, slideshowImages.length, source.id]);
  useEffect(() => () => forgetSlideshow(source.id), [source.id]);
  return <>
    {slideshowImages.map((slide) => {
      const slideSourceId = `${source.id}:${slide.assetId}`;
      return <StageImage key={slide.assetId} sourceId={slideSourceId} assetId={slide.assetId} assetExtension={slide.assetExtension} elements={elements} onSourceStatus={reportSlideStatus} />;
    })}
  </>;
}

function StageVideo({ source, stream, elements, mediaElements, isActive, isPlaybackActive, programActive, onMediaElement, onMediaPlaybackState, onSourceStatus }: {
  source: RuntimeSource;
  stream?: MediaStream;
  elements: Map<string, HTMLVideoElement>;
  mediaElements: Map<string, HTMLMediaElement>;
  isActive: boolean;
  isPlaybackActive: boolean;
  programActive: boolean;
  onMediaElement: (source: RuntimeSource, element: HTMLMediaElement, programActive: boolean) => Promise<void>;
  onMediaPlaybackState: (sourceId: string, element: HTMLMediaElement | null) => void;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const onMediaElementRef = useRef(onMediaElement);
  const onMediaPlaybackStateRef = useRef(onMediaPlaybackState);
  const onSourceStatusRef = useRef(onSourceStatus);
  const mediaRouteGeneration = useRef(0);
  const programActiveRef = useRef(programActive);
  onMediaElementRef.current = onMediaElement;
  onMediaPlaybackStateRef.current = onMediaPlaybackState;
  onSourceStatusRef.current = onSourceStatus;
  programActiveRef.current = programActive;
  const restartPlaybackWhenActive = source.restartPlaybackWhenActive ?? true;
  const restartPlaybackWhenActiveRef = useRef(restartPlaybackWhenActive);
  restartPlaybackWhenActiveRef.current = restartPlaybackWhenActive;
  const ref = useCallback((element: HTMLVideoElement | null) => {
    const previous = elementRef.current;
    elementRef.current = element;
    if (element) {
      elements.set(source.id, element);
      if (source.kind === 'media') {
        mediaElements.set(source.id, element);
        element.muted = true;
      }
    } else {
      if (elements.get(source.id) === previous) elements.delete(source.id);
      if (mediaElements.get(source.id) === previous) mediaElements.delete(source.id);
    }
  }, [elements, mediaElements, source.id, source.kind]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (source.kind === 'media' && source.assetId) {
      element.srcObject = null;
      element.src = mediaAssetUrl(source.assetId, source.assetExtension ?? 'mp4');
      element.muted = true;
      return () => { element.pause(); element.muted = true; element.removeAttribute('src'); element.load(); };
    }
    element.srcObject = stream ?? null;
    element.muted = true;
    if (stream) void element.play().catch(() => undefined);
    return () => { element.pause(); element.srcObject = null; };
  }, [source.id, source.kind, source.assetId, source.assetExtension, stream]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || source.kind !== 'media' || !source.assetId) return;
    const generation = ++mediaRouteGeneration.current;
    // If only Program status changed, reuse the connected media element and
    // preserve currentTime. The media route is kept fail-closed while inactive.
    element.muted = true;
    void Promise.resolve(onMediaElementRef.current(source, element, programActiveRef.current)).then(() => {
      if (elementRef.current === element && mediaRouteGeneration.current === generation) element.muted = false;
    }).catch(() => {
      if (elementRef.current === element && mediaRouteGeneration.current === generation) element.muted = true;
    });
    return () => {
      if (mediaRouteGeneration.current === generation) mediaRouteGeneration.current += 1;
    };
  }, [source.id]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || source.kind !== 'media' || !source.assetId) return;
    element.loop = source.loop ?? false;
  }, [source.kind, source.assetId, source.loop]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || source.kind !== 'media' || !source.assetId) return;
    setMediaPlaybackActive(element, isPlaybackActive, restartPlaybackWhenActiveRef.current);
  }, [source.id, source.kind, isPlaybackActive]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const publish = () => {
      if (source.kind === 'media') {
        if (!source.assetId) {
          element.dataset.sourceUnavailable = 'true';
          onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'No media asset is configured.' });
        } else if (element.error) {
          element.dataset.sourceUnavailable = 'true';
          onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'The media asset could not be loaded.' });
        } else if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          element.dataset.sourceUnavailable = 'false';
          onSourceStatusRef.current?.(source.id, { state: 'ready' });
        }
        else onSourceStatusRef.current?.(source.id, { state: 'starting' });
      } else if (!isActive) onSourceStatusRef.current?.(source.id, { state: 'starting' });
      else if (!stream || !hasLiveVideoTrack(element)) onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'No live video signal is available.' });
      else if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0) onSourceStatusRef.current?.(source.id, { state: 'ready' });
      else onSourceStatusRef.current?.(source.id, { state: 'starting' });
    };
    publish();
    for (const eventName of ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'emptied'] as const) element.addEventListener(eventName, publish);
    const tracks = stream?.getVideoTracks() ?? [];
    for (const track of tracks) {
      track.addEventListener('ended', publish);
      track.addEventListener('mute', publish);
      track.addEventListener('unmute', publish);
    }
    return () => {
      for (const eventName of ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'emptied'] as const) element.removeEventListener(eventName, publish);
      for (const track of tracks) {
        track.removeEventListener('ended', publish);
        track.removeEventListener('mute', publish);
        track.removeEventListener('unmute', publish);
      }
    };
  }, [source.id, source.kind, source.assetId, stream, isActive]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || source.kind !== 'media') return;
    const updateState = () => onMediaPlaybackStateRef.current(source.id, element);
    updateState();
    for (const eventName of ['play', 'pause', 'ended'] as const) element.addEventListener(eventName, updateState);
    return () => {
      for (const eventName of ['play', 'pause', 'ended'] as const) element.removeEventListener(eventName, updateState);
      onMediaPlaybackStateRef.current(source.id, null);
    };
  }, [source.id, source.kind]);
  return <video ref={ref} data-stage-source={getOriginSourceId(source)} data-stage-runtime-source={source.id} muted playsInline />;
}

function StageAudio({ source, mediaElements, isPlaybackActive, programActive, onMediaElement, onMediaPlaybackState, onSourceStatus }: {
  source: RuntimeSource;
  mediaElements: Map<string, HTMLMediaElement>;
  isPlaybackActive: boolean;
  programActive: boolean;
  onMediaElement: (source: RuntimeSource, element: HTMLMediaElement, programActive: boolean) => Promise<void>;
  onMediaPlaybackState: (sourceId: string, element: HTMLMediaElement | null) => void;
  onSourceStatus?: (sourceId: string, status: SourceStatus) => void;
}) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const onMediaElementRef = useRef(onMediaElement);
  const onMediaPlaybackStateRef = useRef(onMediaPlaybackState);
  const onSourceStatusRef = useRef(onSourceStatus);
  const mediaRouteGeneration = useRef(0);
  const programActiveRef = useRef(programActive);
  onMediaElementRef.current = onMediaElement;
  onMediaPlaybackStateRef.current = onMediaPlaybackState;
  onSourceStatusRef.current = onSourceStatus;
  programActiveRef.current = programActive;
  const restartPlaybackWhenActive = source.restartPlaybackWhenActive ?? true;
  const restartPlaybackWhenActiveRef = useRef(restartPlaybackWhenActive);
  restartPlaybackWhenActiveRef.current = restartPlaybackWhenActive;
  const ref = useCallback((element: HTMLAudioElement | null) => {
    const previous = elementRef.current;
    elementRef.current = element;
    if (element) {
      mediaElements.set(source.id, element);
      element.muted = true;
    } else {
      if (mediaElements.get(source.id) === previous) mediaElements.delete(source.id);
    }
  }, [mediaElements, source.id]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !source.assetId) return;
    element.src = mediaAssetUrl(source.assetId, source.assetExtension ?? 'mp3');
    element.muted = true;
    return () => { element.pause(); element.muted = true; element.removeAttribute('src'); element.load(); };
  }, [source.id, source.assetId, source.assetExtension]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !source.assetId) return;
    const generation = ++mediaRouteGeneration.current;
    element.muted = true;
    void Promise.resolve(onMediaElementRef.current(source, element, programActiveRef.current)).then(() => {
      if (elementRef.current === element && mediaRouteGeneration.current === generation) element.muted = false;
    }).catch(() => {
      if (elementRef.current === element && mediaRouteGeneration.current === generation) element.muted = true;
    });
    return () => {
      if (mediaRouteGeneration.current === generation) mediaRouteGeneration.current += 1;
    };
  }, [source.id]);
  useEffect(() => {
    const element = elementRef.current;
    if (element) element.loop = source.loop ?? false;
  }, [source.assetId, source.loop]);
  useEffect(() => {
    const element = elementRef.current;
    if (element && source.assetId) setMediaPlaybackActive(element, isPlaybackActive, restartPlaybackWhenActiveRef.current);
  }, [source.id, source.assetId, isPlaybackActive]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const publish = () => {
      if (!source.assetId) onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'No media asset is configured.' });
      else if (element.error) onSourceStatusRef.current?.(source.id, { state: 'unavailable', message: 'The media asset could not be loaded.' });
      else if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onSourceStatusRef.current?.(source.id, { state: 'ready' });
      else onSourceStatusRef.current?.(source.id, { state: 'starting' });
    };
    publish();
    for (const eventName of ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'emptied'] as const) element.addEventListener(eventName, publish);
    return () => {
      for (const eventName of ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'emptied'] as const) element.removeEventListener(eventName, publish);
    };
  }, [source.id, source.assetId]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const updateState = () => onMediaPlaybackStateRef.current(source.id, element);
    updateState();
    for (const eventName of ['play', 'pause', 'ended'] as const) element.addEventListener(eventName, updateState);
    return () => {
      for (const eventName of ['play', 'pause', 'ended'] as const) element.removeEventListener(eventName, updateState);
      onMediaPlaybackStateRef.current(source.id, null);
    };
  }, [source.id]);
  return <audio ref={ref} data-stage-source={getOriginSourceId(source)} data-stage-runtime-source={source.id} />;
}

export function hitTestSource(scene: StreamScene, x: number, y: number): StreamSource | null {
  const isAudioOnly = (source: StreamSource) => source.kind === 'microphone' || source.kind === 'desktop-audio' || source.kind === 'application-audio'
    || (source.kind === 'media' && source.mediaKind === 'audio');
  const containsPoint = (source: StreamSource) => source.kind === 'group'
    ? x >= source.transform.x && x <= source.transform.x + source.transform.width
      && y >= source.transform.y && y <= source.transform.y + source.transform.height
    : sourceContainsPoint(source.transform, x, y);
  const hitTestSiblings = (sources: readonly StreamSource[]): StreamSource | null => {
    for (const source of [...sources].reverse()) {
      if (!source.visible || isAudioOnly(source) || !containsPoint(source)) continue;
      if (source.kind === 'group') {
        const childHit = hitTestSiblings(source.children ?? []);
        if (childHit) return childHit;
      }
      return source;
    }
    return null;
  };

  return hitTestSiblings(scene.sources);
}
