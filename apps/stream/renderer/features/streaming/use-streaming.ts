import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { getStreamService, resolveStreamDestination, validateStreamServiceSettings } from '../../../shared/stream-services';
import type { AudioMixerEngine } from '../../audio-mixer';
import {
  createDefaultStreamServiceSettings,
  type StreamAPI, type StreamOutputSettings, type StreamProject, type StreamRuntimeStatus, type StreamServiceSettings,
} from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

interface ActiveStreaming {
  id: string;
  recorder: MediaRecorder;
  captureStream: MediaStream;
  startedAt: number;
  writeQueue: Promise<void>;
  failure: unknown;
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

export interface UseStreamingParams {
  api: StreamAPI;
  project: StreamProject | null;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  ensureMixer: () => AudioMixerEngine;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
}

export interface UseStreamingResult {
  streamingStartedAt: number | null;
  streamStatus: StreamRuntimeStatus;
  reconnectCount: number;
  streamDialogOpen: boolean;
  setStreamDialogOpen: Dispatch<SetStateAction<boolean>>;
  openStreamDialog: () => void;
  streamServiceSettings: StreamServiceSettings;
  setStreamServiceSettings: Dispatch<SetStateAction<StreamServiceSettings>>;
  streamServiceLabel: string;
  startStreaming: (destination: string, settings: StreamOutputSettings) => Promise<void>;
  stopStreaming: () => void;
  goLive: () => void;
  /** Whether a stream is currently connecting or live — feeds `useWorkspace`'s collection/profile-switch gate. */
  isActive: () => boolean;
}

/** Live streaming: destination/key settings (loaded from and saved to the stream-settings store), start/stop, and connection status. Mirrors the former inline App.tsx implementation exactly. */
export function useStreaming(params: UseStreamingParams): UseStreamingResult {
  const { api, project, programCanvasRef, ensureMixer, setActionError, working, setWorking } = params;

  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamRuntimeStatus>({ state: 'stopped' });
  const [reconnectCount, setReconnectCount] = useState(0);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamServiceSettings, setStreamServiceSettings] = useState<StreamServiceSettings>(createDefaultStreamServiceSettings);

  const streaming = useRef<ActiveStreaming | null>(null);
  const streamStatusRef = useRef<StreamRuntimeStatus>({ state: 'stopped' });
  const streamStateRef = useRef<StreamRuntimeStatus['state']>('stopped');
  const hasBeenLiveRef = useRef(false);

  // Guards the debounced save effect below from firing before the load below
  // resolves: `streamServiceSettings` starts out holding client-side defaults,
  // and without this, the save effect's 600ms timer could write those defaults
  // over the real stored settings if it fires before the load settles.
  const streamServiceSettingsLoadedRef = useRef(false);

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
    streamStatusRef.current = status;
    const previousState = streamStateRef.current;
    if (status.state === 'live') {
      // A connecting→live transition after the stream has already been live
      // once is a reconnect, not the initial connect.
      if (previousState === 'connecting' && hasBeenLiveRef.current) setReconnectCount((count) => count + 1);
      hasBeenLiveRef.current = true;
    } else if (status.state === 'stopped') {
      hasBeenLiveRef.current = false;
      setReconnectCount(0);
    }
    streamStateRef.current = status.state;
    setStreamStatus(status);
    if (status.state === 'error') {
      if (status.message) setActionError(status.message);
      const active = streaming.current;
      if (active?.recorder.state === 'recording') active.recorder.stop();
    }
  }), [api, setActionError]);

  useEffect(() => () => {
    if (streaming.current?.recorder.state === 'recording') streaming.current.recorder.stop();
    else if (streaming.current) void api.stopStreaming(streaming.current.id).catch(() => undefined);
  }, [api]);

  const startStreaming = async (destination: string, settings: StreamOutputSettings) => {
    if (!project || streaming.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    setStreamStatus({ state: 'connecting' });
    streamStatusRef.current = { state: 'connecting' };
    let streamId: string | null = null;
    let captureStream: MediaStream | null = null;
    try {
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoStream = canvas.captureStream(project.output.frameRate);
      captureStream = new MediaStream([...videoStream.getVideoTracks(), ...audioMixer.destinationFor(project.output.streamAudioTrack).stream.getAudioTracks().map((track) => track.clone())]);
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error('This system does not provide a supported WebM streaming encoder.');
      streamId = await api.startStreaming(destination, settings);
      const recorder = new MediaRecorder(captureStream, { mimeType, videoBitsPerSecond: settings.videoBitrateKbps * 1000, audioBitsPerSecond: settings.audioBitrateKbps * 1000 });
      const active: ActiveStreaming = { id: streamId, recorder, captureStream, startedAt: Date.now(), writeQueue: Promise.resolve(), failure: null };
      streaming.current = active;
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
            if (streaming.current === active) streaming.current = null;
            setStreamingStartedAt(null);
          }
        })();
      }, { once: true });
      recorder.start(1000);
      setStreamingStartedAt(active.startedAt);
      setStreamDialogOpen(false);
      if (streamStatusRef.current.state === 'error') recorder.stop();
    } catch (error) {
      captureStream?.getTracks().forEach((track) => track.stop());
      if (streamId) await api.stopStreaming(streamId).catch(() => undefined);
      setStreamStatus({ state: 'error', message: friendlyError(error) });
      streamStatusRef.current = { state: 'error', message: friendlyError(error) };
      setActionError(`Could not start streaming: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopStreaming = () => {
    const active = streaming.current;
    if (active?.recorder.state === 'recording') active.recorder.stop();
  };

  const goLive = () => {
    if (!project) return;
    const destination = resolveStreamDestination(streamServiceSettings);
    if (!destination) {
      setActionError(validateStreamServiceSettings(streamServiceSettings) ?? 'Enter a valid stream destination.');
      return;
    }
    void startStreaming(destination, buildStreamOutputSettings(project.output));
  };

  const openStreamDialog = () => setStreamDialogOpen(true);
  const streamServiceLabel = getStreamService(streamServiceSettings.service).label;

  return {
    streamingStartedAt, streamStatus, reconnectCount,
    streamDialogOpen, setStreamDialogOpen, openStreamDialog,
    streamServiceSettings, setStreamServiceSettings, streamServiceLabel,
    startStreaming, stopStreaming, goLive,
    isActive: () => streaming.current !== null,
  };
}
