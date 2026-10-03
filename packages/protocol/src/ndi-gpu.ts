import type { BindingValue, RenderScene, RenderNode } from '@lumacast/composition';
import type { NdiFrameTelemetry, NdiOutputName } from './ndi-observability';
import { isNdiFrameTransportAttemptId } from './ndi-frame-transport';
import { sanitizeNdiFrameTelemetry } from './codecs';

export const NDI_GPU_SCENE_CHANNEL = 'ndi:gpuScene';
export const NDI_GPU_SCENE_READY_CHANNEL = 'ndi:gpuSceneReady';

export interface NdiSharedTextureHandle {
  platform: 'darwin' | 'win32' | 'linux';
  surfaceId?: number;
  dxgiHandle?: string;
  targetPid?: number;
  token?: string;
  modifier?: string;
  planes?: Array<{ stride: number; offset: number; size: number }>;
}
export interface NdiGpuTransport {
  supported: boolean;
  receiverEndpoint: string;
  pid: number;
}
export interface NdiGpuFrameResult {
  conversionDurationMs: number;
  sendDurationMs: number;
  frameBytes: number;
}
export interface NdiGpuSceneSnapshot {
  name: NdiOutputName;
  revisionId: string;
  scene: RenderScene;
  binding: BindingValue;
  layerVideo: {
    src: string;
    currentTime: number;
    playing: boolean;
    loop: boolean;
    playbackRate: number;
    observedAtMs: number;
  } | null;
  telemetry?: NdiFrameTelemetry;
}
export interface NdiGpuOutputApi {
  onScene(callback: (scene: NdiGpuSceneSnapshot) => void): () => void;
  ready(revisionId?: string): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Scene descriptions are bounded renderer data; native handles never enter this channel. */
export function decodeNdiGpuSceneSnapshot(value: unknown): NdiGpuSceneSnapshot | null {
  if (!record(value) || (value.name !== 'audience' && value.name !== 'stage')
      || !isNdiFrameTransportAttemptId(value.revisionId) || !record(value.scene) || !record(value.binding)) return null;
  const scene = value.scene;
  if (!finite(scene.width, 1, 16384) || !finite(scene.height, 1, 16384)
      || !record(scene.slide) || typeof scene.slide.id !== 'string' || !Array.isArray(scene.nodes) || scene.nodes.length > 10000) return null;
  const pending = [...scene.nodes];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++nodes > 10000 || !record(node) || !record(node.element) || !record(node.visual)
        || typeof node.id !== 'string' || typeof node.element.type !== 'string'
        || !['text', 'shape', 'image', 'video', 'group'].includes(node.element.type)) return null;
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity']) {
      if (!finite(node.element[key], -1_000_000, 1_000_000)) return null;
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children) || node.children.length + pending.length + nodes > 10000) return null;
      pending.push(...node.children);
    }
  }
  if (!record(value.binding.timerReadings)) return null;
  for (const key of ['currentSlideText', 'nextSlideText', 'slideNotes']) {
    if (value.binding[key] !== null && typeof value.binding[key] !== 'string') return null;
  }
  const video = value.layerVideo;
  if (video !== null && (!record(video) || typeof video.src !== 'string'
      || !finite(video.currentTime, 0, 1e9) || !finite(video.observedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || !finite(video.playbackRate, 0.0625, 16) || typeof video.playing !== 'boolean' || typeof video.loop !== 'boolean')) return null;
  try {
    if (JSON.stringify(value).length > 4 * 1024 * 1024) return null;
  } catch { return null; }
  const telemetry = sanitizeNdiFrameTelemetry(value.telemetry);
  return {
    name: value.name, revisionId: value.revisionId,
    scene: scene as unknown as RenderScene, binding: value.binding as unknown as BindingValue,
    layerVideo: video as NdiGpuSceneSnapshot['layerVideo'], ...(telemetry ? { telemetry } : {}),
  };
}

export function sceneVideoSource(nodes: readonly RenderNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.element.id === id && node.element.type === 'video') {
      const payload = node.element.payload as { src?: string };
      return payload.src ?? null;
    }
    const nested = node.children ? sceneVideoSource(node.children, id) : null;
    if (nested) return nested;
  }
  return null;
}
