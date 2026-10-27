import { useId } from 'react';
import { Banner, Checkbox, Modal, NumberField, ReacstButton, Select, Slider, TextField } from '@lumacast/ui';
import { StreamKeyField } from './stream-key-field';
import { hardwareEncodingLabelForPlatform, type StreamPlatform } from '../../shared/platform-capabilities';
import { getStreamService, STREAM_SERVICES, validateStreamServiceSettings, type StreamServiceId } from '../../shared/stream-services';
import {
  AUDIO_TRACKS,
  getVideoEncoderRateControlModes,
  normalizeVideoRateControl,
  VIDEO_RATE_CONTROL_OPTIONS,
  type AudioTrack,
  type StreamProject,
  type StreamServiceSettings,
  type VideoEncoderFamily,
} from '../../shared/desktop-api';

export interface StreamDialogProps {
  project: StreamProject;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  platform: StreamPlatform;
  working: boolean;
  settings: StreamServiceSettings;
  onChangeSettings: (next: StreamServiceSettings) => void;
  videoEncoderOptions: ReadonlyArray<{ value: VideoEncoderFamily; label: string }>;
  systemVideoEncoder: VideoEncoderFamily | null;
  onSubmit: () => void;
  onClose: () => void;
}

export function StreamDialog({ project, setProjectValue, platform, working, settings, onChangeSettings, videoEncoderOptions, systemVideoEncoder, onSubmit, onClose }: StreamDialogProps) {
  const formId = useId();
  const preset = getStreamService(settings.service);
  const validationMessage = validateStreamServiceSettings(settings);

  function update(patch: Partial<StreamServiceSettings>): void {
    onChangeSettings({ ...settings, ...patch });
  }

  function updateOutput(patch: Partial<StreamProject['output']>): void {
    setProjectValue((current) => ({ ...current, output: { ...current.output, ...patch } }));
  }

  function updateService(service: StreamServiceId): void {
    const nextPreset = getStreamService(service);
    onChangeSettings({ ...settings, service, serverId: nextPreset.servers[0]?.id ?? '' });
  }

  return (
    <Modal
      open
      title="Stream settings"
      className="stream-modal"
      onClose={onClose}
      closeDisabled={working}
      footer={<>
        <span className="stream-footer-note">{project.output.width} × {project.output.height} · {project.output.frameRate} FPS</span>
        <ReacstButton size="sm" disabled={working} onClick={onClose}>Cancel</ReacstButton>
        <ReacstButton size="sm" variant="primary" type="submit" form={formId} disabled={working || validationMessage !== null}>{working ? 'Connecting…' : 'Start Streaming'}</ReacstButton>
      </>}
    >
        <form id={formId} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields">
            <Select label="Service" value={settings.service} onValueChange={updateService} options={STREAM_SERVICES.map((service) => ({ value: service.id, label: service.label }))} />
            {preset.servers.length > 0 && <Select label="Server" value={settings.serverId} onValueChange={(serverId) => update({ serverId })} options={preset.servers.map((server) => ({ value: server.id, label: server.label }))} />}
            <StreamKeyField label={preset.keyLabel} value={settings.streamKey} onValueChange={(streamKey) => update({ streamKey })} />
            {settings.service === 'custom' && <TextField label="Server URL" placeholder="RTMP(S) URL, srt://host:port, or rist://host:port" value={settings.customServer} onValueChange={(customServer) => update({ customServer })} />}
            {validationMessage && <Banner tone="error" size="sm">{validationMessage}</Banner>}
            <div className="stream-bitrate-grid">
              <NumberField label="Video bitrate" suffix="kb/s" min={250} max={50000} step={250} disabled={project.output.streamRateControl === 'quality'} value={project.output.streamVideoBitrateKbps} onValueChange={(value) => updateOutput({ streamVideoBitrateKbps: Math.round(value) })} />
              <NumberField label="Audio bitrate" suffix="kb/s" min={32} max={320} step={16} value={project.output.streamAudioBitrateKbps} onValueChange={(value) => updateOutput({ streamAudioBitrateKbps: Math.round(value) })} />
            </div>
            <Select label="Audio track" value={String(project.output.streamAudioTrack)} onValueChange={(value) => updateOutput({ streamAudioTrack: Number(value) as AudioTrack })} options={AUDIO_TRACKS.map((track) => ({ value: String(track), label: `Track ${track}` }))} />
            <Select
              label="Video encoder"
              value={project.output.streamVideoEncoder}
              onValueChange={(encoder) => setProjectValue((current) => ({ ...current, output: {
                ...current.output,
                streamVideoEncoder: encoder,
                streamRateControl: normalizeVideoRateControl(encoder, current.output.streamRateControl),
              } }))}
              options={videoEncoderOptions}
            />
            <Select
              label="Rate control"
              value={project.output.streamRateControl}
              onValueChange={(streamRateControl) => updateOutput({ streamRateControl })}
              options={VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(project.output.streamVideoEncoder).includes(option.value))}
            />
            <Slider label="Encoder quality" showValue min={0} max={100} disabled={project.output.streamVideoEncoder === 'libopenh264'} value={project.output.streamEncoderQuality} onValueChange={(streamEncoderQuality) => updateOutput({ streamEncoderQuality })} />
            <NumberField label="Keyframe interval" suffix="s" min={1} max={10} step={1} value={project.output.streamKeyframeIntervalSeconds} onValueChange={(value) => updateOutput({ streamKeyframeIntervalSeconds: Math.round(value) })} />
            <Checkbox label={hardwareEncodingLabelForPlatform(platform)} checked={project.output.streamHardwareEncoding} disabled={project.output.streamVideoEncoder !== systemVideoEncoder} onCheckedChange={(streamHardwareEncoding) => updateOutput({ streamHardwareEncoding })} />
          </div>
        </form>
    </Modal>
  );
}
