import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { getStreamService, resolveStreamDestination, validateStreamServiceSettings } from '../../../shared/stream-services';
import type { StreamServiceId } from '../../../shared/stream-services';
import type { AudioMixerEngine } from '../../audio-mixer';
import zoomAudioProcessorUrl from '../../zoom-audio-processor.js?url';
import { discardZoomMediaPort, waitForZoomMediaPort } from './zoom-media-port';
import {
  createDefaultStreamServiceSettings,
  type StreamAPI, type StreamOutputSettings, type StreamProject, type StreamRuntimeStatus, type StreamServiceSettings,
} from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

interface ActiveStreaming {
  id: string;
  outputId: string;
  recorder: MediaRecorder;
  captureStream: MediaStream;
  startedAt: number;
  writeQueue: Promise<void>;
  failure: unknown;
}

interface ActiveZoomStreaming {
  id: string;
  port: MessagePort;
  canvas: HTMLCanvasElement;
  audioTrack: MediaStreamTrack;
  mixer: AudioMixerEngine;
  settings: StreamOutputSettings;
  startedAt: number;
  started: boolean;
  stopped: boolean;
  framePending: boolean;
  animationFrame: number | null;
  audioSource: MediaStreamAudioSourceNode | null;
  audioNode: AudioWorkletNode | null;
}

interface ZoomVideoFrameLike {
  allocationSize(options: { format: 'I420' }): number;
  copyTo(destination: Uint8Array, options: { format: 'I420' }): Promise<Array<{ offset: number; stride: number }>>;
  close(): void;
}

interface ZoomVideoFrameConstructor {
  new(source: CanvasImageSource, init: { timestamp: number }): ZoomVideoFrameLike;
}

function buildStreamOutputSettings(output: StreamProject['output']): StreamOutputSettings {
  return {
    width: output.width,
    height: output.height,
    frameRate: output.frameRate,
    videoBitrateKbps: output.streamVideoBitrateKbps,
    audioBitrateKbps: output.streamAudioBitrateKbps,
    rateControl: output.streamRateControl,
    encoder: output.streamVideoEncoder,
    encoderQuality: output.streamEncoderQuality,
    hardwareEncoding: output.streamHardwareEncoding,
    keyframeIntervalSeconds: output.streamKeyframeIntervalSeconds,
  };
}

function aggregateOutputStatuses(statuses: Record<string, StreamRuntimeStatus>): StreamRuntimeStatus {
  const values = Object.values(statuses);
  return values.find((value) => value.state === 'live')
    ?? values.find((value) => value.state === 'connecting')
    ?? values.find((value) => value.state === 'error')
    ?? { state: 'stopped' };
}

export interface UseStreamingParams {
  api: StreamAPI;
  project: StreamProject | null;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  ensureMixer: () => AudioMixerEngine;
  setActionError: (message: string) => void;
}

export interface UseStreamingResult {
  streamingStartedAt: number | null;
  streamStatus: StreamRuntimeStatus;
  outputStatuses: Record<string, StreamRuntimeStatus>;
  activeOutputIds: string[];
  outputStartedAt: Record<string, number>;
  reconnectCount: number;
  streamDialogOpen: boolean;
  setStreamDialogOpen: Dispatch<SetStateAction<boolean>>;
  openStreamDialog: () => void;
  streamServiceSettings: StreamServiceSettings;
  setStreamServiceSettings: Dispatch<SetStateAction<StreamServiceSettings>>;
  streamServiceLabel: string;
  startStreaming: (destination: string, settings: StreamOutputSettings, outputId?: string) => Promise<void>;
  startPreparedStreaming: (startOutput: () => Promise<string>, outputId: string, settings?: StreamOutputSettings) => Promise<void>;
  stopStreaming: (outputId?: string) => void;
  goLive: () => void;
  goLiveForService: (service: StreamServiceId | 'zoom') => void;
  /** Whether a stream is currently connecting or live — feeds `useWorkspace`'s collection/profile-switch gate. */
  isActive: () => boolean;
}

/** Live streaming: destination/key settings (loaded from and saved to the stream-settings store), start/stop, and connection status. Mirrors the former inline App.tsx implementation exactly. */
export function useStreaming(params: UseStreamingParams): UseStreamingResult {
  const { api, project, programCanvasRef, ensureMixer, setActionError } = params;

  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);
  const [outputStatuses, setOutputStatuses] = useState<Record<string, StreamRuntimeStatus>>({});
  const [reconnectCounts, setReconnectCounts] = useState<Record<string, number>>({});
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamServiceSettings, setStreamServiceSettings] = useState<StreamServiceSettings>(createDefaultStreamServiceSettings);

  const streaming = useRef(new Map<string, ActiveStreaming>());
  const zoomStreaming = useRef<ActiveZoomStreaming | null>(null);
  const startZoomMediaRef = useRef<(active: ActiveZoomStreaming) => void>(() => undefined);
  const startingOutputs = useRef(new Set<string>());
  const cancelledStartingOutputs = useRef(new Set<string>());
  const outputStatusRef = useRef<Record<string, StreamRuntimeStatus>>({});
  const outputsEverLive = useRef(new Set<string>());
  const mountedRef = useRef(true);

  // Guards the debounced save effect below from firing before the load below
  // resolves: `streamServiceSettings` starts out holding client-side defaults,
  // and without this, the save effect's 600ms timer could write those defaults
  // over the real stored settings if it fires before the load settles.
  const streamServiceSettingsLoadedRef = useRef(false);

  const refreshStreamingStartedAt = () => {
    const startedAt = [
      ...[...streaming.current.values()].map((active) => active.startedAt),
      ...(zoomStreaming.current ? [zoomStreaming.current.startedAt] : []),
    ];
    setStreamingStartedAt(startedAt.length ? Math.min(...startedAt) : null);
  };

  const disposeZoomStreaming = (active: ActiveZoomStreaming, stopMainSession: boolean) => {
    if (active.stopped) return;
    active.stopped = true;
    if (zoomStreaming.current === active) zoomStreaming.current = null;
    if (active.animationFrame !== null) cancelAnimationFrame(active.animationFrame);
    active.animationFrame = null;
    active.port.onmessage = null;
    active.port.close();
    active.audioNode?.port.close();
    active.audioNode?.disconnect();
    active.audioSource?.disconnect();
    active.audioTrack.stop();
    if (stopMainSession) void api.stopZoomStreaming(active.id).catch(() => undefined);
    if (mountedRef.current) refreshStreamingStartedAt();
  };

  const failZoomStreaming = (active: ActiveZoomStreaming, message: string) => {
    if (active.stopped) return;
    const failed = { state: 'error' as const, outputId: 'zoom', message };
    outputStatusRef.current.zoom = failed;
    setOutputStatuses((previous) => ({ ...previous, zoom: failed }));
    setActionError(message);
    disposeZoomStreaming(active, true);
  };

  const scheduleZoomVideoFrame = (active: ActiveZoomStreaming) => {
    if (!active.started || active.stopped || active.framePending || active.animationFrame !== null) return;
    active.animationFrame = requestAnimationFrame(() => {
      active.animationFrame = null;
      void (async () => {
        const canvas = active.canvas;
        const Frame = (globalThis as typeof globalThis & { VideoFrame?: ZoomVideoFrameConstructor }).VideoFrame;
        if (!Frame) throw new Error('This version of Chromium does not provide WebCodecs video frames for Zoom streaming.');
        if (canvas.width !== active.settings.width || canvas.height !== active.settings.height) {
          throw new Error('The program canvas size must match the Zoom output size.');
        }
        const frame = new Frame(canvas, { timestamp: Math.round(performance.now() * 1000) });
        try {
          const packed = new Uint8Array(frame.allocationSize({ format: 'I420' }));
          const layout = await frame.copyTo(packed, { format: 'I420' });
          const width = active.settings.width;
          const height = active.settings.height;
          const compact = new Uint8Array(width * height * 3 / 2);
          let targetOffset = 0;
          for (let plane = 0; plane < 3; plane += 1) {
            const planeWidth = plane === 0 ? width : width / 2;
            const planeHeight = plane === 0 ? height : height / 2;
            const { offset, stride } = layout[plane]!;
            for (let row = 0; row < planeHeight; row += 1) {
              compact.set(packed.subarray(offset + row * stride, offset + row * stride + planeWidth), targetOffset);
              targetOffset += planeWidth;
            }
          }
          if (active.stopped) return;
          active.framePending = true;
          active.port.postMessage({ type: 'video', data: compact.buffer, width, height }, [compact.buffer]);
        } finally { frame.close(); }
      })().catch((error) => failZoomStreaming(active, `Zoom video output failed: ${friendlyError(error)}`));
    });
  };

  const startZoomMedia = async (active: ActiveZoomStreaming) => {
    if (active.started || active.stopped) return;
    try {
      await active.mixer.context.audioWorklet.addModule(zoomAudioProcessorUrl);
      if (active.stopped || zoomStreaming.current !== active) return;
      const audioStream = new MediaStream([active.audioTrack]);
      const source = active.mixer.context.createMediaStreamSource(audioStream);
      const audioNode = new AudioWorkletNode(active.mixer.context, 'lumastream-zoom-pcm16', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      active.audioSource = source;
      active.audioNode = audioNode;
      audioNode.port.onmessage = (event: MessageEvent) => {
        if (active.stopped || !event.data || event.data.type !== 'audio' || !(event.data.data instanceof ArrayBuffer)) return;
        active.port.postMessage(event.data, [event.data.data]);
      };
      active.port.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== 'ack') return;
        if (event.data.media === 'video') {
          active.framePending = false;
          scheduleZoomVideoFrame(active);
        } else if (event.data.media === 'audio') {
          audioNode.port.postMessage({ type: 'ack' });
        }
      };
      active.port.start();
      source.connect(audioNode);
      active.started = true;
      active.startedAt = Date.now();
      refreshStreamingStartedAt();
      scheduleZoomVideoFrame(active);
    } catch (error) {
      failZoomStreaming(active, `Zoom media could not start: ${friendlyError(error)}`);
    }
  };
  startZoomMediaRef.current = (active) => { void startZoomMedia(active); };

  useEffect(() => {
    let active = true;
    void api.loadStreamServiceSettings().then((settings) => {
      if (active) setStreamServiceSettings(settings);
    }).catch((error) => {
      if (active) setActionError(`Stream service settings could not be loaded: ${friendlyError(error)}`);
    }).finally(() => {
      if (active) streamServiceSettingsLoadedRef.current = true;
    });
    return () => { active = false; };
  }, [api, setActionError]);

  useEffect(() => {
    if (!streamServiceSettingsLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void api.saveStreamServiceSettings(streamServiceSettings).catch((error) => setActionError(`Stream service settings could not be saved: ${friendlyError(error)}`));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [api, streamServiceSettings, setActionError]);

  useEffect(() => api.onStreamStatus((status) => {
    const outputId = status.outputId ?? 'primary';
    const previousState = outputStatusRef.current[outputId]?.state ?? 'stopped';
    outputStatusRef.current[outputId] = status;
    setOutputStatuses((previous) => ({ ...previous, [outputId]: status }));
    if (status.state === 'live') {
      // Count reconnects independently so one destination cannot affect another.
      if (previousState === 'connecting' && outputsEverLive.current.has(outputId)) {
        setReconnectCounts((counts) => ({ ...counts, [outputId]: (counts[outputId] ?? 0) + 1 }));
      }
      outputsEverLive.current.add(outputId);
    } else if (status.state === 'stopped') {
      outputsEverLive.current.delete(outputId);
      setReconnectCounts((counts) => {
        if (!(outputId in counts)) return counts;
        const next = { ...counts };
        delete next[outputId];
        return next;
      });
    }
    if (status.state === 'error') {
      if (status.message) setActionError(status.message);
      if (outputId === 'zoom' && zoomStreaming.current) disposeZoomStreaming(zoomStreaming.current, false);
      else {
        const active = streaming.current.get(outputId);
        if (active?.recorder.state === 'recording') active.recorder.stop();
      }
    } else if (status.state === 'live' && outputId === 'zoom') {
      const active = zoomStreaming.current;
      if (active) startZoomMediaRef.current(active);
    } else if (status.state === 'stopped' && outputId === 'zoom' && zoomStreaming.current) {
      disposeZoomStreaming(zoomStreaming.current, false);
    }
  }), [api, setActionError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const outputId of startingOutputs.current) cancelledStartingOutputs.current.add(outputId);
      for (const active of streaming.current.values()) {
        if (active.recorder.state === 'recording') active.recorder.stop();
        else void api.stopStreaming(active.id).catch(() => undefined);
      }
      if (zoomStreaming.current) disposeZoomStreaming(zoomStreaming.current, true);
    };
  }, [api]);

  const startPreparedStreaming = async (startOutput: () => Promise<string>, outputId: string, settings?: StreamOutputSettings) => {
    if (!project || streaming.current.has(outputId) || startingOutputs.current.has(outputId)) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    startingOutputs.current.add(outputId);
    cancelledStartingOutputs.current.delete(outputId);
    outputsEverLive.current.delete(outputId);
    setReconnectCounts((counts) => {
      if (!(outputId in counts)) return counts;
      const next = { ...counts };
      delete next[outputId];
      return next;
    });
    setActionError('');
    const connecting = { state: 'connecting' as const, outputId };
    outputStatusRef.current[outputId] = connecting;
    setOutputStatuses((previous) => ({ ...previous, [outputId]: connecting }));
    let streamId: string | null = null;
    let captureStream: MediaStream | null = null;
    try {
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      if (cancelledStartingOutputs.current.has(outputId)) return;
      const videoStream = canvas.captureStream(project.output.frameRate);
      captureStream = new MediaStream([...videoStream.getVideoTracks(), ...audioMixer.destinationFor(project.output.streamAudioTrack).stream.getAudioTracks().map((track) => track.clone())]);
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error('This system does not provide a supported WebM streaming encoder.');
      const streamSettings = settings ?? buildStreamOutputSettings(project.output);
      if (cancelledStartingOutputs.current.has(outputId)) {
        captureStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamId = await startOutput();
      const latestOutputStatus = outputStatusRef.current[outputId];
      if (cancelledStartingOutputs.current.has(outputId) || latestOutputStatus?.state === 'error' || latestOutputStatus?.state === 'stopped') {
        await api.stopStreaming(streamId).catch(() => undefined);
        streamId = null;
        captureStream.getTracks().forEach((track) => track.stop());
        if (cancelledStartingOutputs.current.has(outputId) && mountedRef.current) {
          const stopped = { state: 'stopped' as const, outputId };
          outputStatusRef.current[outputId] = stopped;
          setOutputStatuses((previous) => ({ ...previous, [outputId]: stopped }));
        }
        return;
      }
      const recorder = new MediaRecorder(captureStream, { mimeType, videoBitsPerSecond: streamSettings.videoBitrateKbps * 1000, audioBitsPerSecond: streamSettings.audioBitrateKbps * 1000 });
      const active: ActiveStreaming = { id: streamId, outputId, recorder, captureStream, startedAt: Date.now(), writeQueue: Promise.resolve(), failure: null };
      streaming.current.set(outputId, active);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0) return;
        active.writeQueue = active.writeQueue.then(async () => {
          await api.writeStreamingChunk(active.id, await event.data.arrayBuffer());
        }).catch((error) => {
          active.failure = error;
          setActionError(`Stream output failed: ${friendlyError(error)}`);
          if (recorder.state === 'recording') recorder.stop();
        });
      });
      recorder.addEventListener('stop', () => {
        void (async () => {
          try {
            await active.writeQueue;
            await api.stopStreaming(active.id);
          } catch (error) {
            setActionError(`Stream could not stop cleanly: ${friendlyError(active.failure ?? error)}`);
          } finally {
            active.captureStream.getTracks().forEach((track) => track.stop());
            if (streaming.current.get(outputId) === active) streaming.current.delete(outputId);
            refreshStreamingStartedAt();
          }
        })();
      }, { once: true });
      recorder.start(1000);
      setStreamingStartedAt((current) => current === null ? active.startedAt : Math.min(current, active.startedAt));
      setStreamDialogOpen(false);
    } catch (error) {
      captureStream?.getTracks().forEach((track) => track.stop());
      if (streamId) await api.stopStreaming(streamId).catch(() => undefined);
      if (cancelledStartingOutputs.current.has(outputId)) {
        if (mountedRef.current) {
          const stopped = { state: 'stopped' as const, outputId };
          outputStatusRef.current[outputId] = stopped;
          setOutputStatuses((previous) => ({ ...previous, [outputId]: stopped }));
        }
        return;
      }
      const failed = { state: 'error' as const, outputId, message: friendlyError(error) };
      outputStatusRef.current[outputId] = failed;
      if (mountedRef.current) {
        setOutputStatuses((previous) => ({ ...previous, [outputId]: failed }));
        setActionError(`Could not start streaming: ${friendlyError(error)}`);
      }
    } finally {
      startingOutputs.current.delete(outputId);
      cancelledStartingOutputs.current.delete(outputId);
    }
  };

  const startStreaming = (destination: string, settings: StreamOutputSettings, outputId = 'primary') =>
    startPreparedStreaming(() => api.startStreaming(destination, settings, outputId), outputId, settings);

  const startZoomStreaming = async (meetingId: string, settings: StreamOutputSettings) => {
    const outputId = 'zoom';
    if (!project || zoomStreaming.current || startingOutputs.current.has(outputId)) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    startingOutputs.current.add(outputId);
    cancelledStartingOutputs.current.delete(outputId);
    outputsEverLive.current.delete(outputId);
    setReconnectCounts((counts) => {
      if (!(outputId in counts)) return counts;
      const next = { ...counts };
      delete next[outputId];
      return next;
    });
    setActionError('');
    const connecting = { state: 'connecting' as const, outputId, message: 'Connecting to Zoom Meeting SDK.' };
    outputStatusRef.current[outputId] = connecting;
    setOutputStatuses((previous) => ({ ...previous, [outputId]: connecting }));
    let audioTrack: MediaStreamTrack | null = null;
    let mediaPort: MessagePort | null = null;
    let id: string | null = null;
    try {
      const mixer = ensureMixer();
      await mixer.resume();
      if (cancelledStartingOutputs.current.has(outputId)) return;
      const sourceTrack = mixer.destinationFor(project.output.streamAudioTrack).stream.getAudioTracks()[0];
      if (!sourceTrack) throw new Error('The selected Zoom audio track is not available.');
      audioTrack = sourceTrack.clone();
      id = await api.startZoomStreaming(meetingId, settings);
      const latestStatus = outputStatusRef.current[outputId];
      if (cancelledStartingOutputs.current.has(outputId) || latestStatus?.state === 'error' || latestStatus?.state === 'stopped') {
        discardZoomMediaPort(id);
        await api.stopZoomStreaming(id).catch(() => undefined);
        audioTrack.stop();
        audioTrack = null;
        if (cancelledStartingOutputs.current.has(outputId) && mountedRef.current) {
          const stopped = { state: 'stopped' as const, outputId };
          outputStatusRef.current[outputId] = stopped;
          setOutputStatuses((previous) => ({ ...previous, [outputId]: stopped }));
        }
        return;
      }
      mediaPort = await waitForZoomMediaPort(id);
      if (cancelledStartingOutputs.current.has(outputId)) {
        mediaPort.close();
        mediaPort = null;
        await api.stopZoomStreaming(id).catch(() => undefined);
        audioTrack.stop();
        audioTrack = null;
        if (mountedRef.current) {
          const stopped = { state: 'stopped' as const, outputId };
          outputStatusRef.current[outputId] = stopped;
          setOutputStatuses((previous) => ({ ...previous, [outputId]: stopped }));
        }
        return;
      }
      const active: ActiveZoomStreaming = {
        id,
        port: mediaPort,
        canvas,
        audioTrack,
        mixer,
        settings: { ...settings },
        startedAt: Date.now(),
        started: false,
        stopped: false,
        framePending: false,
        animationFrame: null,
        audioSource: null,
        audioNode: null,
      };
      zoomStreaming.current = active;
      mediaPort = null;
      audioTrack = null;
      const currentStatus = outputStatusRef.current[outputId];
      if (currentStatus?.state === 'live') startZoomMediaRef.current(active);
      setStreamDialogOpen(false);
    } catch (error) {
      if (id) discardZoomMediaPort(id);
      mediaPort?.close();
      audioTrack?.stop();
      if (id) await api.stopZoomStreaming(id).catch(() => undefined);
      if (cancelledStartingOutputs.current.has(outputId)) {
        if (mountedRef.current) {
          const stopped = { state: 'stopped' as const, outputId };
          outputStatusRef.current[outputId] = stopped;
          setOutputStatuses((previous) => ({ ...previous, [outputId]: stopped }));
        }
        return;
      }
      const failed = { state: 'error' as const, outputId, message: friendlyError(error) };
      outputStatusRef.current[outputId] = failed;
      if (mountedRef.current) {
        setOutputStatuses((previous) => ({ ...previous, [outputId]: failed }));
        setActionError(`Could not start Zoom output: ${friendlyError(error)}`);
      }
    } finally {
      startingOutputs.current.delete(outputId);
      cancelledStartingOutputs.current.delete(outputId);
    }
  };

  const stopStreaming = (outputId?: string) => {
    const starting = outputId ? [outputId] : [...startingOutputs.current];
    for (const id of starting) {
      if (!startingOutputs.current.has(id)) continue;
      cancelledStartingOutputs.current.add(id);
      const stopped = { state: 'stopped' as const, outputId: id };
      outputStatusRef.current[id] = stopped;
      setOutputStatuses((previous) => ({ ...previous, [id]: stopped }));
    }
    const activeOutputs = outputId
      ? [streaming.current.get(outputId)].filter((active): active is ActiveStreaming => active !== undefined)
      : [...streaming.current.values()];
    for (const active of activeOutputs) {
      if (active.recorder.state === 'recording') active.recorder.stop();
    }
    if ((!outputId || outputId === 'zoom') && zoomStreaming.current) {
      disposeZoomStreaming(zoomStreaming.current, true);
      const stopped = { state: 'stopped' as const, outputId: 'zoom' };
      outputStatusRef.current.zoom = stopped;
      setOutputStatuses((previous) => ({ ...previous, zoom: stopped }));
    }
  };

  const goLiveForService = (service: StreamServiceId | 'zoom') => {
    if (!project) return;
    if (service === 'zoom') {
      if (!streamServiceSettings.zoom.selectedMeetingId) {
        setActionError('Select a Zoom meeting before starting the Zoom output.');
        return;
      }
      void startZoomStreaming(streamServiceSettings.zoom.selectedMeetingId, buildStreamOutputSettings(project.output));
      return;
    }
    const settings = { ...streamServiceSettings, service };
    const outputSettings = buildStreamOutputSettings(project.output);
    if (service === 'youtube' && settings.youtube.broadcastId) {
      void startPreparedStreaming(() => api.startYouTubeStreaming(settings.youtube.broadcastId, outputSettings), 'youtube', outputSettings);
      return;
    }
    const destination = resolveStreamDestination(settings);
    if (!destination) {
      setActionError(validateStreamServiceSettings(settings) ?? 'Enter a valid stream destination.');
      return;
    }
    void startStreaming(destination, outputSettings, service);
  };

  const goLive = () => goLiveForService(streamServiceSettings.service);

  const openStreamDialog = () => setStreamDialogOpen(true);
  const streamServiceLabel = getStreamService(streamServiceSettings.service).label;
  const streamStatus = aggregateOutputStatuses(outputStatuses);
  const reconnectCount = Object.values(reconnectCounts).reduce((total, count) => total + count, 0);

  return {
    streamingStartedAt, streamStatus, outputStatuses, activeOutputIds: [...new Set([...streaming.current.keys(), ...(zoomStreaming.current ? ['zoom'] : []), ...startingOutputs.current])],
    outputStartedAt: Object.fromEntries([
      ...[...streaming.current.values()].map((active) => [active.outputId, active.startedAt]),
      ...(zoomStreaming.current?.started ? [['zoom', zoomStreaming.current.startedAt]] : []),
    ]), reconnectCount,
    streamDialogOpen, setStreamDialogOpen, openStreamDialog,
    streamServiceSettings, setStreamServiceSettings, streamServiceLabel,
    startStreaming, startPreparedStreaming, stopStreaming, goLive, goLiveForService,
    isActive: () => streaming.current.size > 0 || zoomStreaming.current !== null || startingOutputs.current.size > 0,
  };
}
