import { useEffect, useMemo, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Checkbox, EmptyState, Modal, SegmentedControl, Select, Switch } from '@lumacast/ui';
import type { AudioOutputDeviceOption } from '../audio-output-devices';
import { SCALED_OUTPUT_LIMITS } from '../output-scaling';
import { flattenSourceNodes } from '../../shared/source-tree';
import {
  AUDIO_TRACKS,
  getVideoEncoderRateControlModes,
  normalizeVideoRateControl,
  VIDEO_RATE_CONTROL_OPTIONS,
  type AudioTrack,
  type RecordingContainer,
  type StreamAudioSettings,
  type StreamGlobalHotkeys,
  type StreamHotkeyAction,
  type StreamOutputConfiguration,
  type StreamProject,
  type StreamRecordingPreferences,
  type StreamServiceSettings,
  type VideoEncoderFamily,
  type YouTubeBroadcastDraft,
  type YouTubePrivacy,
} from '../../shared/desktop-api';
import { hardwareEncodingLabelForPlatform, type StreamPlatform } from '../../shared/platform-capabilities';
import { getStreamService, STREAM_SERVICES, validateStreamServiceSettings, type StreamServiceId } from '../../shared/stream-services';
import {
  applySettingsDraft,
  cloneStreamServiceSettings,
  createSettingsDraft,
  hasSettingsDraftErrors,
  isSettingsDraftDirty,
  validateSettingsDraft,
  type SettingsDraft,
  type SettingsDraftErrors,
  type SettingsPage,
} from './settings-draft';
import './settings-dialog.css';

interface AudioSettingsBundle {
  monitorDeviceSelectionSupported: boolean;
  audioSettings: StreamAudioSettings;
  audioOutputDevices: AudioOutputDeviceOption[];
  audioSettingsError: string;
  onUpdateMonitoringDevice: (deviceId: string) => void;
}

interface RecordingPreferencesBundle {
  recordingPreferences: StreamRecordingPreferences;
  setRecordingPreferences: Dispatch<SetStateAction<StreamRecordingPreferences>>;
  recordingPreferencesError: string;
  onChooseDirectory: () => void;
  onUseDefaultDirectory: () => void;
  onFilenameBlur: (filenameFormat: string) => void;
}

interface HotkeysDraftBundle {
  hotkeyDraft: StreamGlobalHotkeys | null;
  sceneSwitchHotkeyDraft: Record<string, string>;
  sourceVisibilityHotkeyDraft: Record<string, string>;
  hotkeyError: string;
  hotkeysWorking: boolean;
  onCaptureHotkey: (action: StreamHotkeyAction, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onCaptureSceneSwitchHotkey: (sceneId: string, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onCaptureSourceVisibilityHotkey: (sourceId: string, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onApply: () => void;
}

export interface SettingsDialogProps {
  settingsOpenerRef: { current: HTMLElement | null };
  onClose: () => void;
  project: StreamProject;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  audio: AudioSettingsBundle;
  replayBufferDurationSeconds: number;
  setReplayBufferDurationSeconds: Dispatch<SetStateAction<number>>;
  replayBufferStartedAt: number | null;
  recording: RecordingPreferencesBundle;
  recordingStartedAt: number | null;
  recordingFinalizing: boolean;
  videoEncoderOptions: ReadonlyArray<{ value: VideoEncoderFamily; label: string }>;
  systemVideoEncoder: VideoEncoderFamily | null;
  hotkeys: HotkeysDraftBundle;
  /** Used for the hardware-encoding toggle label and encoder-availability checks. Defaults to 'win32' when omitted. */
  platform?: StreamPlatform;
  /** Stream destination + YouTube broadcast draft, shared with the YouTube dock. The Stream page shows a disabled empty state when this is omitted. */
  streamServiceSettings?: StreamServiceSettings;
  onSaveStreamServiceSettings?: (settings: StreamServiceSettings) => void;
  /** Page to open on first render; defaults to the last page visited this session. */
  initialPage?: SettingsPage;
  onRemuxRecording?: () => void;
}

const SETTINGS_PAGES: ReadonlyArray<{ id: SettingsPage; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'stream', label: 'Stream' },
  { id: 'output', label: 'Output' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'advanced', label: 'Advanced' },
];

// Persists only for the life of the renderer (module-local), matching "last
// page visited this session" rather than anything written to disk.
let lastSettingsPage: SettingsPage = 'general';

const REPLAY_BUFFER_OPTIONS = [5, 15, 30, 60];

const RECORDING_CONTAINER_OPTIONS: ReadonlyArray<{ value: RecordingContainer; label: string }> = [
  { value: 'mkv', label: 'Matroska (.mkv)' },
  { value: 'mp4', label: 'MPEG-4 (.mp4)' },
  { value: 'webm', label: 'WebM (.webm)' },
];

const FILENAME_TOKENS: ReadonlyArray<{ token: string; meaning: string }> = [
  { token: '%CCYY', meaning: 'Year' },
  { token: '%MM', meaning: 'Month' },
  { token: '%DD', meaning: 'Day' },
  { token: '%hh', meaning: 'Hour' },
  { token: '%mm', meaning: 'Minute' },
  { token: '%ss', meaning: 'Second' },
];

/** Sentinel so the Select never has to represent "system default" as an empty string. */
const DEFAULT_MONITORING_DEVICE = '__default__';

function FieldError({ message }: { message?: string }) {
  return message ? <p className="hotkey-error" role="alert">{message}</p> : null;
}

export function SettingsDialog({
  settingsOpenerRef,
  onClose,
  project,
  setProjectValue,
  audio,
  replayBufferDurationSeconds,
  setReplayBufferDurationSeconds,
  replayBufferStartedAt,
  recording,
  recordingStartedAt,
  recordingFinalizing,
  videoEncoderOptions,
  systemVideoEncoder,
  hotkeys,
  platform,
  streamServiceSettings,
  onSaveStreamServiceSettings,
  initialPage,
  onRemuxRecording,
}: SettingsDialogProps) {
  const platformValue = platform ?? 'win32';
  const [page, setPage] = useState<SettingsPage>(() => initialPage ?? lastSettingsPage);
  const [baseline, setBaseline] = useState<SettingsDraft>(() => createSettingsDraft(project.output, audio.audioSettings, recording.recordingPreferences, replayBufferDurationSeconds, streamServiceSettings));
  const [draft, setDraft] = useState<SettingsDraft>(() => createSettingsDraft(project.output, audio.audioSettings, recording.recordingPreferences, replayBufferDurationSeconds, streamServiceSettings));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);

  useEffect(() => {
    lastSettingsPage = page;
  }, [page]);

  // Restore focus to whatever opened the dialog on unmount: Modal mounts only
  // while open (no open->false transition for Base UI's own restoration to
  // catch), the same situation advanced-audio-dialog.tsx handles this way.
  useEffect(() => () => {
    const opener = settingsOpenerRef.current;
    if (opener?.isConnected) opener.focus();
  }, [settingsOpenerRef]);

  // The recording folder has no text field of its own (only the Browse/Default
  // actions below, which already persist on the main-process side the moment
  // they resolve), so its result is mirrored into the draft rather than
  // buffered like every other field.
  useEffect(() => {
    const directory = recording.recordingPreferences.directory;
    setDraft((current) => (current.recordingPreferences.directory === directory ? current : { ...current, recordingPreferences: { ...current.recordingPreferences, directory } }));
    setBaseline((current) => (current.recordingPreferences.directory === directory ? current : { ...current, recordingPreferences: { ...current.recordingPreferences, directory } }));
  }, [recording.recordingPreferences.directory]);

  // `streamServiceSettings` often finishes its async load slightly after the
  // dialog opens; adopt it once, as long as the user hasn't started editing it.
  useEffect(() => {
    if (!streamServiceSettings) return;
    setDraft((current) => (current.streamServiceSettings ? current : { ...current, streamServiceSettings: cloneStreamServiceSettings(streamServiceSettings) }));
    setBaseline((current) => (current.streamServiceSettings ? current : { ...current, streamServiceSettings: cloneStreamServiceSettings(streamServiceSettings) }));
  }, [streamServiceSettings]);

  const errors: SettingsDraftErrors = useMemo(() => validateSettingsDraft(draft, platformValue), [draft, platformValue]);
  const hasErrors = hasSettingsDraftErrors(errors);
  const dirty = useMemo(() => isSettingsDraftDirty(draft, baseline), [draft, baseline]);

  const updateOutput = (patch: Partial<StreamOutputConfiguration>) => {
    setDraft((current) => ({ ...current, output: { ...current.output, ...patch } }));
  };
  const updateAudioSettings = (patch: Partial<StreamAudioSettings>) => {
    setDraft((current) => ({ ...current, audioSettings: { ...current.audioSettings, ...patch } }));
  };
  const updateRecordingPreferences = (patch: Partial<StreamRecordingPreferences>) => {
    setDraft((current) => ({ ...current, recordingPreferences: { ...current.recordingPreferences, ...patch } }));
  };
  const updateStreamService = (patch: Partial<StreamServiceSettings>) => {
    setDraft((current) => (current.streamServiceSettings ? { ...current, streamServiceSettings: { ...current.streamServiceSettings, ...patch } } : current));
  };
  const updateYoutubeDraft = (patch: Partial<YouTubeBroadcastDraft>) => {
    setDraft((current) => (current.streamServiceSettings ? { ...current, streamServiceSettings: { ...current.streamServiceSettings, youtube: { ...current.streamServiceSettings.youtube, ...patch } } } : current));
  };
  const changeStreamService = (serviceId: StreamServiceId) => {
    const preset = getStreamService(serviceId);
    updateStreamService({ service: serviceId, serverId: preset.servers[0]?.id ?? '' });
  };

  const applyChanges = () => {
    const patches = applySettingsDraft(draft, baseline);
    if (patches.outputPatch) {
      const outputPatch = patches.outputPatch;
      setProjectValue((current) => ({ ...current, output: { ...current.output, ...outputPatch } }));
    }
    if (patches.audioSettingsPatch?.monitoringDeviceId !== undefined) {
      audio.onUpdateMonitoringDevice(patches.audioSettingsPatch.monitoringDeviceId);
    }
    if (patches.recordingPreferencesPatch?.filenameFormat !== undefined) {
      recording.onFilenameBlur(patches.recordingPreferencesPatch.filenameFormat);
    }
    if (patches.replayBufferDurationSeconds !== undefined) {
      setReplayBufferDurationSeconds(patches.replayBufferDurationSeconds);
    }
    if (patches.streamServiceSettings) {
      onSaveStreamServiceSettings?.(patches.streamServiceSettings);
    }
    setBaseline(draft);
  };

  const requestClose = () => {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };
  const handleOk = () => {
    if (hasErrors) return;
    applyChanges();
    onClose();
  };
  const keepEditing = () => setConfirmingDiscard(false);
  const confirmDiscard = () => {
    setConfirmingDiscard(false);
    onClose();
  };

  const selectPage = (next: SettingsPage) => {
    setPage(next);
    setConfirmingDiscard(false);
  };

  const handleNavKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown' ? (index + 1) % SETTINGS_PAGES.length : (index - 1 + SETTINGS_PAGES.length) % SETTINGS_PAGES.length;
    const next = SETTINGS_PAGES[nextIndex]!;
    selectPage(next.id);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next.id}`)?.focus());
  };

  return (
    <Modal open onClose={requestClose} title="Settings">
      <div className="settings-dialog-root">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_PAGES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-selected={page === item.id}
              aria-controls={`settings-panel-${item.id}`}
              tabIndex={page === item.id ? 0 : -1}
              className={`settings-nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => selectPage(item.id)}
              onKeyDown={(event) => handleNavKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-content" id={`settings-panel-${page}`} role="tabpanel" aria-labelledby={`settings-tab-${page}`}>
          {page === 'general' && (
            <GeneralPage
              seconds={draft.replayBufferDurationSeconds}
              disabled={replayBufferStartedAt !== null}
              onChange={(seconds) => setDraft((current) => ({ ...current, replayBufferDurationSeconds: seconds }))}
            />
          )}
          {page === 'stream' && (draft.streamServiceSettings ? (
            <StreamPage
              settings={draft.streamServiceSettings}
              onChangeService={changeStreamService}
              onUpdate={updateStreamService}
              onUpdateYoutube={updateYoutubeDraft}
              keyVisible={keyVisible}
              onToggleKeyVisible={() => setKeyVisible((value) => !value)}
            />
          ) : (
            <EmptyState.Root>
              <EmptyState.Title>Stream service settings unavailable</EmptyState.Title>
            </EmptyState.Root>
          ))}
          {page === 'output' && (
            <OutputPage
              output={draft.output}
              errors={errors}
              updateOutput={updateOutput}
              recording={recording}
              updateRecordingPreferences={updateRecordingPreferences}
              filenameFormat={draft.recordingPreferences.filenameFormat}
              recordingLocked={recordingStartedAt !== null || recordingFinalizing}
              replayBufferStartedAt={replayBufferStartedAt}
              videoEncoderOptions={videoEncoderOptions}
              systemVideoEncoder={systemVideoEncoder}
              platform={platformValue}
            />
          )}
          {page === 'audio' && <AudioPage audio={audio} monitoringDeviceId={draft.audioSettings.monitoringDeviceId} updateAudio={updateAudioSettings} />}
          {page === 'video' && <VideoPage output={draft.output} errors={errors} updateOutput={updateOutput} />}
          {page === 'hotkeys' && <HotkeysPage project={project} hotkeys={hotkeys} />}
          {page === 'advanced' && <AdvancedPage onRemuxRecording={onRemuxRecording} />}
        </div>
      </div>
      <div className="modal-footer">
        {confirmingDiscard ? (
          <>
            <span>Discard unsaved changes?</span>
            <button type="button" className="secondary-button" onClick={keepEditing}>Keep Editing</button>
            <button type="button" className="secondary-button" onClick={confirmDiscard}>Discard</button>
          </>
        ) : (
          <>
            <button type="button" className="secondary-button" onClick={requestClose}>Cancel</button>
            <button type="button" className="secondary-button" disabled={!dirty || hasErrors} onClick={applyChanges}>Apply</button>
            <button type="button" className="primary-button" disabled={hasErrors} onClick={handleOk}>OK</button>
          </>
        )}
      </div>
    </Modal>
  );
}

function GeneralPage({ seconds, disabled, onChange }: { seconds: number; disabled: boolean; onChange: (seconds: number) => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Replay Buffer</strong></div>
      <label>Replay buffer duration
        <Select
          label="Replay buffer duration"
          value={String(seconds)}
          disabled={disabled}
          onValueChange={(value) => onChange(Number(value))}
          options={REPLAY_BUFFER_OPTIONS.map((value) => ({ value: String(value), label: `${value} seconds` }))}
        />
      </label>
    </div>
  );
}

function StreamPage({
  settings,
  onChangeService,
  onUpdate,
  onUpdateYoutube,
  keyVisible,
  onToggleKeyVisible,
}: {
  settings: StreamServiceSettings;
  onChangeService: (service: StreamServiceId) => void;
  onUpdate: (patch: Partial<StreamServiceSettings>) => void;
  onUpdateYoutube: (patch: Partial<YouTubeBroadcastDraft>) => void;
  keyVisible: boolean;
  onToggleKeyVisible: () => void;
}) {
  const preset = getStreamService(settings.service);
  const validationMessage = validateStreamServiceSettings(settings);
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Service</strong></div>
      <label>Service
        <Select
          label="Stream service"
          value={settings.service}
          onValueChange={onChangeService}
          options={STREAM_SERVICES.map((service) => ({ value: service.id, label: service.label }))}
        />
      </label>
      {settings.service === 'custom' ? (
        <label>Server URL
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="RTMP(S), srt://, or rist:// URL"
            value={settings.customServer}
            onChange={(event) => onUpdate({ customServer: event.target.value })}
          />
        </label>
      ) : (
        <label>Server
          <Select
            label="Ingest server"
            value={settings.serverId}
            onValueChange={(value) => onUpdate({ serverId: value })}
            options={preset.servers.map((server) => ({ value: server.id, label: server.label }))}
          />
        </label>
      )}
      <label>{preset.keyLabel}
        <div className="settings-password-row">
          <input
            type={keyVisible ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={512}
            value={settings.streamKey}
            onChange={(event) => onUpdate({ streamKey: event.target.value })}
          />
          <button type="button" className="mini-icon" aria-label={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={onToggleKeyVisible}>
            {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>
      {validationMessage && <p className="hotkey-error" role="status">{validationMessage}</p>}
      {settings.service === 'youtube' && (
        <>
          <div className="popover-heading video-heading"><strong>Broadcast</strong></div>
          <label>Title
            <input type="text" maxLength={100} value={settings.youtube.title} onChange={(event) => onUpdateYoutube({ title: event.target.value })} />
          </label>
          <label>Description
            <textarea rows={3} maxLength={5000} value={settings.youtube.description} onChange={(event) => onUpdateYoutube({ description: event.target.value })} />
          </label>
          <label>Privacy
            <SegmentedControl
              label="Broadcast privacy"
              value={settings.youtube.privacy}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (next) onUpdateYoutube({ privacy: next as YouTubePrivacy });
              }}
            >
              <SegmentedControl.Label value="public">Public</SegmentedControl.Label>
              <SegmentedControl.Label value="unlisted">Unlisted</SegmentedControl.Label>
              <SegmentedControl.Label value="private">Private</SegmentedControl.Label>
            </SegmentedControl>
          </label>
        </>
      )}
    </div>
  );
}

function OutputPage({
  output,
  errors,
  updateOutput,
  recording,
  updateRecordingPreferences,
  filenameFormat,
  recordingLocked,
  replayBufferStartedAt,
  videoEncoderOptions,
  systemVideoEncoder,
  platform,
}: {
  output: StreamOutputConfiguration;
  errors: SettingsDraftErrors;
  updateOutput: (patch: Partial<StreamOutputConfiguration>) => void;
  recording: RecordingPreferencesBundle;
  updateRecordingPreferences: (patch: Partial<StreamRecordingPreferences>) => void;
  filenameFormat: string;
  recordingLocked: boolean;
  replayBufferStartedAt: number | null;
  videoEncoderOptions: ReadonlyArray<{ value: VideoEncoderFamily; label: string }>;
  systemVideoEncoder: VideoEncoderFamily | null;
  platform: StreamPlatform;
}) {
  const hardwareLabel = hardwareEncodingLabelForPlatform(platform);
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Streaming</strong></div>
      <div className="settings-field-grid">
        <label>Video bitrate (kb/s)
          <input type="number" min={250} max={50000} step={250} disabled={output.streamRateControl === 'quality'} value={output.streamVideoBitrateKbps} onChange={(event) => updateOutput({ streamVideoBitrateKbps: Number(event.target.value) })} />
          <FieldError message={errors.streamVideoBitrateKbps} />
        </label>
        <label>Audio bitrate (kb/s)
          <input type="number" min={32} max={320} step={16} value={output.streamAudioBitrateKbps} onChange={(event) => updateOutput({ streamAudioBitrateKbps: Number(event.target.value) })} />
          <FieldError message={errors.streamAudioBitrateKbps} />
        </label>
      </div>
      <label>Audio track
        <Select
          label="Streaming audio track"
          value={String(output.streamAudioTrack)}
          onValueChange={(value) => updateOutput({ streamAudioTrack: Number(value) as AudioTrack })}
          options={AUDIO_TRACKS.map((track) => ({ value: String(track), label: `Track ${track}` }))}
        />
      </label>
      <label>Video encoder
        <Select
          label="Streaming video encoder"
          value={output.streamVideoEncoder}
          onValueChange={(value) => updateOutput({ streamVideoEncoder: value, streamRateControl: normalizeVideoRateControl(value, output.streamRateControl) })}
          options={videoEncoderOptions}
        />
        <FieldError message={errors.streamVideoEncoder} />
      </label>
      <label>Rate control
        <Select
          label="Streaming rate control"
          value={output.streamRateControl}
          onValueChange={(value) => updateOutput({ streamRateControl: value })}
          options={VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(output.streamVideoEncoder).includes(option.value))}
        />
      </label>
      <label>Encoder quality
        <input type="range" min={0} max={100} disabled={output.streamVideoEncoder === 'libopenh264'} value={output.streamEncoderQuality} onChange={(event) => updateOutput({ streamEncoderQuality: Number(event.target.value) })} />
        <span className="range-value">{output.streamEncoderQuality}</span>
      </label>
      <label>Keyframe interval (seconds)
        <input type="number" min={1} max={10} step={1} value={output.streamKeyframeIntervalSeconds} onChange={(event) => updateOutput({ streamKeyframeIntervalSeconds: Number(event.target.value) })} />
        <FieldError message={errors.streamKeyframeIntervalSeconds} />
      </label>
      <div className="settings-toggle-row">
        <Switch checked={output.streamHardwareEncoding} disabled={output.streamVideoEncoder !== systemVideoEncoder} onCheckedChange={(checked) => updateOutput({ streamHardwareEncoding: checked })} label={hardwareLabel} />
        <span>{hardwareLabel}</span>
      </div>

      <div className="popover-heading video-heading"><strong>Recording</strong></div>
      <label>Recording folder
        <div className="recording-directory-control">
          <input aria-label="Recording folder" readOnly value={recording.recordingPreferences.directory || 'Videos'} title={recording.recordingPreferences.directory || 'Videos'} />
          <button type="button" className="secondary-button" onClick={recording.onChooseDirectory}>Browse</button>
          <button type="button" className="secondary-button" onClick={recording.onUseDefaultDirectory}>Default</button>
        </div>
      </label>
      <label>Filename format
        <input aria-label="Recording filename format" maxLength={120} value={filenameFormat} onChange={(event) => updateRecordingPreferences({ filenameFormat: event.target.value })} />
        <FieldError message={errors.recordingFilenameFormat} />
      </label>
      {recording.recordingPreferencesError && <p className="hotkey-error" role="alert">{recording.recordingPreferencesError}</p>}
      <details className="filter-details settings-audio-tracks">
        <summary>Recording audio tracks</summary>
        <div className="audio-track-grid">
          {AUDIO_TRACKS.map((track) => (
            <Checkbox
              key={track}
              label={`Track ${track}`}
              checked={output.recordingAudioTracks.includes(track)}
              disabled={recordingLocked || replayBufferStartedAt !== null}
              onCheckedChange={(checked) => updateOutput({
                recordingAudioTracks: checked
                  ? [...new Set([...output.recordingAudioTracks, track])].sort((left, right) => left - right)
                  : output.recordingAudioTracks.filter((value) => value !== track),
              })}
            />
          ))}
        </div>
      </details>
      <div className="settings-field-grid">
        <label>Recording video bitrate (kb/s)
          <input type="number" min={500} max={50000} step={500} disabled={output.recordingContainer === 'mp4' && output.recordingRateControl === 'quality'} value={output.recordingVideoBitrateKbps} onChange={(event) => updateOutput({ recordingVideoBitrateKbps: Number(event.target.value) })} />
          <FieldError message={errors.recordingVideoBitrateKbps} />
        </label>
        <label>Audio bitrate per track (kb/s)
          <input type="number" min={32} max={320} step={16} value={output.recordingAudioBitrateKbps} onChange={(event) => updateOutput({ recordingAudioBitrateKbps: Number(event.target.value) })} />
          <FieldError message={errors.recordingAudioBitrateKbps} />
        </label>
      </div>
      <label>Recording format
        <Select label="Recording format" value={output.recordingContainer} disabled={recordingLocked} onValueChange={(value) => updateOutput({ recordingContainer: value })} options={RECORDING_CONTAINER_OPTIONS} />
      </label>
      <label>MP4 encoder
        <Select
          label="MP4 encoder"
          value={output.recordingVideoEncoder}
          disabled={output.recordingContainer !== 'mp4' || recordingLocked}
          onValueChange={(value) => updateOutput({ recordingVideoEncoder: value, recordingRateControl: normalizeVideoRateControl(value, output.recordingRateControl) })}
          options={videoEncoderOptions}
        />
        <FieldError message={errors.recordingVideoEncoder} />
      </label>
      <label>MP4 rate control
        <Select
          label="MP4 rate control"
          value={output.recordingRateControl}
          disabled={output.recordingContainer !== 'mp4' || recordingLocked}
          onValueChange={(value) => updateOutput({ recordingRateControl: value })}
          options={VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(output.recordingVideoEncoder).includes(option.value))}
        />
      </label>
      <label>MP4 encoder quality
        <input type="range" min={0} max={100} disabled={output.recordingContainer !== 'mp4' || output.recordingVideoEncoder === 'libopenh264' || recordingLocked} value={output.recordingEncoderQuality} onChange={(event) => updateOutput({ recordingEncoderQuality: Number(event.target.value) })} />
        <span className="range-value">{output.recordingEncoderQuality}</span>
      </label>
      <label>MP4 keyframe interval (seconds)
        <input type="number" min={1} max={10} step={1} disabled={output.recordingContainer !== 'mp4' || recordingLocked} value={output.recordingKeyframeIntervalSeconds} onChange={(event) => updateOutput({ recordingKeyframeIntervalSeconds: Number(event.target.value) })} />
        <FieldError message={errors.recordingKeyframeIntervalSeconds} />
      </label>
      <div className="settings-toggle-row">
        <Switch
          checked={output.recordingHardwareEncoding}
          disabled={output.recordingContainer !== 'mp4' || output.recordingVideoEncoder !== systemVideoEncoder || recordingLocked}
          onCheckedChange={(checked) => updateOutput({ recordingHardwareEncoding: checked })}
          label="MP4 hardware encoding"
        />
        <span>MP4 hardware encoding</span>
      </div>
    </div>
  );
}

function AudioPage({ audio, monitoringDeviceId, updateAudio }: { audio: AudioSettingsBundle; monitoringDeviceId: string; updateAudio: (patch: Partial<StreamAudioSettings>) => void }) {
  const savedDeviceMissing = monitoringDeviceId !== '' && !audio.audioOutputDevices.some((device) => device.deviceId === monitoringDeviceId);
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Monitoring</strong></div>
      <label>Monitoring device
        <Select
          label="Monitoring device"
          disabled={!audio.monitorDeviceSelectionSupported}
          value={monitoringDeviceId === '' ? DEFAULT_MONITORING_DEVICE : monitoringDeviceId}
          onValueChange={(value) => updateAudio({ monitoringDeviceId: value === DEFAULT_MONITORING_DEVICE ? '' : value })}
          options={[
            { value: DEFAULT_MONITORING_DEVICE, label: 'System Default' },
            ...(savedDeviceMissing ? [{ value: monitoringDeviceId, label: 'Saved device unavailable' }] : []),
            ...audio.audioOutputDevices.map((device) => ({ value: device.deviceId, label: device.label })),
          ]}
        />
      </label>
      {audio.audioSettingsError && <p className="hotkey-error" role="alert">{audio.audioSettingsError}</p>}
      {!audio.monitorDeviceSelectionSupported && <p className="hotkey-error" role="status">Audio output device selection is unavailable.</p>}
    </div>
  );
}

function VideoPage({ output, errors, updateOutput }: { output: StreamOutputConfiguration; errors: SettingsDraftErrors; updateOutput: (patch: Partial<StreamOutputConfiguration>) => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Canvas</strong></div>
      <div className="settings-field-grid">
        <label>Base (Canvas) width
          <input aria-label="Base canvas width" type="number" min={320} max={16384} step={1} value={output.baseWidth} onChange={(event) => updateOutput({ baseWidth: Number(event.target.value) })} />
          <FieldError message={errors.baseWidth} />
        </label>
        <label>Base (Canvas) height
          <input aria-label="Base canvas height" type="number" min={180} max={16384} step={1} value={output.baseHeight} onChange={(event) => updateOutput({ baseHeight: Number(event.target.value) })} />
          <FieldError message={errors.baseHeight} />
        </label>
        <label>Output (Scaled) width
          <input aria-label="Output scaled width" type="number" min={SCALED_OUTPUT_LIMITS.minWidth} max={SCALED_OUTPUT_LIMITS.maxWidth} step={2} value={output.width} onChange={(event) => updateOutput({ width: Number(event.target.value) })} />
          <FieldError message={errors.width} />
        </label>
        <label>Output (Scaled) height
          <input aria-label="Output scaled height" type="number" min={SCALED_OUTPUT_LIMITS.minHeight} max={SCALED_OUTPUT_LIMITS.maxHeight} step={2} value={output.height} onChange={(event) => updateOutput({ height: Number(event.target.value) })} />
          <FieldError message={errors.height} />
        </label>
      </div>
      <label>Frame rate (FPS)
        <input aria-label="Frame rate" type="number" min={1} max={240} step={0.01} value={output.frameRate} onChange={(event) => updateOutput({ frameRate: Number(event.target.value) })} />
        <FieldError message={errors.frameRate} />
      </label>
    </div>
  );
}

function HotkeysPage({ project, hotkeys }: { project: StreamProject; hotkeys: HotkeysDraftBundle }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Global Hotkeys</strong></div>
      <label>Toggle streaming<input aria-label="Toggle streaming shortcut" readOnly value={hotkeys.hotkeyDraft?.toggleStreaming ?? project.hotkeys.toggleStreaming} onKeyDown={(event) => hotkeys.onCaptureHotkey('toggleStreaming', event)} /></label>
      <label>Toggle recording<input aria-label="Toggle recording shortcut" readOnly value={hotkeys.hotkeyDraft?.toggleRecording ?? project.hotkeys.toggleRecording} onKeyDown={(event) => hotkeys.onCaptureHotkey('toggleRecording', event)} /></label>
      <label>Toggle replay buffer<input aria-label="Toggle replay buffer shortcut" readOnly value={hotkeys.hotkeyDraft?.toggleReplayBuffer ?? project.hotkeys.toggleReplayBuffer} onKeyDown={(event) => hotkeys.onCaptureHotkey('toggleReplayBuffer', event)} /></label>
      <label>Save replay<input aria-label="Save replay shortcut" readOnly value={hotkeys.hotkeyDraft?.saveReplay ?? project.hotkeys.saveReplay} onKeyDown={(event) => hotkeys.onCaptureHotkey('saveReplay', event)} /></label>
      <div className="popover-heading video-heading"><strong>Scene Switches</strong></div>
      {project.scenes.map((scene) => <label key={scene.id}>{scene.name}<input aria-label={`Switch to ${scene.name} shortcut`} readOnly value={hotkeys.sceneSwitchHotkeyDraft[scene.id] ?? ''} onKeyDown={(event) => hotkeys.onCaptureSceneSwitchHotkey(scene.id, event)} /></label>)}
      <div className="popover-heading video-heading"><strong>Source Visibility</strong></div>
      {project.scenes.flatMap((scene) => flattenSourceNodes(scene.sources).map((source) => (
        <label key={source.id}>{scene.name} · {source.name}<input aria-label={`Toggle visibility for ${source.name} in ${scene.name} shortcut`} readOnly value={hotkeys.sourceVisibilityHotkeyDraft[source.id] ?? ''} onKeyDown={(event) => hotkeys.onCaptureSourceVisibilityHotkey(source.id, event)} /></label>
      )))}
      {hotkeys.hotkeyError && <p className="hotkey-error" role="alert">{hotkeys.hotkeyError}</p>}
      <button className="apply-hotkeys" type="button" disabled={hotkeys.hotkeysWorking || !hotkeys.hotkeyDraft} onClick={hotkeys.onApply}>{hotkeys.hotkeysWorking ? 'Applying…' : 'Apply Hotkeys'}</button>
    </div>
  );
}

function AdvancedPage({ onRemuxRecording }: { onRemuxRecording?: () => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Filename Tokens</strong></div>
      <dl className="settings-token-legend">
        {FILENAME_TOKENS.map(({ token, meaning }) => (
          <div key={token} className="settings-token-row"><dt>{token}</dt><dd>{meaning}</dd></div>
        ))}
      </dl>
      <div className="popover-heading video-heading"><strong>Recordings</strong></div>
      <button type="button" className="secondary-button" disabled={!onRemuxRecording} onClick={() => onRemuxRecording?.()}>Remux Recordings…</button>
    </div>
  );
}
