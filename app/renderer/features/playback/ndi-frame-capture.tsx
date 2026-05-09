import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import type Konva from 'konva';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@core/ndi';
import type { NdiOutputName, TextBinding } from '@core/types';
import { useNdi } from '../../contexts/app-context';
import { SceneNodeMedia } from '../canvas/scene-node-media';
import { SceneNodeShape } from '../canvas/scene-node-shape';
import { SceneNodeText } from '../canvas/scene-node-text';
import { useBinding, type BindingValue } from '../canvas/binding-context';
import type { RenderNode, RenderScene, SceneSurface } from '../canvas/scene-types';
import { useNdiCaptureSource } from './ndi-capture-source';
import NdiReadbackWorker from './ndi-readback-worker?worker';
import type { CaptureRequest, WorkerOutbound } from './ndi-readback-worker';

const FRAME_INTERVAL_MS = 1000 / 30;
// If we've been waiting on an ack longer than this, assume it was lost
// and free up the back-pressure slot so capture can resume.
const ACK_WATCHDOG_MS = 250;

function renderNodeContent(node: RenderNode, surface: SceneSurface, onImageLoad?: () => void) {
  if (node.element.type === 'shape') return <SceneNodeShape node={node} />;
  if (node.element.type === 'text') return <SceneNodeText node={node} />;
  if (node.element.type === 'image' || node.element.type === 'video') return <SceneNodeMedia node={node} surface={surface} onLoad={onImageLoad} />;
  return null;
}

// Cheap signature used to decide whether the output has visibly changed
// since the last capture. Video nodes are excluded because their contents
// tick forward every frame without any RenderNode field changing; the same
// is true for text elements with ticking clock/timer bindings (see
// hasTickingTextBinding in the capture loop below). Slide text and notes
// bindings are included through bindingSignature because their source values
// can change without any RenderNode field changing.
function sceneSignature(nodes: readonly RenderNode[], withAlpha: boolean, bindingSignature: string): string {
  let out = (withAlpha ? 'a1' : 'a0') + bindingSignature;
  for (const node of nodes) {
    out += '|' + node.id + ':' + node.element.updatedAt + ':' + (node.visual.visible === false ? '0' : '1');
  }
  return out;
}

function nodeRuntime(node: RenderNode, bindingValue: BindingValue): BindingValue {
  return {
    ...bindingValue,
    ...node.bindingOverride,
  };
}

function textBindingForNode(node: RenderNode): TextBinding | undefined {
  if (node.element.type !== 'text') return undefined;
  return (node.element.payload as { binding?: TextBinding }).binding;
}

function visibleTextBindingForNode(node: RenderNode): TextBinding | undefined {
  if (node.visual.visible === false) return undefined;
  return textBindingForNode(node);
}

function bindingValueForSignature(binding: TextBinding, runtime: BindingValue): string | null {
  if (binding.kind === 'current-slide-text') return runtime.currentSlideText ?? '';
  if (binding.kind === 'next-slide-text') return runtime.nextSlideText ?? '';
  if (binding.kind === 'slide-notes') return runtime.slideNotes ?? '';
  return null;
}

function sceneBindingSignature(nodes: readonly RenderNode[], bindingValue: BindingValue): string {
  let out = '';
  for (const node of nodes) {
    const binding = visibleTextBindingForNode(node);
    if (!binding) continue;
    const value = bindingValueForSignature(binding, nodeRuntime(node, bindingValue));
    if (value === null) continue;
    out += '|b:' + node.id + ':' + binding.kind + ':' + value.length + ':' + value;
  }
  return out;
}

// Detect text elements whose visible content ticks independently of any
// RenderNode field change (clock advances every second; timer counts down).
// When any such element is on the slide we have to capture every RAF tick,
// because sceneSignature() will never observe their updates.
function hasTickingTextBinding(nodes: readonly RenderNode[], bindingValue: BindingValue): boolean {
  for (const node of nodes) {
    const binding = visibleTextBindingForNode(node);
    if (!binding) continue;
    if (binding.kind === 'clock') return true;
    if (binding.kind === 'timer' && nodeRuntime(node, bindingValue).armedAtMs !== null) return true;
  }
  return false;
}

interface NdiFrameCaptureProps {
  /** Which named NDI output this capture feeds (must match a configured sender). */
  senderName: NdiOutputName;
  /** Scene to render off-screen and ship as frames. */
  scene: RenderScene;
  /** Logical surface used by element renderers (e.g. media surface routing). */
  surface?: SceneSurface;
  /** When false the capture loop is torn down and the off-screen stage is unmounted. */
  enabled: boolean;
}

export function NdiFrameCapture({ senderName, scene, surface = 'show', enabled }: NdiFrameCaptureProps) {
  const { state: { outputConfigs } } = useNdi();
  const bindingValue = useBinding();
  const stageRef = useRef<Konva.Stage>(null);
  const pendingSkippedCapturesRef = useRef(0);
  const pendingDroppedBackpressureRef = useRef(0);
  const inFlightSentAtRef = useRef<number | null>(null);
  const captureStartedAtRef = useRef(0);
  // Date.now() epoch-ms equivalents of the perf.now() timestamps above. Used
  // as cross-process pipeline-latency stamps (renderer's perf.now() can't be
  // compared to main/utility perf.now() — different time origins).
  const captureStartedAtMsRef = useRef(0);
  // Set when the RAF tick first observes a new sceneSignature, cleared when
  // the resulting frame is shipped. Null for heartbeat / video-driven
  // captures where no state change triggered the frame.
  const signatureChangedAtMsRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const framesAckedRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const sharedCaptureSource = useNdiCaptureSource(senderName);
  const hasVideoNodes = useMemo(
    () => scene.nodes.some((node) => node.element.type === 'video'),
    [scene.nodes],
  );
  const bindingSignature = useMemo(
    () => sceneBindingSignature(scene.nodes, bindingValue),
    [bindingValue, scene.nodes],
  );
  const hasDynamicText = useMemo(
    () => hasTickingTextBinding(scene.nodes, bindingValue),
    [bindingValue, scene.nodes],
  );
  const withAlpha = outputConfigs[senderName].withAlpha;

  // Spin up a dedicated worker that owns an OffscreenCanvas and performs the
  // 8 MB pixel readback off the renderer main thread.
  useEffect(() => {
    if (!enabled) return;
    const worker = new NdiReadbackWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'capture-failed') {
        console.error('[NdiFrameCapture] Worker readback failed:', data.error);
        inFlightSentAtRef.current = null;
        return;
      }
      if (data.type !== 'captured') return;
      const captureDurationMs = performance.now() - captureStartedAtRef.current;
      const signatureChangedAtMs = signatureChangedAtMsRef.current;
      signatureChangedAtMsRef.current = null;
      window.castApi.sendNdiFrame(
        senderName,
        data.buffer,
        data.width,
        data.height,
        {
          captureDurationMs,
          readbackDurationMs: data.readbackDurationMs,
          skippedCaptures: pendingSkippedCapturesRef.current,
          framesDroppedBackpressure: pendingDroppedBackpressureRef.current,
          signatureChangedAtMs,
          captureStartedAtMs: captureStartedAtMsRef.current,
        },
      );
      pendingSkippedCapturesRef.current = 0;
      pendingDroppedBackpressureRef.current = 0;
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      framesAckedRef.current = 0;
    };
  }, [enabled, senderName]);

  const captureFrame = useCallback((): boolean => {
    const stage = stageRef.current;
    const canvas = sharedCaptureSource ?? stage?.getLayers()[0]?.getNativeCanvasElement();
    if (!canvas) return false;
    const worker = workerRef.current;
    if (!worker) return false;

    captureStartedAtRef.current = performance.now();
    captureStartedAtMsRef.current = Date.now();
    inFlightSentAtRef.current = performance.now();
    const requestId = ++requestIdRef.current;

    // Snapshot the current Konva canvas into a transferable ImageBitmap, then
    // hand it to the worker. createImageBitmap is async on the main thread but
    // does not block; the actual pixel readback happens off-thread.
    createImageBitmap(canvas)
      .then((bitmap) => {
        const activeWorker = workerRef.current;
        if (!activeWorker) {
          bitmap.close();
          inFlightSentAtRef.current = null;
          return;
        }
        const request: CaptureRequest = {
          type: 'capture',
          bitmap,
          requestId,
          withAlpha,
        };
        activeWorker.postMessage(request, [bitmap]);
      })
      .catch((error) => {
        console.error('[NdiFrameCapture] createImageBitmap failed:', error);
        inFlightSentAtRef.current = null;
      });
    return true;
  }, [sharedCaptureSource, withAlpha]);

  const handleImageLoad = useCallback(() => {
    if (inFlightSentAtRef.current !== null) return;
    stageRef.current?.batchDraw();
    captureFrame();
  }, [captureFrame]);

  // Listen for main-process acks to free up the back-pressure slot.
  useEffect(() => {
    if (!enabled) return;
    return window.castApi.onNdiFrameAck((ackedName) => {
      if (ackedName !== senderName) return;
      framesAckedRef.current += 1;
      inFlightSentAtRef.current = null;
    });
  }, [enabled, senderName]);

  // Single RAF loop driving capture at ~30fps. Only captures when the scene
  // signature changed or there are video nodes; the main process replays the
  // last frame on its own heartbeat when this side stays idle.
  // Back-pressure: if a frame is in flight (no ack yet), skip — bursts piling
  // up in IPC are the main cause of latency under load.
  useEffect(() => {
    if (!enabled) return;

    let rafId: number | null = null;
    let running = true;
    let lastCaptureTime = 0;
    let lastSignature = '';

    function tick(timestamp: number) {
      if (!running) return;
      if (timestamp - lastCaptureTime >= FRAME_INTERVAL_MS) {
        lastCaptureTime = timestamp;

        // Watchdog: if the main process never acked, free the slot so we
        // don't stall forever after a dropped IPC message.
        const sentAt = inFlightSentAtRef.current;
        if (sentAt !== null && performance.now() - sentAt > ACK_WATCHDOG_MS) {
          inFlightSentAtRef.current = null;
        }

        const currentSignature = sceneSignature(scene.nodes, withAlpha, bindingSignature);
        const signatureChanged = currentSignature !== lastSignature;
        const needsInitialFrame = framesAckedRef.current === 0;
        if (needsInitialFrame || signatureChanged || hasVideoNodes || hasDynamicText) {
          if (inFlightSentAtRef.current !== null) {
            pendingDroppedBackpressureRef.current += 1;
          } else {
            // Record signature-change timestamp so we can measure
            // state-change → bits-on-wire latency end-to-end. Heartbeat /
            // video-driven captures (no signature change) leave this null.
            if (signatureChanged && signatureChangedAtMsRef.current === null) {
              signatureChangedAtMsRef.current = Date.now();
            }
            stageRef.current?.batchDraw();
            if (captureFrame()) {
              lastSignature = currentSignature;
            }
          }
        } else {
          pendingSkippedCapturesRef.current += 1;
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      inFlightSentAtRef.current = null;
    };
  }, [bindingSignature, captureFrame, enabled, hasVideoNodes, hasDynamicText, scene, withAlpha]);

  if (!enabled) return null;
  if (sharedCaptureSource) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -99999,
        top: -99999,
        width: NDI_OUTPUT_WIDTH,
        height: NDI_OUTPUT_HEIGHT,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <Stage ref={stageRef} width={NDI_OUTPUT_WIDTH} height={NDI_OUTPUT_HEIGHT} listening={false}>
        <Layer listening={false}>
          {!withAlpha ? (
            <Group>
              <SceneNodeShape node={{
                id: '__ndi-bg',
                element: {
                  id: '__ndi-bg',
                  slideId: '',
                  type: 'shape',
                  x: 0,
                  y: 0,
                  width: NDI_OUTPUT_WIDTH,
                  height: NDI_OUTPUT_HEIGHT,
                  rotation: 0,
                  opacity: 1,
                  zIndex: -1,
                  layer: 'content',
                  payload: { shape: 'rectangle', fillColor: '#000000', fillEnabled: true } as never,
                  createdAt: '',
                  updatedAt: '',
                },
                visual: {
                  visible: true,
                  locked: false,
                  flipX: false,
                  flipY: false,
                  fillEnabled: true,
                  fillColor: '#000000',
                  strokeEnabled: false,
                  strokeColor: '',
                  strokeWidth: 0,
                  strokePosition: 'inside',
                  borderRadius: 0,
                  shadowEnabled: false,
                  shadowColor: '',
                  shadowBlur: 0,
                  shadowOffsetX: 0,
                  shadowOffsetY: 0,
                },
                isVideo: false,
              }} />
            </Group>
          ) : null}
          <Group>
            {scene.nodes.map((node) => {
              if (node.visual.visible === false) return null;
              return (
                <Group
                  key={node.id}
                  x={node.element.x}
                  y={node.element.y}
                  width={node.element.width}
                  height={node.element.height}
                  rotation={node.element.rotation}
                  opacity={node.element.opacity}
                  scaleX={node.visual.flipX ? -1 : 1}
                  scaleY={node.visual.flipY ? -1 : 1}
                  offsetX={node.visual.flipX ? node.element.width : 0}
                  offsetY={node.visual.flipY ? node.element.height : 0}
                >
                  {renderNodeContent(node, surface, handleImageLoad)}
                </Group>
              );
            })}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
