import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { AudioMixerEngine } from '../../audio-mixer';
import type { AudioTrack, RecordingTrackId, StreamAPI, StreamProject } from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

interface ReplayChunk {
  at: number;
  blob: Blob;
}

interface ReplayChannel {
  track: RecordingTrackId;
  recorder: MediaRecorder;
  captureStream: MediaStream;
  header: Blob | null;
  chunks: ReplayChunk[];
}

interface ActiveReplayBuffer {
  channels: ReplayChannel[];
  startedAt: number;
  stoppedChannels: number;
}

export interface UseReplayBufferParams {
  api: StreamAPI;
  project: StreamProject | null;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  ensureMixer: () => AudioMixerEngine;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
}

export interface UseReplayBufferResult {
  replayBufferStartedAt: number | null;
  replayBufferDurationSeconds: number;
  setReplayBufferDurationSeconds: Dispatch<SetStateAction<number>>;
  canSaveReplay: boolean;
  startReplayBuffer: () => Promise<void>;
  stopReplayBuffer: () => void;
  saveReplay: () => Promise<void>;
  /** Whether the replay buffer is currently running — feeds `useWorkspace`'s collection/profile-switch gate. */
  isActive: () => boolean;
}

/** The rolling replay buffer: start/stop, the `canSaveReplay` gate, and saving the trailing window to a recording. Mirrors the former inline App.tsx implementation exactly. */
export function useReplayBuffer(params: UseReplayBufferParams): UseReplayBufferResult {
  const { api, project, programCanvasRef, ensureMixer, setActionError, working, setWorking } = params;

  const [replayBufferStartedAt, setReplayBufferStartedAt] = useState<number | null>(null);
  const [replayBufferDurationSeconds, setReplayBufferDurationSeconds] = useState(30);
  const [replayBufferRevision, setReplayBufferRevision] = useState(0);

  const replayBuffer = useRef<ActiveReplayBuffer | null>(null);

  useEffect(() => () => {
    replayBuffer.current?.channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
  }, []);

  const startReplayBuffer = async () => {
    if (!project || replayBuffer.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    const captureStreams: MediaStream[] = [];
    let activeSession: ActiveReplayBuffer | null = null;
    let startedChannels = 0;
    try {
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoStream = canvas.captureStream(project.output.frameRate);
      captureStreams.push(videoStream);
      const videoMimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!videoMimeType) throw new Error('This system does not provide a supported WebM replay video encoder.');
      const audioMimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (project.output.recordingAudioTracks.length > 0 && !audioMimeType) throw new Error('This system does not provide a supported WebM replay audio encoder.');
      const channels: ReplayChannel[] = [{
        track: 0,
        recorder: new MediaRecorder(new MediaStream(videoStream.getVideoTracks()), { mimeType: videoMimeType, videoBitsPerSecond: 8_000_000 }),
        captureStream: videoStream,
        header: null,
        chunks: [],
      }];
      for (const track of project.output.recordingAudioTracks) {
        const capture = new MediaStream(audioMixer.destinationFor(track).stream.getAudioTracks().map((audioTrack) => audioTrack.clone()));
        captureStreams.push(capture);
        channels.push({
          track,
          recorder: new MediaRecorder(capture, { mimeType: audioMimeType!, audioBitsPerSecond: project.output.recordingAudioBitrateKbps * 1000 }),
          captureStream: capture,
          header: null,
          chunks: [],
        });
      }
      const active: ActiveReplayBuffer = { channels, startedAt: Date.now(), stoppedChannels: 0 };
      activeSession = active;
      replayBuffer.current = active;
      const stopAll = () => channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
      for (const channel of channels) {
        channel.recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size === 0) return;
          channel.header ??= event.data;
          channel.chunks.push({ at: Date.now(), blob: event.data });
          const cutoff = Date.now() - replayBufferDurationSeconds * 1000;
          while (channel.chunks.length > 1 && channel.chunks[1]!.at < cutoff) channel.chunks.splice(1, 1);
          setReplayBufferRevision((value) => value + 1);
        });
        channel.recorder.addEventListener('error', () => {
          setActionError('Replay buffer stopped because a media encoder failed.');
          stopAll();
        });
        channel.recorder.addEventListener('stop', () => {
          active.stoppedChannels += 1;
          if (active.stoppedChannels !== channels.length) return;
          active.channels.forEach((item) => item.captureStream.getTracks().forEach((track) => track.stop()));
          if (replayBuffer.current === active) replayBuffer.current = null;
          setReplayBufferStartedAt(null);
          setReplayBufferRevision((value) => value + 1);
        }, { once: true });
      }
      for (const { recorder } of channels) {
        recorder.start(1000);
        startedChannels += 1;
      }
      setReplayBufferStartedAt(active.startedAt);
    } catch (error) {
      if (activeSession && startedChannels > 0) {
        activeSession.stoppedChannels += activeSession.channels.length - startedChannels;
        activeSession.channels.slice(0, startedChannels).forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
        setReplayBufferStartedAt(activeSession.startedAt);
        setActionError(`Could not start every replay track: ${friendlyError(error)}`);
        return;
      }
      if (activeSession && replayBuffer.current === activeSession) replayBuffer.current = null;
      captureStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      setActionError(`Could not start replay buffer: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopReplayBuffer = () => {
    const active = replayBuffer.current;
    active?.channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
  };

  const saveReplay = async () => {
    const active = replayBuffer.current;
    const videoChannel = active?.channels.find((channel) => channel.track === 0);
    if (!project || !active || !videoChannel?.header || videoChannel.chunks.length === 0 || working) return;
    setWorking(true);
    setActionError('');
    let file: { id: string; name: string } | null = null;
    try {
      const channelsToSave = active.channels.filter((channel) => channel.track === 0 || (channel.header !== null && channel.chunks.length > 0));
      file = await api.openRecording({
        container: project.output.recordingContainer,
        frameRate: project.output.frameRate,
        videoBitrateKbps: project.output.recordingVideoBitrateKbps,
        audioBitrateKbps: project.output.recordingAudioBitrateKbps,
        audioTracks: channelsToSave.filter((channel) => channel.track !== 0).map((channel) => channel.track as AudioTrack),
        rateControl: project.output.recordingRateControl,
        encoder: project.output.recordingVideoEncoder,
        encoderQuality: project.output.recordingEncoderQuality,
        hardwareEncoding: project.output.recordingHardwareEncoding,
        keyframeIntervalSeconds: project.output.recordingKeyframeIntervalSeconds,
      });
      if (!file) return;
      const cutoff = Date.now() - replayBufferDurationSeconds * 1000;
      for (const channel of channelsToSave) {
        const payloads = [channel.header!, ...channel.chunks.filter((chunk) => chunk.at >= cutoff && chunk.blob !== channel.header).map((chunk) => chunk.blob)];
        for (const payload of payloads) await api.writeRecordingChunk(file.id, channel.track, await payload.arrayBuffer());
      }
      const name = await api.closeRecording(file.id);
      file = null;
      setActionError(`Saved replay ${name}`);
    } catch (error) {
      if (file) await api.closeRecording(file.id).catch(() => undefined);
      setActionError(`Replay could not be saved: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const canSaveReplay = replayBufferRevision > 0 && Boolean(replayBuffer.current?.channels.some((channel) => channel.track === 0 && channel.header));

  return {
    replayBufferStartedAt, replayBufferDurationSeconds, setReplayBufferDurationSeconds, canSaveReplay,
    startReplayBuffer, stopReplayBuffer, saveReplay,
    isActive: () => replayBuffer.current !== null,
  };
}
