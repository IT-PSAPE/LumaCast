/// <reference types="vite/client" />
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ClipboardPaste, ExternalLink, Eye, EyeOff, Radio, Square, X } from 'lucide-react';
import { ReacstButton, Select } from '@lumacast/ui';
import type { StreamRuntimeStatus, StreamServiceSettings, YouTubePrivacy } from '../../shared/desktop-api';
import { getStreamService, validateStreamServiceSettings } from '../../shared/stream-services';
import { formatElapsed } from '../format-elapsed';
import './youtube-dock.css';

export interface YouTubeDockProps {
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  status: StreamRuntimeStatus;
  streamingStartedAt: number | null;
  now: number;
  working: boolean;
  onGoLive(): void;
  onStopStreaming(): void;
  onOpenDashboard(): void;
  onHide(): void;
  style?: CSSProperties;
  resizer?: ReactNode;
}

const PRIVACY_OPTIONS: ReadonlyArray<{ value: YouTubePrivacy; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

export function YouTubeDock({ settings, onChange, status, streamingStartedAt, now, working, onGoLive, onStopStreaming, onOpenDashboard, onHide, style, resizer }: YouTubeDockProps) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);

  const youtubePreset = getStreamService('youtube');
  const servers = youtubePreset.servers;
  const youtubeSettings: StreamServiceSettings = settings.service === 'youtube' ? settings : { ...settings, service: 'youtube' };
  const validationMessage = validateStreamServiceSettings(youtubeSettings);
  const sessionActive = streamingStartedAt !== null;
  const canGoLive = !sessionActive && !working && validationMessage === null;

  function update(patch: Partial<StreamServiceSettings>): void {
    onChange({ ...settings, service: 'youtube', ...patch });
  }

  function updateDraft(patch: Partial<StreamServiceSettings['youtube']>): void {
    update({ youtube: { ...settings.youtube, ...patch } });
  }

  async function pasteStreamKey(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      setPasteFailed(false);
      update({ streamKey: text.slice(0, 512) });
    } catch {
      setPasteFailed(true);
    }
  }

  return (
    <section className="dock youtube-dock" style={style}>
      {resizer}
      <div className="dock-title"><span>YouTube Live Control Panel</span><button className="mini-icon" aria-label="Hide YouTube Live Control Panel" onClick={onHide}><X size={14} /></button></div>
      <div className="youtube-dock-body">
        <label className="youtube-field">
          <span>Title</span>
          <input
            type="text"
            maxLength={100}
            value={settings.youtube.title}
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
        </label>
        <label className="youtube-field">
          <span>Description</span>
          <textarea
            rows={3}
            maxLength={5000}
            value={settings.youtube.description}
            onChange={(event) => updateDraft({ description: event.target.value })}
          />
        </label>
        <label className="youtube-field">
          <span>Privacy</span>
          <Select
            label="Broadcast privacy"
            size="sm"
            value={settings.youtube.privacy}
            onValueChange={(value) => updateDraft({ privacy: value })}
            options={PRIVACY_OPTIONS}
          />
        </label>
        <label className="youtube-field">
          <span>Server</span>
          <Select
            label="Ingest server"
            size="sm"
            value={settings.serverId}
            onValueChange={(value) => update({ serverId: value })}
            options={servers.map((server) => ({ value: server.id, label: server.label }))}
          />
        </label>
        <label className="youtube-field">
          <span>{youtubePreset.keyLabel}</span>
          <div className="youtube-key-row">
            <input
              type={keyVisible ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={512}
              value={settings.streamKey}
              onChange={(event) => { setPasteFailed(false); update({ streamKey: event.target.value }); }}
            />
            <button
              type="button"
              className="mini-icon"
              aria-label={keyVisible ? 'Hide stream key' : 'Show stream key'}
              onClick={() => setKeyVisible((visible) => !visible)}
            >
              {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button" className="mini-icon" aria-label="Paste stream key" onClick={() => void pasteStreamKey()}>
              <ClipboardPaste size={14} />
            </button>
          </div>
          {!sessionActive && validationMessage && <span className="youtube-field-error" role="alert">{validationMessage}</span>}
          {pasteFailed && <span className="youtube-field-error" role="alert">Clipboard access was denied.</span>}
        </label>
      </div>
      <div className="youtube-status-row">
        <span className={`youtube-status-dot ${status.state}`} />
        <span className="youtube-status-text">
          {status.state === 'live' ? 'Live' : status.state === 'connecting' ? 'Connecting…' : status.state === 'error' ? (status.message ?? 'Stream error') : 'Offline'}
        </span>
        {status.state === 'live' && <span className="youtube-elapsed">{formatElapsed(now - (streamingStartedAt ?? now))}</span>}
        {status.state === 'live' && <span className="youtube-bitrate">{status.bitrateKbps ?? 0} kb/s</span>}
      </div>
      <div className="youtube-dock-footer">
        <ReacstButton variant="ghost" onClick={onOpenDashboard}><ExternalLink size={13} />Open YouTube Studio</ReacstButton>
        {sessionActive
          ? <ReacstButton variant="danger" disabled={working} onClick={onStopStreaming}><Square size={11} fill="currentColor" />End Stream</ReacstButton>
          : <ReacstButton variant="take" disabled={!canGoLive} onClick={onGoLive}><Radio size={13} />{status.state === 'connecting' ? 'Connecting…' : 'Go Live'}</ReacstButton>}
      </div>
    </section>
  );
}
