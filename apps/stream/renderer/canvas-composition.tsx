import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { mediaAssetUrl, type SourceCrop, type StreamProject, type StreamScene, type StreamSource } from '../shared/desktop-api';
import { ChromaKeyProcessor } from './chroma-key';
import { currentSlideshowSlideIndex, forgetSlideshow, slideshowImageElementKey } from './slideshow';
import type { SceneTransition } from './scene-transition';

interface Props {
  project: StreamProject;
  scene: StreamScene;
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  renderScale?: number;
  transition?: SceneTransition | null;
  onTransitionEnd?: () => void;
}

function isAudioOnly(source: StreamSource): boolean {
  return source.kind === 'microphone' || (source.kind === 'media' && source.mediaKind === 'audio');
}

function clampCrop(crop: SourceCrop | undefined, width: number, height: number): SourceCrop {
  const left = Math.min(crop?.left ?? 0, width);
  const right = Math.min(crop?.right ?? 0, width - left);
  const top = Math.min(crop?.top ?? 0, height);
  const bottom = Math.min(crop?.bottom ?? 0, height - top);
  return { left, right, top, bottom };
}

function drawScene(
  context: CanvasRenderingContext2D,
  scene: StreamScene,
  outputWidth: number,
  height: number,
  videos: Map<string, HTMLVideoElement>,
  images: Map<string, HTMLImageElement>,
  keyProcessor: ChromaKeyProcessor | null,
  alpha: number,
  offsetX = 0,
): void {
  context.save();
  context.globalAlpha = alpha;
  if (offsetX !== 0) context.translate(offsetX, 0);
  for (const source of scene.sources) {
    if (!source.visible || isAudioOnly(source)) continue;
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
    if (source.kind === 'color') {
      context.fillStyle = source.color ?? '#17191f';
      context.fillRect(x, y, boxWidth, boxHeight);
    } else if (source.kind === 'text') {
      context.fillStyle = source.color ?? '#ffffff';
      context.textBaseline = 'top';
      context.font = `700 ${Math.max(24, Math.round(height * 0.065))}px "Segoe UI", sans-serif`;
      const lines = (source.text ?? 'Text').split('\n');
      lines.forEach((line, index) => context.fillText(line, x, y + index * Math.max(34, height * 0.075), boxWidth));
    } else if (source.kind === 'image' || source.kind === 'browser' || source.kind === 'slideshow') {
      const slideshowImages = source.kind === 'slideshow' ? source.slideshowImages ?? [] : [];
      const slideIndex = source.kind === 'slideshow'
        ? currentSlideshowSlideIndex(source.id, slideshowImages.length, source.slideshowIntervalSeconds ?? 5, source.slideshowLoop ?? true)
        : -1;
      const image = images.get(slideshowImageElementKey(source.id, slideshowImages, slideIndex));
      if (image?.complete && image.naturalWidth > 0) {
        const crop = clampCrop(source.crop, image.naturalWidth, image.naturalHeight);
        const cropWidth = image.naturalWidth - crop.left - crop.right;
        const cropHeight = image.naturalHeight - crop.top - crop.bottom;
        if (cropWidth > 0 && cropHeight > 0) {
          let keyed: HTMLCanvasElement | null = null;
          if (source.chromaKey?.enabled && keyProcessor) {
            try { keyed = keyProcessor.render(image, source.transform, source.chromaKey, crop, image.naturalWidth, image.naturalHeight); } catch { /* Keep drawing the original if a frame cannot be keyed. */ }
          }
          try { if (keyed) context.drawImage(keyed, 0, 0, outputWidth, height); else context.drawImage(image, crop.left, crop.top, cropWidth, cropHeight, x, y, boxWidth, boxHeight); } catch { /* The image may become unavailable while it decodes. */ }
        }
      }
    } else {
      const video = videos.get(source.id);
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const crop = clampCrop(source.crop, video.videoWidth, video.videoHeight);
        const cropWidth = video.videoWidth - crop.left - crop.right;
        const cropHeight = video.videoHeight - crop.top - crop.bottom;
        if (cropWidth > 0 && cropHeight > 0) {
          let keyed: HTMLCanvasElement | null = null;
          if (source.chromaKey?.enabled && keyProcessor) {
            try { keyed = keyProcessor.render(video, source.transform, source.chromaKey, crop, video.videoWidth, video.videoHeight); } catch { /* Keep drawing the original if a frame cannot be keyed. */ }
          }
          try { if (keyed) context.drawImage(keyed, 0, 0, outputWidth, height); else context.drawImage(video, crop.left, crop.top, cropWidth, cropHeight, x, y, boxWidth, boxHeight); } catch { /* A frame may become unavailable while capture ends. */ }
        }
      }
    }
    context.restore();
  }
  context.restore();
}

export const CanvasComposition = forwardRef<HTMLCanvasElement, Props>(function CanvasComposition(
  { project, scene, videoElements, imageElements, renderScale = 1, transition, onTransitionEnd },
  canvasRef,
) {
  const localCanvas = useRef<HTMLCanvasElement | null>(null);
  const setCanvas = useCallback((element: HTMLCanvasElement | null) => {
    localCanvas.current = element;
    if (typeof canvasRef === 'function') canvasRef(element);
    else if (canvasRef) canvasRef.current = element;
  }, [canvasRef]);
  useEffect(() => {
    const canvas = localCanvas.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return;
    const scale = Math.max(0.1, Math.min(1, renderScale));
    canvas.width = Math.max(1, Math.round(project.output.width * scale));
    canvas.height = Math.max(1, Math.round(project.output.height * scale));
    let frame = 0;
    let finishedTransition = false;
    let keyProcessor: ChromaKeyProcessor | null = null;
    try { keyProcessor = new ChromaKeyProcessor(project.output.width, project.output.height, scale); } catch { /* Chroma key is unavailable when WebGL cannot initialize. */ }
    const draw = () => {
      const height = project.output.height;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(canvas.width / project.output.width, canvas.height / project.output.height);
      const fromScene = transition ? project.scenes.find((item) => item.id === transition.fromSceneId) : null;
      const progress = transition ? Math.min(1, Math.max(0, (performance.now() - transition.startedAt) / transition.durationMs)) : 1;
      if (transition && fromScene && progress < 1) {
        if (transition.type === 'Fade') {
          drawScene(context, fromScene, project.output.width, height, videoElements, imageElements, keyProcessor, 1 - progress);
          drawScene(context, scene, project.output.width, height, videoElements, imageElements, keyProcessor, progress);
        } else if (transition.type === 'FadeToColor') {
          if (progress < 0.5) {
            drawScene(context, fromScene, project.output.width, height, videoElements, imageElements, keyProcessor, 1);
            context.save();
            context.globalAlpha = progress * 2;
            context.fillStyle = transition.color ?? '#000000';
            context.fillRect(0, 0, project.output.width, project.output.height);
            context.restore();
          } else {
            context.fillStyle = transition.color ?? '#000000';
            context.fillRect(0, 0, project.output.width, project.output.height);
            drawScene(context, scene, project.output.width, height, videoElements, imageElements, keyProcessor, (progress - 0.5) * 2);
          }
        } else if (transition.type === 'Swipe') {
          drawScene(context, fromScene, project.output.width, height, videoElements, imageElements, keyProcessor, 1);
          context.save();
          context.beginPath();
          context.rect(0, 0, project.output.width * progress, project.output.height);
          context.clip();
          drawScene(context, scene, project.output.width, height, videoElements, imageElements, keyProcessor, 1);
          context.restore();
        } else {
          drawScene(context, fromScene, project.output.width, height, videoElements, imageElements, keyProcessor, 1, -project.output.width * progress);
          drawScene(context, scene, project.output.width, height, videoElements, imageElements, keyProcessor, 1, project.output.width * (1 - progress));
        }
      } else drawScene(context, scene, project.output.width, height, videoElements, imageElements, keyProcessor, 1);
      context.restore();
      if (transition && progress >= 1 && !finishedTransition) {
        finishedTransition = true;
        onTransitionEnd?.();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      keyProcessor?.dispose();
    };
  }, [project.output.width, project.output.height, project.scenes, scene, videoElements, imageElements, renderScale, transition, onTransitionEnd]);

  return <canvas ref={setCanvas} className="composition-canvas" />;
});

export function RuntimeVideoBank({ sources, runtimes, elements, images, activeSourceIds, onMediaElement, onBrowserElement }: {
  sources: StreamSource[];
  runtimes: Map<string, MediaStream>;
  elements: Map<string, HTMLVideoElement>;
  images: Map<string, HTMLImageElement>;
  activeSourceIds: Set<string>;
  onMediaElement: (source: StreamSource, element: HTMLMediaElement) => void;
  onBrowserElement: (sourceId: string, element: HTMLImageElement) => void;
}) {
  return <div className="video-staging" aria-hidden="true">
    {sources.filter((source) => source.kind === 'image').map((source) => <StageImage key={source.id} sourceId={source.id} assetId={source.assetId} assetExtension={source.assetExtension} elements={images} />)}
    {sources.filter((source) => source.kind === 'slideshow').map((source) => <StageSlideshow key={source.id} source={source} elements={images} />)}
    {sources.filter((source) => source.kind === 'browser').map((source) => <StageBrowser key={source.id} source={source} elements={images} onBrowserElement={onBrowserElement} />)}
    {sources.filter((source) => ['display', 'window', 'camera'].includes(source.kind) || (source.kind === 'media' && source.mediaKind === 'video')).map((source) => (
      <StageVideo key={source.id} source={source} stream={runtimes.get(source.id)} elements={elements} isActive={activeSourceIds.has(source.id)} onMediaElement={onMediaElement} />
    ))}
    {sources.filter((source) => source.kind === 'media' && source.mediaKind === 'audio').map((source) => (
      <StageAudio key={source.id} source={source} isActive={activeSourceIds.has(source.id)} onMediaElement={onMediaElement} />
    ))}
  </div>;
}

function StageBrowser({ source, elements, onBrowserElement }: {
  source: StreamSource;
  elements: Map<string, HTMLImageElement>;
  onBrowserElement: (sourceId: string, element: HTMLImageElement) => void;
}) {
  useEffect(() => {
    const image = new Image();
    elements.set(source.id, image);
    onBrowserElement(source.id, image);
    return () => {
      elements.delete(source.id);
      const frameUrl = image.dataset.browserFrameUrl;
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      image.src = '';
    };
  }, [source.id, elements, onBrowserElement]);
  return null;
}

function StageImage({ sourceId, assetId, assetExtension, elements }: { sourceId: string; assetId?: string; assetExtension?: string; elements: Map<string, HTMLImageElement> }) {
  useEffect(() => {
    if (!assetId) return;
    const image = new Image();
    image.src = mediaAssetUrl(assetId, assetExtension ?? 'png');
    elements.set(sourceId, image);
    return () => { elements.delete(sourceId); image.src = ''; };
  }, [sourceId, assetId, assetExtension, elements]);
  return null;
}

function StageSlideshow({ source, elements }: { source: StreamSource; elements: Map<string, HTMLImageElement> }) {
  const slideshowImages = source.slideshowImages ?? [];
  useEffect(() => () => forgetSlideshow(source.id), [source.id]);
  return <>
    {slideshowImages.map((slide) => <StageImage key={slide.assetId} sourceId={`${source.id}:${slide.assetId}`} assetId={slide.assetId} assetExtension={slide.assetExtension} elements={elements} />)}
  </>;
}

function StageVideo({ source, stream, elements, isActive, onMediaElement }: {
  source: StreamSource;
  stream?: MediaStream;
  elements: Map<string, HTMLVideoElement>;
  isActive: boolean;
  onMediaElement: (source: StreamSource, element: HTMLMediaElement) => void;
}) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const ref = useCallback((element: HTMLVideoElement | null) => {
    elementRef.current = element;
    if (element) {
      elements.set(source.id, element);
      if (source.kind === 'media') onMediaElement(source, element);
    } else elements.delete(source.id);
  }, [elements, source, onMediaElement]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (source.kind === 'media' && source.assetId) {
      element.srcObject = null;
      element.src = mediaAssetUrl(source.assetId, source.assetExtension ?? 'mp4');
      element.loop = source.loop ?? true;
      element.muted = false;
      if (isActive) void element.play().catch(() => undefined); else element.pause();
      return () => { element.pause(); element.removeAttribute('src'); element.load(); };
    }
    element.srcObject = stream ?? null;
    element.muted = true;
    if (stream) void element.play().catch(() => undefined);
    return () => { element.pause(); element.srcObject = null; };
  }, [source.id, source.kind, source.assetId, source.loop, stream, isActive]);
  return <video ref={ref} data-stage-source={source.id} muted playsInline />;
}

function StageAudio({ source, isActive, onMediaElement }: {
  source: StreamSource;
  isActive: boolean;
  onMediaElement: (source: StreamSource, element: HTMLMediaElement) => void;
}) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const ref = useCallback((element: HTMLAudioElement | null) => {
    elementRef.current = element;
    if (element) onMediaElement(source, element);
  }, [source, onMediaElement]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !source.assetId) return;
    element.src = mediaAssetUrl(source.assetId, source.assetExtension ?? 'mp3');
    element.loop = source.loop ?? true;
    if (isActive) void element.play().catch(() => undefined); else element.pause();
    return () => { element.pause(); element.removeAttribute('src'); element.load(); };
  }, [source.id, source.assetId, source.loop, isActive]);
  return <audio ref={ref} data-stage-source={source.id} />;
}

export function hitTestSource(scene: StreamScene, x: number, y: number): StreamSource | null {
  for (const source of [...scene.sources].reverse()) {
    if (!source.visible || isAudioOnly(source)) continue;
    const { x: left, y: top, width, height } = source.transform;
    if (x >= left && x <= left + width && y >= top && y <= top + height) return source;
  }
  return null;
}
