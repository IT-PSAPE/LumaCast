import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Group, Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { RenderNode, RenderScene, SceneSurface } from '@lumacast/composition';
import { traverseSceneNodes } from '@lumacast/composition';
import { peekImageEntry, renderSceneNodeContent, SceneSlideBackground, useFontAvailabilityEpoch } from '@lumacast/canvas';
import { useThumbnailScene } from '@renderer/contexts/canvas/canvas-context';
import {
  registerSlideRenderHost,
  SlideRenderError,
  type SlideRenderHostController,
  type SlideRenderJob,
} from './render-slide';

// Off-screen slide rasterization host (AI-agent/MCP slide review). Mounted
// once in the provider tree (App.tsx), it registers into render-slide.ts's
// module-level registry and renders one queued request at a time: build the
// same persisted/live-theme scene ScenePreview's callers resolve
// (useThumbnailScene, see below), mount a read-only Konva stage for it,
// wait for media + fonts + paint, capture, resolve, unmount, advance.
//
// This builds its own minimal Konva tree from @lumacast/canvas primitives
// (SceneSlideBackground, renderSceneNodeContent) rather than importing the
// canvas feature's <SceneStage>, mirroring ndi-frame-capture.tsx — both are
// read-only output surfaces that need a raw Konva.Stage ref, which
// <SceneStage> does not expose, and reusing it would be a feature-to-feature
// import this feature does not need.

// The Konva rendering surface used for every off-screen render: it decodes
// full-resolution media (unlike 'list', which only ever shows thumbnail
// proxies — see SceneNodeMedia/SceneSlideBackgroundMedia's isThumbnailSurface
// checks), never autoplays video (excluded from every LIVE_SURFACES set),
// and paints the same "MISSING MEDIA" placeholder an operator sees for a
// broken asset (MISSING_MEDIA_SURFACES) rather than silently leaving a blank
// slide for a remote reviewer.
const RENDER_SURFACE: SceneSurface = 'monitor';

// getThumbnailScene's *second* argument is a source-policy switch, not the
// Konva surface above: 'show' resolves the slide's persisted/live
// (theme-inherited) content regardless of whatever draft is open in the
// editor — see thumbnailSourcePolicy in canvas-context.tsx. That is the "same
// composition ScenePreview uses" this feature is required to match.
const SCENE_SOURCE_POLICY_SURFACE: SceneSurface = 'show';

const HIDDEN_CONTAINER_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: -100000,
  top: 0,
  pointerEvents: 'none',
  opacity: 0,
};

interface MediaSlot {
  mediaKey: string;
  kind: 'image' | 'video';
}

interface MediaWaitState {
  jobId: number;
  slots: Map<string, MediaSlot>;
  pending: Set<string>;
}

interface ActiveJob {
  jobId: number;
  job: SlideRenderJob;
  scene: RenderScene;
}

function resolvePortalContainer(): Element {
  return document.getElementById('overlay-root') ?? document.body;
}

// Recurses into a group's children (arbitrarily nested) so every image/video
// inside one registers its own wait slot, keyed by its own node id — matching
// what SceneNodeMedia now reports via onMediaLoad(nodeId) for a nested child
// (scene-node-media.tsx), not the group's id.
function collectElementMediaSlots(node: RenderNode, slots: Map<string, MediaSlot>): void {
  if (node.element.type === 'image' || node.element.type === 'video') {
    const src = (node.element.payload as { src?: string }).src;
    if (src) slots.set(node.id, { mediaKey: src, kind: node.element.type });
    return;
  }
  if (node.element.type === 'group') {
    for (const child of node.children ?? []) collectElementMediaSlots(child, slots);
  }
}

function collectMediaSlots(scene: RenderScene): Map<string, MediaSlot> {
  const slots = new Map<string, MediaSlot>();
  const background = scene.slide.background;
  if (background && (background.type === 'image' || background.type === 'video') && background.src) {
    slots.set('background', { mediaKey: background.src, kind: background.type });
  }
  for (const { node } of traverseSceneNodes(scene.nodes)) {
    collectElementMediaSlots(node, slots);
  }
  return slots;
}

// Reconciles any slot the shared image cache has already settled — loaded or
// permanently errored (image-cache.ts) — against the pending set built from
// onMediaLoad callbacks below. onMediaLoad only ever fires for media that
// resolves successfully (SceneNodeMedia/SceneSlideBackgroundMedia never call
// it for broken media), so this is what lets a broken image stop blocking
// capture instead of running out the clock on every render that has one.
// There is no equivalent peek for the video pool, so a permanently broken
// video slot is only released by the overall job timeout.
function reconcileSettledMedia(state: MediaWaitState): boolean {
  for (const key of state.pending) {
    const slot = state.slots.get(key);
    if (slot?.kind !== 'image') continue;
    const entry = peekImageEntry(slot.mediaKey);
    if (entry && (entry.status === 'loaded' || entry.status === 'error')) {
      state.pending.delete(key);
    }
  }
  return state.pending.size === 0;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitUntil(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    function tick() {
      if (predicate()) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    tick();
  });
}

async function waitForFontsReady(): Promise<void> {
  const fonts = typeof document === 'undefined' ? null : document.fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    // A rejected `.ready` promise still means no font load is pending.
  }
}

interface OutputConfig {
  width: number;
  height: number;
  pixelRatio: number;
}

function resolveOutputConfig(scene: RenderScene, job: SlideRenderJob): OutputConfig {
  const pixelRatio = job.width / scene.width;
  const height = job.height ?? Math.round(scene.height * pixelRatio);
  return { width: job.width, height, pixelRatio };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

type CaptureStage = Pick<Konva.Stage, 'toDataURL' | 'getLayers'>;

async function captureStage(
  stage: CaptureStage,
  config: { mimeType: string; quality: number | undefined; pixelRatio: number },
): Promise<string> {
  try {
    return stage.toDataURL({ mimeType: config.mimeType, quality: config.quality, pixelRatio: config.pixelRatio });
  } catch {
    // Mirrors the NDI capture fallback (ndi-frame-capture.tsx): a tainted or
    // otherwise export-hostile canvas still yields pixels through a plain
    // bitmap copy.
    try {
      const canvasEl = stage.getLayers()[0]?.getNativeCanvasElement();
      if (!canvasEl) throw new Error('No native canvas to capture.');
      const bitmap = await createImageBitmap(canvasEl);
      const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable.');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await offscreen.convertToBlob({ type: config.mimeType, quality: config.quality });
      return await blobToDataUrl(blob);
    } catch {
      throw new SlideRenderError('capture-failed', 'Failed to capture the rendered slide.');
    }
  }
}

function toSlideRenderError(error: unknown): SlideRenderError {
  if (error instanceof SlideRenderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SlideRenderError('capture-failed', `Failed to render slide: ${message}`);
}

let nextJobId = 0;

export function SlideRenderHost() {
  const getThumbnailScene = useThumbnailScene();
  const getThumbnailSceneRef = useRef(getThumbnailScene);
  getThumbnailSceneRef.current = getThumbnailScene;

  // Subscribes the shared font-availability tracker so it is actively
  // observing document.fonts/loadingdone while this host is mounted; the
  // pipeline below awaits document.fonts.ready directly below, the same
  // primitive that tracker is itself sourced from (docs/ARCHITECTURE.md).
  useFontAvailabilityEpoch();

  const [active, setActive] = useState<ActiveJob | null>(null);
  const queueRef = useRef<SlideRenderJob[]>([]);
  const processingRef = useRef(false);
  const stageRef = useRef<Konva.Stage | null>(null);
  const mediaStateRef = useRef<MediaWaitState | null>(null);

  if (active && mediaStateRef.current?.jobId !== active.jobId) {
    const slots = collectMediaSlots(active.scene);
    mediaStateRef.current = { jobId: active.jobId, slots, pending: new Set(slots.keys()) };
  } else if (!active) {
    mediaStateRef.current = null;
  }

  const markSlotLoaded = useCallback((jobId: number, key: string) => {
    const state = mediaStateRef.current;
    if (!state || state.jobId !== jobId) return;
    state.pending.delete(key);
  }, []);

  const advance = useCallback(() => {
    for (;;) {
      const next = queueRef.current.shift();
      if (!next) {
        processingRef.current = false;
        setActive(null);
        return;
      }
      const scene = getThumbnailSceneRef.current(next.slideId, SCENE_SOURCE_POLICY_SURFACE);
      if (!scene) {
        next.reject(new SlideRenderError('not-found', `No slide found for id "${next.slideId}".`));
        continue;
      }
      nextJobId += 1;
      setActive({ jobId: nextJobId, job: next, scene });
      return;
    }
  }, []);

  useEffect(() => {
    const controller: SlideRenderHostController = {
      enqueue(job) {
        queueRef.current.push(job);
        if (!processingRef.current) {
          processingRef.current = true;
          advance();
        }
      },
    };
    return registerSlideRenderHost(controller);
  }, [advance]);

  useEffect(() => {
    if (!active) return;
    const { job, scene, jobId } = active;
    const stage = stageRef.current;
    let settled = false;

    if (!stage) {
      job.reject(new SlideRenderError('capture-failed', 'Konva stage failed to mount for rendering.'));
      advance();
      return;
    }

    function isReady(): boolean {
      if (settled) return true;
      const state = mediaStateRef.current;
      if (!state || state.jobId !== jobId) return true;
      return reconcileSettledMedia(state);
    }

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      job.reject(new SlideRenderError('timeout', `Rendering slide "${job.slideId}" timed out after ${job.timeoutMs}ms.`));
      advance();
    }, job.timeoutMs);

    async function run() {
      try {
        await waitUntil(isReady);
        if (settled) return;

        await waitForFontsReady();
        if (settled) return;

        await nextAnimationFrame();
        if (settled) return;
        await nextAnimationFrame();
        if (settled) return;

        const output = resolveOutputConfig(scene, job);
        const dataUrl = await captureStage(stage!, {
          mimeType: job.format === 'jpeg' ? 'image/jpeg' : 'image/png',
          quality: job.quality,
          pixelRatio: output.pixelRatio,
        });
        if (settled) return;

        settled = true;
        clearTimeout(timeoutId);
        job.resolve({ slideId: job.slideId, dataUrl, width: output.width, height: output.height, format: job.format });
        advance();
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        job.reject(toSlideRenderError(error));
        advance();
      }
    }

    void run();

    return () => {
      settled = true;
      clearTimeout(timeoutId);
    };
  }, [active, advance]);

  if (!active) return null;

  const { scene, jobId } = active;

  return createPortal(
    <div key={jobId} style={HIDDEN_CONTAINER_STYLE} aria-hidden>
      <Stage ref={stageRef} width={scene.width} height={scene.height} listening={false}>
        <Layer listening={false}>
          <SceneSlideBackground
            background={scene.slide.background}
            width={scene.width}
            height={scene.height}
            surface={RENDER_SURFACE}
            ownerId={scene.slide.id}
            onMediaLoad={() => markSlotLoaded(jobId, 'background')}
          />
          {traverseSceneNodes(scene.nodes).map(({ node, frame }) => (
            <Group
              key={node.id}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              rotation={frame.rotation}
              opacity={frame.opacity}
              scaleX={frame.scaleX}
              scaleY={frame.scaleY}
              offsetX={frame.offsetX}
              offsetY={frame.offsetY}
            >
              {renderSceneNodeContent(node, RENDER_SURFACE, { onMediaLoad: (nodeId) => markSlotLoaded(jobId, nodeId) })}
            </Group>
          ))}
        </Layer>
      </Stage>
    </div>,
    resolvePortalContainer(),
  );
}
