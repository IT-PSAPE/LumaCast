import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
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
  const [keyVisible, setKeyVisible] = useState(false);
  const preset = getStreamService(settings.service);
  const validationMessage = validateStreamServiceSettings(settings);

  function update(patch: Partial<StreamServiceSettings>): void {
    onChangeSettings({ ...settings, ...patch });
  }

  function updateService(service: StreamServiceId): void {
    const nextPreset = getStreamService(service);
    onChangeSettings({ ...settings, service, serverId: nextPreset.servers[0]?.id ?? '' });
  }

  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="capture-modal stream-modal" role="dialog" aria-modal="true" aria-labelledby="stream-title">
        <div className="modal-heading"><h2 id="stream-title">Stream settings</h2><button className="icon-button" aria-label="Close" disabled={working} onClick={onClose}><X size={17} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields">
            <label>Service<select value={settings.service} onChange={(event) => updateService(event.target.value as StreamServiceId)}>{STREAM_SERVICES.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label>
            {preset.servers.length > 0 && <label>Server<select value={settings.serverId} onChange={(event) => update({ serverId: event.target.value })}>{preset.servers.map((server) => <option key={server.id} value={server.id}>{server.label}</option>)}</select></label>}
            <label>{preset.keyLabel}
              <div className="stream-key-row">
                <input
                  type={keyVisible ? 'text' : 'password'}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={512}
                  value={settings.streamKey}
                  onChange={(event) => update({ streamKey: event.target.value })}
                />
                <button type="button" className="mini-icon" aria-label={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={() => setKeyVisible((visible) => !visible)}>{keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </label>
            {settings.service === 'custom' && <label>Server URL<input autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="RTMP(S) URL, srt://host:port, or rist://host:port" value={settings.customServer} onChange={(event) => update({ customServer: event.target.value })} required /></label>}
            {validationMessage && <span className="stream-field-error" role="alert">{validationMessage}</span>}
            <div className="stream-bitrate-grid">
              <label>Video bitrate<input type="number" min="250" max="50000" step="250" disabled={project.output.streamRateControl === 'quality'} value={project.output.streamVideoBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamVideoBitrateKbps: Math.max(250, Math.min(50000, Math.round(Number(event.target.value) || 250))) } }))} required /><span>kb/s</span></label>
              <label>Audio bitrate<input type="number" min="32" max="320" step="16" value={project.output.streamAudioBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamAudioBitrateKbps: Math.max(32, Math.min(320, Math.round(Number(event.target.value) || 32))) } }))} required /><span>kb/s</span></label>
            </div>
            <label>Audio track<select value={project.output.streamAudioTrack} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamAudioTrack: Number(event.target.value) as AudioTrack } }))}>{AUDIO_TRACKS.map((track) => <option key={track} value={track}>Track {track}</option>)}</select></label>
            <label>Video encoder<select value={project.output.streamVideoEncoder} onChange={(event) => {
              const encoder = event.target.value as VideoEncoderFamily;
              setProjectValue((current) => ({ ...current, output: {
                ...current.output,
                streamVideoEncoder: encoder,
                streamRateControl: normalizeVideoRateControl(encoder, current.output.streamRateControl),
              } }));
            }}>{videoEncoderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Rate control<select value={project.output.streamRateControl} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamRateControl: event.target.value as StreamProject['output']['streamRateControl'] } }))}>{VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(project.output.streamVideoEncoder).includes(option.value)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Encoder quality<input className="encoder-range" type="range" min="0" max="100" disabled={project.output.streamVideoEncoder === 'libopenh264'} value={project.output.streamEncoderQuality} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamEncoderQuality: Number(event.target.value) } }))} /><span className="range-value">{project.output.streamEncoderQuality}</span></label>
            <label>Keyframe interval (seconds)<input type="number" min="1" max="10" step="1" value={project.output.streamKeyframeIntervalSeconds} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamKeyframeIntervalSeconds: Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 1))) } }))} /></label>
            <label className="encoder-toggle"><input type="checkbox" checked={project.output.streamHardwareEncoding} disabled={project.output.streamVideoEncoder !== systemVideoEncoder} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamHardwareEncoding: event.target.checked } }))} /><span>{hardwareEncodingLabelForPlatform(platform)}</span></label>
          </div>
          <div className="modal-footer"><span>{project.output.width} × {project.output.height} · {project.output.frameRate} FPS</span><button className="secondary-button" type="button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={working || validationMessage !== null}>{working ? 'Connecting…' : 'Start Streaming'}</button></div>
        </form>
      </section>
    </div>
  );
}
