import { useEffect, useMemo, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import { Banner, Checkbox, Field, Modal, NumberField, ReacstButton, SegmentedControl, Select, Slider, Switch, Tabs, TextField, Textarea } from '@lumacast/ui';
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
import { StreamKeyField } from './stream-key-field';
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

  const renderPage = (id: SettingsPage) => {
    switch (id) {
      case 'general':
        return (
          <GeneralPage
            seconds={draft.replayBufferDurationSeconds}
            disabled={replayBufferStartedAt !== null}
            onChange={(seconds) => setDraft((current) => ({ ...current, replayBufferDurationSeconds: seconds }))}
          />
        );
      case 'stream':
        return draft.streamServiceSettings ? (
          <StreamPage
            settings={draft.streamServiceSettings}
            onChangeService={changeStreamService}
            onUpdate={updateStreamService}
            onUpdateYoutube={updateYoutubeDraft}
          />
        ) : (
          <Banner tone="warning" size="sm">Stream service settings unavailable</Banner>
        );
      case 'output':
        return (
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
        );
      case 'audio':
        return <AudioPage audio={audio} monitoringDeviceId={draft.audioSettings.monitoringDeviceId} updateAudio={updateAudioSettings} />;
      case 'video':
        return <VideoPage output={draft.output} errors={errors} updateOutput={updateOutput} />;
      case 'hotkeys':
        return <HotkeysPage project={project} hotkeys={hotkeys} />;
      case 'advanced':
        return <AdvancedPage onRemuxRecording={onRemuxRecording} />;
    }
  };

  return (
    <Modal
      open
      onClose={requestClose}
      title="Settings"
      footer={confirmingDiscard ? (
        <div className="settings-dialog-footer">
          <span className="settings-discard-note label-xs text-tertiary">Discard unsaved changes?</span>
          <ReacstButton size="sm" onClick={keepEditing}>Keep Editing</ReacstButton>
          <ReacstButton size="sm" variant="danger" onClick={confirmDiscard}>Discard</ReacstButton>
        </div>
      ) : (
        <>
          <div className="settings-dialog-footer">
            <ReacstButton size="sm" onClick={requestClose}>Cancel</ReacstButton>
            <ReacstButton size="sm" variant="tinted" disabled={!dirty || hasErrors} onClick={applyChanges}>Apply</ReacstButton>
            <ReacstButton size="sm" variant="primary" disabled={hasErrors} onClick={handleOk}>OK</ReacstButton>
          </div>
        </>
      )}
    >
      <Tabs value={page} onValueChange={(next) => selectPage(next as SettingsPage)} orientation="vertical" variant="pill" className="settings-dialog-root">
        <Tabs.List className="settings-nav">
          {SETTINGS_PAGES.map((item) => <Tabs.Tab key={item.id} value={item.id}>{item.label}</Tabs.Tab>)}
        </Tabs.List>
        {SETTINGS_PAGES.map((item) => (
          <Tabs.Panel key={item.id} value={item.id} className="settings-content">
            {renderPage(item.id)}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Modal>
  );
}

function GeneralPage({ seconds, disabled, onChange }: { seconds: number; disabled: boolean; onChange: (seconds: number) => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Replay Buffer</strong></div>
      <Select
        label="Replay buffer duration"
        value={String(seconds)}
        disabled={disabled}
        onValueChange={(value) => onChange(Number(value))}
        options={REPLAY_BUFFER_OPTIONS.map((value) => ({ value: String(value), label: `${value} seconds` }))}
      />
    </div>
  );
}

function StreamPage({
  settings,
  onChangeService,
  onUpdate,
  onUpdateYoutube,
}: {
  settings: StreamServiceSettings;
  onChangeService: (service: StreamServiceId) => void;
  onUpdate: (patch: Partial<StreamServiceSettings>) => void;
  onUpdateYoutube: (patch: Partial<YouTubeBroadcastDraft>) => void;
}) {
  const preset = getStreamService(settings.service);
  const validationMessage = validateStreamServiceSettings(settings);
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Service</strong></div>
      <Select
        label="Service"
        value={settings.service}
        onValueChange={onChangeService}
        options={STREAM_SERVICES.map((service) => ({ value: service.id, label: service.label }))}
      />
      {settings.service === 'custom' ? (
        <TextField label="Server URL" placeholder="RTMP(S), srt://, or rist:// URL" value={settings.customServer} onValueChange={(customServer) => onUpdate({ customServer })} />
      ) : (
        <Select
          label="Server"
          value={settings.serverId}
          onValueChange={(serverId) => onUpdate({ serverId })}
          options={preset.servers.map((server) => ({ value: server.id, label: server.label }))}
        />
      )}
      <StreamKeyField label={preset.keyLabel} value={settings.streamKey} onValueChange={(streamKey) => onUpdate({ streamKey })} />
      {validationMessage && <Banner tone="warning" size="sm">{validationMessage}</Banner>}
      {settings.service === 'youtube' && (
        <>
          <div className="popover-heading video-heading"><strong>Broadcast</strong></div>
          <TextField label="Title" maxLength={100} value={settings.youtube.title} onValueChange={(title) => onUpdateYoutube({ title })} />
          <Textarea label="Description" rows={3} maxLength={5000} value={settings.youtube.description} onValueChange={(description) => onUpdateYoutube({ description })} />
          <Field label="Privacy">
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
          </Field>
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
  const mp4Locked = output.recordingContainer !== 'mp4' || recordingLocked;
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Streaming</strong></div>
      <div className="settings-field-grid">
        <NumberField label="Video bitrate" suffix="kb/s" min={250} max={50000} step={250} disabled={output.streamRateControl === 'quality'} value={output.streamVideoBitrateKbps} onValueChange={(streamVideoBitrateKbps) => updateOutput({ streamVideoBitrateKbps })} error={errors.streamVideoBitrateKbps} />
        <NumberField label="Audio bitrate" suffix="kb/s" min={32} max={320} step={16} value={output.streamAudioBitrateKbps} onValueChange={(streamAudioBitrateKbps) => updateOutput({ streamAudioBitrateKbps })} error={errors.streamAudioBitrateKbps} />
      </div>
      <Select
        label="Audio track"
        value={String(output.streamAudioTrack)}
        onValueChange={(value) => updateOutput({ streamAudioTrack: Number(value) as AudioTrack })}
        options={AUDIO_TRACKS.map((track) => ({ value: String(track), label: `Track ${track}` }))}
      />
      <Select
        label="Video encoder"
        value={output.streamVideoEncoder}
        onValueChange={(value) => updateOutput({ streamVideoEncoder: value, streamRateControl: normalizeVideoRateControl(value, output.streamRateControl) })}
        options={videoEncoderOptions}
        error={errors.streamVideoEncoder}
      />
      <Select
        label="Rate control"
        value={output.streamRateControl}
        onValueChange={(value) => updateOutput({ streamRateControl: value })}
        options={VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(output.streamVideoEncoder).includes(option.value))}
      />
      <Slider label="Encoder quality" showValue min={0} max={100} disabled={output.streamVideoEncoder === 'libopenh264'} value={output.streamEncoderQuality} onValueChange={(streamEncoderQuality) => updateOutput({ streamEncoderQuality })} />
      <NumberField label="Keyframe interval" suffix="s" min={1} max={10} step={1} value={output.streamKeyframeIntervalSeconds} onValueChange={(streamKeyframeIntervalSeconds) => updateOutput({ streamKeyframeIntervalSeconds })} error={errors.streamKeyframeIntervalSeconds} />
      <div className="settings-toggle-row">
        <Switch checked={output.streamHardwareEncoding} disabled={output.streamVideoEncoder !== systemVideoEncoder} onCheckedChange={(checked) => updateOutput({ streamHardwareEncoding: checked })} label={hardwareLabel} />
        <span>{hardwareLabel}</span>
      </div>

      <div className="popover-heading video-heading"><strong>Recording</strong></div>
      <TextField
        label="Recording folder"
        readOnly
        value={recording.recordingPreferences.directory || 'Videos'}
        onValueChange={() => {}}
        trailing={
          <>
            <ReacstButton size="xs" variant="ghost" onClick={recording.onChooseDirectory}>Browse</ReacstButton>
            <ReacstButton size="xs" variant="ghost" onClick={recording.onUseDefaultDirectory}>Default</ReacstButton>
          </>
        }
      />
      <TextField label="Filename format" maxLength={120} value={filenameFormat} onValueChange={(value) => updateRecordingPreferences({ filenameFormat: value })} error={errors.recordingFilenameFormat} />
      {recording.recordingPreferencesError && <Banner tone="error" size="sm">{recording.recordingPreferencesError}</Banner>}
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
        <NumberField label="Recording video bitrate" suffix="kb/s" min={500} max={50000} step={500} disabled={output.recordingContainer === 'mp4' && output.recordingRateControl === 'quality'} value={output.recordingVideoBitrateKbps} onValueChange={(recordingVideoBitrateKbps) => updateOutput({ recordingVideoBitrateKbps })} error={errors.recordingVideoBitrateKbps} />
        <NumberField label="Audio bitrate per track" suffix="kb/s" min={32} max={320} step={16} value={output.recordingAudioBitrateKbps} onValueChange={(recordingAudioBitrateKbps) => updateOutput({ recordingAudioBitrateKbps })} error={errors.recordingAudioBitrateKbps} />
      </div>
      <Select label="Recording format" value={output.recordingContainer} disabled={recordingLocked} onValueChange={(value) => updateOutput({ recordingContainer: value })} options={RECORDING_CONTAINER_OPTIONS} />
      <Select
        label="MP4 encoder"
        value={output.recordingVideoEncoder}
        disabled={mp4Locked}
        onValueChange={(value) => updateOutput({ recordingVideoEncoder: value, recordingRateControl: normalizeVideoRateControl(value, output.recordingRateControl) })}
        options={videoEncoderOptions}
        error={errors.recordingVideoEncoder}
      />
      <Select
        label="MP4 rate control"
        value={output.recordingRateControl}
        disabled={mp4Locked}
        onValueChange={(value) => updateOutput({ recordingRateControl: value })}
        options={VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(output.recordingVideoEncoder).includes(option.value))}
      />
      <Slider label="MP4 encoder quality" showValue min={0} max={100} disabled={mp4Locked || output.recordingVideoEncoder === 'libopenh264'} value={output.recordingEncoderQuality} onValueChange={(recordingEncoderQuality) => updateOutput({ recordingEncoderQuality })} />
      <NumberField label="MP4 keyframe interval" suffix="s" min={1} max={10} step={1} disabled={mp4Locked} value={output.recordingKeyframeIntervalSeconds} onValueChange={(recordingKeyframeIntervalSeconds) => updateOutput({ recordingKeyframeIntervalSeconds })} error={errors.recordingKeyframeIntervalSeconds} />
      <div className="settings-toggle-row">
        <Switch
          checked={output.recordingHardwareEncoding}
          disabled={mp4Locked || output.recordingVideoEncoder !== systemVideoEncoder}
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
      {audio.audioSettingsError && <Banner tone="error" size="sm">{audio.audioSettingsError}</Banner>}
      {!audio.monitorDeviceSelectionSupported && <Banner tone="warning" size="sm">Audio output device selection is unavailable.</Banner>}
    </div>
  );
}

function VideoPage({ output, errors, updateOutput }: { output: StreamOutputConfiguration; errors: SettingsDraftErrors; updateOutput: (patch: Partial<StreamOutputConfiguration>) => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Canvas</strong></div>
      <div className="settings-field-grid">
        <NumberField label="Base (Canvas) width" suffix="px" min={320} max={16384} step={1} value={output.baseWidth} onValueChange={(baseWidth) => updateOutput({ baseWidth })} error={errors.baseWidth} />
        <NumberField label="Base (Canvas) height" suffix="px" min={180} max={16384} step={1} value={output.baseHeight} onValueChange={(baseHeight) => updateOutput({ baseHeight })} error={errors.baseHeight} />
        <NumberField label="Output (Scaled) width" suffix="px" min={SCALED_OUTPUT_LIMITS.minWidth} max={SCALED_OUTPUT_LIMITS.maxWidth} step={2} value={output.width} onValueChange={(width) => updateOutput({ width })} error={errors.width} />
        <NumberField label="Output (Scaled) height" suffix="px" min={SCALED_OUTPUT_LIMITS.minHeight} max={SCALED_OUTPUT_LIMITS.maxHeight} step={2} value={output.height} onValueChange={(height) => updateOutput({ height })} error={errors.height} />
      </div>
      <NumberField label="Frame rate" suffix="FPS" min={1} max={240} step={0.01} value={output.frameRate} onValueChange={(frameRate) => updateOutput({ frameRate })} error={errors.frameRate} />
    </div>
  );
}

function HotkeysPage({ project, hotkeys }: { project: StreamProject; hotkeys: HotkeysDraftBundle }) {
  // TextField has no key handler, so the capture inputs stay native inside Field.
  const globalRows: ReadonlyArray<{ action: keyof StreamGlobalHotkeys; label: string; ariaLabel: string }> = [
    { action: 'toggleStreaming', label: 'Toggle streaming', ariaLabel: 'Toggle streaming shortcut' },
    { action: 'toggleRecording', label: 'Toggle recording', ariaLabel: 'Toggle recording shortcut' },
    { action: 'toggleReplayBuffer', label: 'Toggle replay buffer', ariaLabel: 'Toggle replay buffer shortcut' },
    { action: 'saveReplay', label: 'Save replay', ariaLabel: 'Save replay shortcut' },
  ];
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Global Hotkeys</strong></div>
      {globalRows.map((row) => (
        <Field key={row.action} label={row.label} htmlFor={`hotkey-${row.action}`}>
          <input id={`hotkey-${row.action}`} className="settings-hotkey-input" aria-label={row.ariaLabel} readOnly value={hotkeys.hotkeyDraft?.[row.action] ?? project.hotkeys[row.action]} onKeyDown={(event) => hotkeys.onCaptureHotkey(row.action, event)} />
        </Field>
      ))}
      <div className="popover-heading video-heading"><strong>Scene Switches</strong></div>
      {project.scenes.map((scene) => (
        <Field key={scene.id} label={scene.name} htmlFor={`hotkey-scene-${scene.id}`}>
          <input id={`hotkey-scene-${scene.id}`} className="settings-hotkey-input" aria-label={`Switch to ${scene.name} shortcut`} readOnly value={hotkeys.sceneSwitchHotkeyDraft[scene.id] ?? ''} onKeyDown={(event) => hotkeys.onCaptureSceneSwitchHotkey(scene.id, event)} />
        </Field>
      ))}
      <div className="popover-heading video-heading"><strong>Source Visibility</strong></div>
      {project.scenes.flatMap((scene) => flattenSourceNodes(scene.sources).map((source) => (
        <Field key={source.id} label={`${scene.name} · ${source.name}`} htmlFor={`hotkey-source-${source.id}`}>
          <input id={`hotkey-source-${source.id}`} className="settings-hotkey-input" aria-label={`Toggle visibility for ${source.name} in ${scene.name} shortcut`} readOnly value={hotkeys.sourceVisibilityHotkeyDraft[source.id] ?? ''} onKeyDown={(event) => hotkeys.onCaptureSourceVisibilityHotkey(source.id, event)} />
        </Field>
      )))}
      {hotkeys.hotkeyError && <Banner tone="error" size="sm">{hotkeys.hotkeyError}</Banner>}
      <ReacstButton size="sm" variant="tinted" fullWidth disabled={hotkeys.hotkeysWorking || !hotkeys.hotkeyDraft} onClick={hotkeys.onApply}>{hotkeys.hotkeysWorking ? 'Applying…' : 'Apply Hotkeys'}</ReacstButton>
    </div>
  );
}

function AdvancedPage({ onRemuxRecording }: { onRemuxRecording?: () => void }) {
  return (
    <div className="settings-page">
      <div className="popover-heading"><strong>Recordings</strong></div>
      <ReacstButton size="sm" variant="default" disabled={!onRemuxRecording} onClick={() => onRemuxRecording?.()}>Convert to MP4…</ReacstButton>
      <p className="settings-supporting-copy">Repackages MKV or WebM without re-encoding. The original file stays intact.</p>
      <details className="filter-details settings-token-details">
        <summary>Filename tokens</summary>
        <dl className="settings-token-legend">
          {FILENAME_TOKENS.map(({ token, meaning }) => (
            <div key={token} className="settings-token-row"><dt>{token}</dt><dd>{meaning}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  );
}
