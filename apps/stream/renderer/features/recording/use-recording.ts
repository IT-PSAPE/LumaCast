import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { pauseRecordingChannels, resumeRecordingChannels, stopRecordingChannels } from '../../recording-controls';
import { validateRecordingFilenameFormat } from '../../../shared/recording-filename';
import type { AudioMixerEngine } from '../../audio-mixer';
import type { RecordingTrackId, StreamAPI, StreamProject, StreamRecordingPreferences } from '../../../shared/desktop-api';
import { createDefaultStreamRecordingPreferences } from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

interface ActiveRecording {
  id: string;
  channels: Array<{ track: RecordingTrackId; recorder: MediaRecorder; captureStream: MediaStream }>;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  writeQueue: Promise<void>;
  failure: unknown;
  stoppedChannels: number;
}

export interface UseRecordingParams {
  api: StreamAPI;
  project: StreamProject | null;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  ensureMixer: () => AudioMixerEngine;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
}

export interface UseRecordingResult {
  recordingStartedAt: number | null;
  recordingPausedAt: number | null;
  recordingAccumulatedPauseMs: number;
  recordingFinalizing: boolean;
  recordingPreferences: StreamRecordingPreferences;
  setRecordingPreferences: Dispatch<SetStateAction<StreamRecordingPreferences>>;
  recordingPreferencesError: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  showRecordingsFolder: () => void;
  remuxRecording: () => Promise<void>;
  chooseRecordingDirectory: () => Promise<void>;
  useDefaultRecordingDirectory: () => Promise<void>;
  handleRecordingFilenameBlur: (filenameFormat: string) => void;
  /** Whether a recording is currently in progress — feeds `useWorkspace`'s collection/profile-switch gate. */
  isActive: () => boolean;
  /** Whether a recording is actively writing right now (false while paused, unlike `isActive`) — feeds the Ctrl+Shift+R hotkey. */
  isActivelyRecording: () => boolean;
}

/** Program-output recording: start/pause/resume/stop, the recordings folder/remux actions, and recording preferences. Mirrors the former inline App.tsx implementation exactly. */
export function useRecording(params: UseRecordingParams): UseRecordingResult {
  const { api, project, programCanvasRef, ensureMixer, setActionError, working, setWorking } = params;

  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingPausedAt, setRecordingPausedAt] = useState<number | null>(null);
  const [recordingAccumulatedPauseMs, setRecordingAccumulatedPauseMs] = useState(0);
  const [recordingFinalizing, setRecordingFinalizing] = useState(false);
  const [recordingPreferences, setRecordingPreferences] = useState<StreamRecordingPreferences>(createDefaultStreamRecordingPreferences);
  const [recordingPreferencesError, setRecordingPreferencesError] = useState('');

  const recording = useRef<ActiveRecording | null>(null);
  const recordingPreferencesRef = useRef(recordingPreferences);
  recordingPreferencesRef.current = recordingPreferences;

  useEffect(() => {
    let active = true;
    void api.loadRecordingPreferences().then((preferences) => {
      if (!active) return;
      recordingPreferencesRef.current = preferences;
      setRecordingPreferences(preferences);
    }).catch((error) => {
      if (active) setRecordingPreferencesError(`Recording preferences could not be loaded: ${friendlyError(error)}`);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => () => {
    if (recording.current) stopRecordingChannels(recording.current.channels);
  }, []);

  const persistRecordingFilenameFormat = async (filenameFormat: string) => {
    setRecordingPreferencesError('');
    try {
      const next = await api.saveRecordingFilenameFormat(filenameFormat);
      recordingPreferencesRef.current = next;
      setRecordingPreferences(next);
    } catch (error) {
      setRecordingPreferences(recordingPreferencesRef.current);
      setRecordingPreferencesError(`Recording preferences could not be saved: ${friendlyError(error)}`);
    }
  };

  const handleRecordingFilenameBlur = (filenameFormat: string) => {
    if (!validateRecordingFilenameFormat(filenameFormat)) {
      setRecordingPreferences(recordingPreferencesRef.current);
      setRecordingPreferencesError('Use a valid filename format.');
      return;
    }
    void persistRecordingFilenameFormat(filenameFormat);
  };

  const chooseRecordingDirectory = async () => {
    setRecordingPreferencesError('');
    try {
      const next = await api.chooseRecordingDirectory();
      if (!next) return;
      recordingPreferencesRef.current = next;
      setRecordingPreferences(next);
    } catch (error) {
      setRecordingPreferencesError(`Recording folder could not be selected: ${friendlyError(error)}`);
    }
  };

  const useDefaultRecordingDirectory = async () => {
    setRecordingPreferencesError('');
    try {
      const next = await api.useDefaultRecordingDirectory();
      recordingPreferencesRef.current = next;
      setRecordingPreferences(next);
    } catch (error) {
      setRecordingPreferencesError(`Recording preferences could not be saved: ${friendlyError(error)}`);
    }
  };

  const startRecording = async () => {
    if (!project || recording.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    let file: { id: string; name: string } | null = null;
    const captureStreams: MediaStream[] = [];
    let activeSession: ActiveRecording | null = null;
    let startedChannels = 0;
    try {
      file = await api.openRecording({
        container: project.output.recordingContainer,
        frameRate: project.output.frameRate,
        videoBitrateKbps: project.output.recordingVideoBitrateKbps,
        audioBitrateKbps: project.output.recordingAudioBitrateKbps,
        audioTracks: project.output.recordingAudioTracks,
        rateControl: project.output.recordingRateControl,
        encoder: project.output.recordingVideoEncoder,
        encoderQuality: project.output.recordingEncoderQuality,
        hardwareEncoding: project.output.recordingHardwareEncoding,
        keyframeIntervalSeconds: project.output.recordingKeyframeIntervalSeconds,
      });
      if (!file) return;
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoMimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!videoMimeType) throw new Error('This system does not provide a supported WebM video encoder.');
      const audioMimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (project.output.recordingAudioTracks.length > 0 && !audioMimeType) throw new Error('This system does not provide a supported WebM audio encoder.');
      const videoCapture = canvas.captureStream(project.output.frameRate);
      captureStreams.push(videoCapture);
      const channels: ActiveRecording['channels'] = [{
        track: 0,
        recorder: new MediaRecorder(new MediaStream(videoCapture.getVideoTracks()), { mimeType: videoMimeType, videoBitsPerSecond: project.output.recordingVideoBitrateKbps * 1000 }),
        captureStream: videoCapture,
      }];
      for (const track of project.output.recordingAudioTracks) {
        const capture = new MediaStream(audioMixer.destinationFor(track).stream.getAudioTracks().map((audioTrack) => audioTrack.clone()));
        captureStreams.push(capture);
        channels.push({
          track,
          recorder: new MediaRecorder(capture, { mimeType: audioMimeType!, audioBitsPerSecond: project.output.recordingAudioBitrateKbps * 1000 }),
          captureStream: capture,
        });
      }
      const active: ActiveRecording = { id: file.id, channels, startedAt: Date.now(), pausedAt: null, accumulatedPauseMs: 0, writeQueue: Promise.resolve(), failure: null, stoppedChannels: 0 };
      activeSession = active;
      recording.current = active;
      const stopAll = () => stopRecordingChannels(channels);
      const finish = () => {
        active.stoppedChannels += 1;
        if (active.stoppedChannels !== channels.length) return;
        setRecordingFinalizing(true);
        void (async () => {
          try {
            await active.writeQueue;
            if (active.failure) throw active.failure;
            const name = await api.closeRecording(active.id);
            setActionError(`Saved ${name}`);
          } catch (error) {
            try {
              const name = await api.closeRecording(active.id);
              setActionError(`Saved partial recording ${name}. ${friendlyError(active.failure ?? error)}`);
            } catch (closeError) {
              setActionError(`Recording could not be completed: ${friendlyError(active.failure ?? closeError)}`);
            }
          } finally {
            active.channels.forEach((channel) => channel.captureStream.getTracks().forEach((track) => track.stop()));
            if (recording.current === active) recording.current = null;
            setRecordingStartedAt(null);
            setRecordingPausedAt(null);
            setRecordingAccumulatedPauseMs(0);
            setRecordingFinalizing(false);
          }
        })();
      };
      for (const channel of channels) {
        channel.recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size === 0) return;
          active.writeQueue = active.writeQueue.then(async () => {
            await api.writeRecordingChunk(active.id, channel.track, await event.data.arrayBuffer());
          }).catch((error) => {
            active.failure = error;
            setActionError(`Recording write failed: ${friendlyError(error)}`);
            stopAll();
          });
        });
        channel.recorder.addEventListener('error', () => {
          active.failure ??= new Error('A recording media encoder failed.');
          stopAll();
        });
        channel.recorder.addEventListener('stop', finish, { once: true });
      }
      for (const { recorder } of channels) {
        recorder.start(1000);
        startedChannels += 1;
      }
      setRecordingStartedAt(active.startedAt);
      setRecordingPausedAt(null);
      setRecordingAccumulatedPauseMs(0);
    } catch (error) {
      if (activeSession && startedChannels > 0) {
        activeSession.failure = error;
        activeSession.stoppedChannels += activeSession.channels.length - startedChannels;
        activeSession.channels.slice(0, startedChannels).forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
        setRecordingStartedAt(activeSession.startedAt);
        setRecordingPausedAt(null);
        setRecordingAccumulatedPauseMs(0);
        setActionError(`Could not start every recording track: ${friendlyError(error)}`);
        return;
      }
      if (activeSession && recording.current === activeSession) recording.current = null;
      captureStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      if (file) await api.abortRecording(file.id).catch(() => undefined);
      setActionError(`Could not start recording: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopRecording = () => {
    const active = recording.current;
    if (active) stopRecordingChannels(active.channels);
  };

  const showRecordingsFolder = () => {
    void api.showRecordingsFolder().catch((error) => setActionError(`Recordings folder could not be opened: ${friendlyError(error)}`));
  };

  const remuxRecording = async () => {
    if (working) return;
    setActionError('');
    setWorking(true);
    try {
      const name = await api.remuxRecording();
      if (name) setActionError(`Saved remuxed recording: ${name}`);
    } catch (error) {
      setActionError(`Recording could not be remuxed: ${friendlyError(error)}`);
    } finally {
      setWorking(false);
    }
  };

  const pauseRecording = () => {
    const active = recording.current;
    if (!active) return;
    if (!pauseRecordingChannels(active.channels)) {
      setActionError('Recording tracks could not be paused together.');
      return;
    }
    active.pausedAt = Date.now();
    setRecordingPausedAt(active.pausedAt);
  };

  const resumeRecording = () => {
    const active = recording.current;
    if (!active || active.pausedAt === null) return;
    if (!resumeRecordingChannels(active.channels)) {
      setActionError('Recording tracks could not be resumed together.');
      return;
    }
    active.accumulatedPauseMs += Math.max(0, Date.now() - active.pausedAt);
    active.pausedAt = null;
    setRecordingAccumulatedPauseMs(active.accumulatedPauseMs);
    setRecordingPausedAt(null);
  };

  return {
    recordingStartedAt, recordingPausedAt, recordingAccumulatedPauseMs, recordingFinalizing,
    recordingPreferences, setRecordingPreferences, recordingPreferencesError,
    startRecording, stopRecording, pauseRecording, resumeRecording,
    showRecordingsFolder, remuxRecording, chooseRecordingDirectory, useDefaultRecordingDirectory,
    handleRecordingFilenameBlur,
    isActive: () => recording.current !== null,
    isActivelyRecording: () => recording.current?.channels.some(({ recorder }) => recorder.state === 'recording') ?? false,
  };
}
