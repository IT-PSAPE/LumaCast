import { useCallback, useEffect, useState } from 'react';
import { BindingProvider, SceneOutputStage, retainVideoSource, getLayerVideoElement, subscribeToVideoPool } from '@lumacast/canvas';
import type { NdiGpuOutputApi, NdiGpuSceneSnapshot } from '@lumacast/protocol';

declare global { interface Window { ndiGpuApi?: NdiGpuOutputApi } }

type LayerVideo = NonNullable<NdiGpuSceneSnapshot['layerVideo']>;

export function synchronizeLayerVideo(element: HTMLVideoElement, video: LayerVideo, nowMs: number): boolean {
  const elapsed = video.playing ? Math.max(0, nowMs - video.observedAtMs) / 1000 * video.playbackRate : 0;
  let target = video.currentTime + elapsed;
  if (Number.isFinite(element.duration) && element.duration > 0) {
    target = video.loop ? target % element.duration : Math.min(target, element.duration);
  }
  element.loop = video.loop;
  element.playbackRate = video.playbackRate;
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) return false;
  const seek = Math.abs(element.currentTime - target) > (video.playing ? 0.08 : 0.001);
  if (seek) element.currentTime = target;
  if (video.playing && element.paused) void element.play().catch((error) => console.error('[NDI video play]', error));
  else if (!video.playing && !element.paused) element.pause();
  return seek;
}

export function NdiGpuView() {
  const [snapshot, setSnapshot] = useState<NdiGpuSceneSnapshot | null>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [redrawVersion, setRedrawVersion] = useState(0);
  useEffect(() => {
    const remove = window.ndiGpuApi?.onScene((next) => setSnapshot((previous) => previous?.revisionId === next.revisionId ? { ...next, scene: previous.scene, binding: previous.binding } : next));
    window.ndiGpuApi?.ready();
    return remove;
  }, []);
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const video = snapshot?.layerVideo;
  useEffect(() => {
    if (!video) return;
    const handle = retainVideoSource(video.src, { autoplay: false, muted: true, loop: video.loop, playbackRate: video.playbackRate });
    return () => handle.release();
  }, [video?.src]);
  useEffect(() => {
    if (!video) return;
    let element: HTMLVideoElement | null = null;
    const redraw = () => setRedrawVersion((version) => version + 1);
    const synchronize = () => {
      const next = getLayerVideoElement(video.src);
      if (next !== element) {
        element?.removeEventListener('seeked', redraw);
        element = next;
        element?.addEventListener('seeked', redraw);
      }
      if (element) synchronizeLayerVideo(element, video, Date.now());
    };
    // Retaining a source can precede loadeddata. The pool notification applies
    // the most recent playback snapshot as soon as that source becomes usable.
    const unsubscribe = subscribeToVideoPool(synchronize);
    synchronize();
    return () => { unsubscribe(); element?.removeEventListener('seeked', redraw); };
  }, [video]);
  const onDraw = useCallback(() => window.ndiGpuApi?.ready(snapshot?.revisionId), [snapshot?.revisionId]);
  if (!snapshot) return null;
  return <BindingProvider value={snapshot.binding}>
    <SceneOutputStage scene={snapshot.scene} surface={snapshot.name === 'audience' ? 'ndi-show' : 'ndi-stage'} width={size.width} height={size.height} redrawVersion={redrawVersion} onDraw={onDraw} />
  </BindingProvider>;
}
