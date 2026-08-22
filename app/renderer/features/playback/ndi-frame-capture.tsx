import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import type Konva from 'konva';
import {
  isNdiFrameTransportPortAnnouncement,
  NDI_OUTPUT_WIDTH,
  NDI_OUTPUT_HEIGHT,
  NDI_VIDEO_FRAME_INTERVAL_MS,
  type NdiFrameDropReason,
  type NdiFrameDropReasonCounts,
  type NdiFrameRelease,
  type NdiFrameTelemetry,
  type NdiOutputName,
} from '@lumacast/protocol';
import type { TextBinding } from '@lumacast/composition';
import { useNdi } from '../../contexts/app-context';
import { renderSceneNodeContent, needsOpaqueBackdrop, SceneSlideBackground, useBinding, type BindingValue, SceneNodeShape } from '@lumacast/canvas';
import { traverseSceneNodes } from '@lumacast/composition';
import type { RenderNode, RenderScene, SceneSurface } from '@lumacast/composition';
import { useNdiCaptureSource } from './ndi-capture-source';
import NdiReadbackWorker from './ndi-readback-worker?worker';
import type {
  AttachTransportRequest,
  CaptureRequest,
  ResetTransportRequest,
  SubmitFrameRequest,
  WorkerOutbound,
} from './ndi-readback-worker';
import {
  claimNdiTakeCorrelation,
  consumeNdiTakeCorrelation,
  doesTakeCorrelationMatch,
  hasPendingNdiTakeCorrelation,
  type NdiTakeCorrelationClaim,
} from '../../utils/ndi-take-correlation';

const FRAME_INTERVAL_MS = NDI_VIDEO_FRAME_INTERVAL_MS;
// If we've been waiting on an ack longer than this, assume it was lost
// and free up the back-pressure slot so capture can resume.
const FRAME_RELEASE_WATCHDOG_MS = 250;
const TRANSPORT_RETRY_INITIAL_MS = 500;
const TRANSPORT_RETRY_MAX_MS = 8_000;
let nextGlobalNdiCaptureAttemptId = 0;
let nextCaptureRequestId = 0;
const ndiCaptureAttemptSessionId = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ndi-capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
})();
type RendererTrackedReleaseDropReason = Extract<NdiFrameRelease['reason'], 'outputDisabled' | 'senderUnavailable'>;

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
  if (binding.kind === 'talk-script-current') return runtime.talkScriptCurrent ?? '';
  if (binding.kind === 'talk-script-progress') return runtime.talkScriptProgress ?? '';
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

export function sceneHasVideoPlayback(scene: RenderScene): boolean {
  return scene.nodes.some((node) => node.element.type === 'video')
    || scene.slide.background?.type === 'video';
}

export function allocateNdiCaptureAttemptId(): number {
  nextGlobalNdiCaptureAttemptId += 1;
  return nextGlobalNdiCaptureAttemptId;
}

export function allocateNdiCaptureAttemptToken(): string {
  return `${ndiCaptureAttemptSessionId}:${allocateNdiCaptureAttemptId()}`;
}

function allocateCaptureRequestId(): number {
  nextCaptureRequestId += 1;
  return nextCaptureRequestId;
}

export function shouldTrackRendererReleaseDropReason(
  release: NdiFrameRelease,
): release is NdiFrameRelease & { accepted: false; reason: RendererTrackedReleaseDropReason } {
  return !release.accepted
    && (release.reason === 'outputDisabled' || release.reason === 'senderUnavailable');
}

interface NdiFrameCaptureProps {
  /** Which named NDI output this capture feeds (must match a configured sender). */
  senderName: NdiOutputName;
  /** Scene to render off-screen and ship as frames. */
  scene: RenderScene;
  /** Logical surface used by element renderers (e.g. media surface routing). */
  surface?: SceneSurface;
  /** Current output item/playlist scope used to reject stale take claims. */
  outputScopeKey: string | null;
  /** When false the capture loop is torn down and the off-screen stage is unmounted. */
  enabled: boolean;
}

type CaptureStageLike = Pick<Konva.Stage, 'getLayers' | 'batchDraw'>;

interface InFlightCaptureAttempt {
  attemptId: string;
  requestId: number;
  sentAtPerfMs: number;
  takeCorrelation: NdiTakeCorrelationClaim | null;
}

export function createEmptyFrameDropReasons(): NdiFrameDropReasonCounts {
  return {
    backpressure: 0,
    ackTimeout: 0,
    captureFailed: 0,
    bitmapFailed: 0,
    invalidPayload: 0,
    outputDisabled: 0,
    senderUnavailable: 0,
    nativeSendFailed: 0,
  };
}

function incrementFrameDropReason(target: NdiFrameDropReasonCounts, reason: NdiFrameDropReason): void {
  target[reason] += 1;
}

export function shouldScheduleCorrectiveRetry(release: NdiFrameRelease): boolean {
  return !release.accepted && release.reason === 'nativeSendFailed';
}

export function doesReleaseMatchAttempt(
  release: NdiFrameRelease,
  attempt: Pick<InFlightCaptureAttempt, 'attemptId'> | null,
): boolean {
  return Boolean(attempt && release.attemptId === attempt.attemptId);
}

export function pinFallbackCaptureStagePixelRatio(stage: CaptureStageLike | null): void {
  if (!stage) return;

  let changed = false;
  for (const layer of stage.getLayers()) {
    const canvas = layer.getCanvas();
    if (canvas.getPixelRatio() === 1) continue;
    canvas.setPixelRatio(1);
    changed = true;
  }

  if (changed) {
    stage.batchDraw();
  }
}

export function NdiFrameCapture({ senderName, scene, surface = 'show', outputScopeKey, enabled }: NdiFrameCaptureProps) {
  const { state: { outputConfigs } } = useNdi();
  const bindingValue = useBinding();
  const stageRef = useRef<Konva.Stage>(null);
  const pendingSkippedCapturesRef = useRef(0);
  const pendingDroppedBackpressureRef = useRef(0);
  const pendingCorrectiveRetriesRef = useRef(0);
  const pendingDropReasonsRef = useRef<NdiFrameDropReasonCounts>(createEmptyFrameDropReasons());
  const inFlightAttemptRef = useRef<InFlightCaptureAttempt | null>(null);
  const leasedTakeCorrelationRef = useRef<NdiTakeCorrelationClaim | null>(null);
  const forceCorrectiveCaptureRef = useRef(false);
  const captureStartedAtRef = useRef(0);
  // Date.now() epoch-ms equivalents of the perf.now() timestamps above. Used
  // as cross-process pipeline-latency stamps (renderer's perf.now() can't be
  // compared to main/utility perf.now() — different time origins).
  const captureStartedAtMsRef = useRef(0);
  // Set when the RAF tick first observes a new sceneSignature, cleared when
  // the resulting frame is shipped. Null for heartbeat / video-driven
  // captures where no state change triggered the frame.
  const signatureChangedAtMsRef = useRef<number | null>(null);
  const acceptedFramesRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const retryNdiFrameTransportRef = useRef<() => void>(() => {});
  const sharedCaptureSource = useNdiCaptureSource(senderName);
  const hasVideoNodes = useMemo(() => sceneHasVideoPlayback(scene), [scene]);
  const bindingSignature = useMemo(
    () => sceneBindingSignature(scene.nodes, bindingValue),
    [bindingValue, scene.nodes],
  );
  const hasDynamicText = useMemo(
    () => hasTickingTextBinding(scene.nodes, bindingValue),
    [bindingValue, scene.nodes],
  );
  const withAlpha = outputConfigs[senderName].withAlpha;

  const handleFrameRelease = useCallback((release: NdiFrameRelease) => {
    if (release.name !== senderName) return;
    const activeAttempt = inFlightAttemptRef.current;
    if (!doesReleaseMatchAttempt(release, activeAttempt)) return;
    inFlightAttemptRef.current = null;
    if (shouldTrackRendererReleaseDropReason(release)) {
      incrementFrameDropReason(pendingDropReasonsRef.current, release.reason);
    }
    if (release.accepted) {
      acceptedFramesRef.current += 1;
      const matchedAttempt = activeAttempt!;
      if (matchedAttempt.takeCorrelation) {
        consumeNdiTakeCorrelation(senderName, matchedAttempt.takeCorrelation.sequenceId);
        if (leasedTakeCorrelationRef.current?.sequenceId === matchedAttempt.takeCorrelation.sequenceId) {
          leasedTakeCorrelationRef.current = null;
        }
      }
    }
    if (shouldScheduleCorrectiveRetry(release)) {
      forceCorrectiveCaptureRef.current = true;
    }
  }, [senderName]);

  // Spin up a dedicated worker that owns an OffscreenCanvas and performs the
  // 8 MB pixel readback off the renderer main thread. A validated port from
  // preload is transferred onward so the same worker can clone each frame
  // directly to the utility process without involving renderer/main JS.
  useEffect(() => {
    if (!enabled) return;
    const worker = new NdiReadbackWorker();
    workerRef.current = worker;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = TRANSPORT_RETRY_INITIAL_MS;
    const clearTransportRetry = () => {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };
    const requestTransport = () => {
      clearTransportRetry();
      window.castApi.requestNdiFrameTransport(senderName);
      const delay = retryDelayMs;
      retryDelayMs = Math.min(retryDelayMs * 2, TRANSPORT_RETRY_MAX_MS);
      retryTimer = setTimeout(requestTransport, delay);
    };
    const scheduleTransportRetry = () => {
      if (retryTimer !== null) return;
      const delay = retryDelayMs;
      retryDelayMs = Math.min(retryDelayMs * 2, TRANSPORT_RETRY_MAX_MS);
      retryTimer = setTimeout(requestTransport, delay);
    };
    retryNdiFrameTransportRef.current = scheduleTransportRetry;
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'released') {
        handleFrameRelease(data.release);
        return;
      }
      if (data.type === 'transport-fallback') {
        if (data.name === senderName) scheduleTransportRetry();
        return;
      }
      if (data.type === 'transport-ready') {
        if (data.name === senderName) {
          clearTransportRetry();
          retryDelayMs = TRANSPORT_RETRY_INITIAL_MS;
        }
        return;
      }
      const activeAttempt = inFlightAttemptRef.current;
      if (!activeAttempt || activeAttempt.requestId !== data.requestId) return;
      if (data.type === 'capture-failed') {
        console.error('[NdiFrameCapture] Worker readback failed:', data.error);
        incrementFrameDropReason(pendingDropReasonsRef.current, 'captureFailed');
        forceCorrectiveCaptureRef.current = true;
        inFlightAttemptRef.current = null;
        return;
      }
      if (data.type === 'readback-complete') {
        const telemetry: NdiFrameTelemetry = {
          attemptId: activeAttempt.attemptId,
          captureDurationMs: performance.now() - captureStartedAtRef.current,
          readbackDurationMs: data.readbackDurationMs,
          skippedCaptures: pendingSkippedCapturesRef.current,
          framesDroppedBackpressure: pendingDroppedBackpressureRef.current,
          correctiveFrameRetries: pendingCorrectiveRetriesRef.current,
          dropReasons: pendingDropReasonsRef.current,
          signatureChangedAtMs: signatureChangedAtMsRef.current,
          takeKind: activeAttempt.takeCorrelation?.kind,
          takeReason: activeAttempt.takeCorrelation?.reason,
          takeSessionId: activeAttempt.takeCorrelation?.sessionId,
          takeSequenceId: activeAttempt.takeCorrelation?.sequenceId,
          takeIssuedAtMs: activeAttempt.takeCorrelation?.takeIssuedAtMs,
          captureStartedAtMs: captureStartedAtMsRef.current,
        };
        signatureChangedAtMsRef.current = null;
        const submit: SubmitFrameRequest = {
          type: 'submit-frame',
          requestId: data.requestId,
          name: senderName,
          attemptId: activeAttempt.attemptId,
          telemetry,
        };
        worker.postMessage(submit);
        pendingSkippedCapturesRef.current = 0;
        pendingDroppedBackpressureRef.current = 0;
        pendingCorrectiveRetriesRef.current = 0;
        pendingDropReasonsRef.current = createEmptyFrameDropReasons();
        return;
      }
      if (data.type === 'captured') {
        window.castApi.sendNdiFrame(
          senderName,
          data.buffer,
          data.width,
          data.height,
          data.telemetry,
        );
      }
    };

    const closePorts = (ports: readonly MessagePort[]) => {
      for (const port of ports) port.close();
    };
    const handleTransportPort = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        closePorts(event.ports);
        return;
      }
      if (!isNdiFrameTransportPortAnnouncement(event.data)) {
        closePorts(event.ports);
        return;
      }
      // Both output capture components receive the window event. Leave a
      // valid port for the component whose output name actually matches it.
      if (event.data.name !== senderName) return;
      if (event.ports.length !== 1) {
        closePorts(event.ports);
        scheduleTransportRetry();
        return;
      }
      clearTransportRetry();
      const port = event.ports[0]!;
      const attach: AttachTransportRequest = { type: 'attach-transport', name: senderName, port };
      try {
        worker.postMessage(attach, [port]);
      } catch {
        port.close();
        scheduleTransportRetry();
      }
    };
    window.addEventListener('message', handleTransportPort);
    requestTransport();
    return () => {
      window.removeEventListener('message', handleTransportPort);
      clearTransportRetry();
      retryNdiFrameTransportRef.current = () => {};
      const reset: ResetTransportRequest = { type: 'reset-transport' };
      worker.postMessage(reset);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      acceptedFramesRef.current = 0;
    };
  }, [enabled, handleFrameRelease, senderName]);

  useEffect(() => () => {
    inFlightAttemptRef.current = null;
    leasedTakeCorrelationRef.current = null;
  }, []);

  const captureFrame = useCallback((takeCorrelation: NdiTakeCorrelationClaim | null): boolean => {
    const stage = stageRef.current;
    const canvas = sharedCaptureSource ?? stage?.getLayers()[0]?.getNativeCanvasElement();
    if (!canvas) return false;
    const worker = workerRef.current;
    if (!worker) return false;

    const sentAtPerfMs = performance.now();
    captureStartedAtRef.current = sentAtPerfMs;
    captureStartedAtMsRef.current = Date.now();
    const attemptId = allocateNdiCaptureAttemptToken();
    const requestId = allocateCaptureRequestId();
    inFlightAttemptRef.current = { attemptId, requestId, sentAtPerfMs, takeCorrelation };

    // Snapshot the current Konva canvas into a transferable ImageBitmap, then
    // hand it to the worker. createImageBitmap is async on the main thread but
    // does not block; the actual pixel readback happens off-thread.
    createImageBitmap(canvas)
      .then((bitmap) => {
        const activeAttempt = inFlightAttemptRef.current;
        const activeWorker = workerRef.current;
        if (!activeWorker || !activeAttempt || activeAttempt.requestId !== requestId) {
          bitmap.close();
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
        const activeAttempt = inFlightAttemptRef.current;
        if (!activeAttempt || activeAttempt.requestId !== requestId) return;
        console.error('[NdiFrameCapture] createImageBitmap failed:', error);
        incrementFrameDropReason(pendingDropReasonsRef.current, 'bitmapFailed');
        forceCorrectiveCaptureRef.current = true;
        inFlightAttemptRef.current = null;
      });
    return true;
  }, [sharedCaptureSource, withAlpha]);

  const handleImageLoad = useCallback(() => {
    stageRef.current?.batchDraw();
    forceCorrectiveCaptureRef.current = true;
  }, []);

  // Listen for host-side frame releases to free up the back-pressure slot.
  useEffect(() => {
    if (!enabled) return;
    return window.castApi.onNdiFrameReleased(handleFrameRelease);
  }, [enabled, handleFrameRelease]);

  useEffect(() => {
    if (!enabled || sharedCaptureSource) return;
    pinFallbackCaptureStagePixelRatio(stageRef.current);
  }, [enabled, sharedCaptureSource]);

  // Single RAF loop driving capture at 30000/1001 fps. Only captures when the scene
  // signature changed or there are video nodes; the main process replays the
  // last frame on its own heartbeat when this side stays idle.
  // Back-pressure: if a frame is in flight (no host-side release yet), skip — bursts piling
  // up in IPC are the main cause of latency under load.
  useEffect(() => {
    if (!enabled) return;

    let rafId: number | null = null;
    let running = true;
    let nextCaptureTime = 0;
    let lastSignature = '';

    function tick(timestamp: number) {
      if (!running) return;
      if (nextCaptureTime === 0) nextCaptureTime = timestamp;
      if (timestamp >= nextCaptureTime) {
        // Advance the deadline instead of resetting it to the current RAF
        // timestamp, so display-refresh quantization cannot accumulate drift.
        do {
          nextCaptureTime += FRAME_INTERVAL_MS;
        } while (nextCaptureTime <= timestamp);

        // Watchdog: if the host-side release never arrived, free the slot so we
        // don't stall forever after a dropped IPC message.
        const activeAttempt = inFlightAttemptRef.current;
        if (activeAttempt && performance.now() - activeAttempt.sentAtPerfMs > FRAME_RELEASE_WATCHDOG_MS) {
          incrementFrameDropReason(pendingDropReasonsRef.current, 'ackTimeout');
          forceCorrectiveCaptureRef.current = true;
          inFlightAttemptRef.current = null;
          const reset: ResetTransportRequest = { type: 'reset-transport' };
          workerRef.current?.postMessage(reset);
          retryNdiFrameTransportRef.current();
        }

        const currentSignature = sceneSignature(scene.nodes, withAlpha, bindingSignature);
        const signatureChanged = currentSignature !== lastSignature;
        const currentSlideId = scene.slide?.id ?? null;
        if (!doesTakeCorrelationMatch(leasedTakeCorrelationRef.current, currentSlideId, outputScopeKey)) {
          leasedTakeCorrelationRef.current = null;
        }
        const hasPendingTake = currentSlideId
          ? hasPendingNdiTakeCorrelation(senderName, currentSlideId, outputScopeKey)
          : false;
        const needsTakeCapture = hasPendingTake && leasedTakeCorrelationRef.current === null;
        const needsInitialFrame = acceptedFramesRef.current === 0;
        const needsCorrectiveFrame = forceCorrectiveCaptureRef.current;
        if (needsInitialFrame || signatureChanged || hasVideoNodes || hasDynamicText || needsCorrectiveFrame || needsTakeCapture) {
          if (inFlightAttemptRef.current !== null) {
            pendingDroppedBackpressureRef.current += 1;
            incrementFrameDropReason(pendingDropReasonsRef.current, 'backpressure');
          } else {
            // Record signature-change timestamp so we can measure
            // state-change → accepted native-send latency end-to-end.
            // Heartbeat / video-driven captures (no signature change) leave
            // this null.
            if (signatureChanged && signatureChangedAtMsRef.current === null) {
              signatureChangedAtMsRef.current = Date.now();
            }
            let takeCorrelation = leasedTakeCorrelationRef.current;
            if (!takeCorrelation && currentSlideId) {
              takeCorrelation = claimNdiTakeCorrelation(senderName, currentSlideId, outputScopeKey);
              if (takeCorrelation) leasedTakeCorrelationRef.current = takeCorrelation;
            }
            stageRef.current?.batchDraw();
            if (captureFrame(takeCorrelation)) {
              if (needsCorrectiveFrame) {
                pendingCorrectiveRetriesRef.current += 1;
                forceCorrectiveCaptureRef.current = false;
              }
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
    };
  }, [bindingSignature, captureFrame, enabled, hasVideoNodes, hasDynamicText, outputScopeKey, scene, senderName, withAlpha]);

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
          {needsOpaqueBackdrop(withAlpha) ? (
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
            <SceneSlideBackground background={scene.slide.background} width={scene.width} height={scene.height} surface={surface} ownerId={scene.slide.id} onMediaLoad={handleImageLoad} />
          </Group>
          <Group>
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
                {renderSceneNodeContent(node, surface, { onMediaLoad: handleImageLoad })}
              </Group>
            ))}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
