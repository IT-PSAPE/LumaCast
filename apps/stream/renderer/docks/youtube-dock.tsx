/// <reference types="vite/client" />
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ClipboardPaste, ExternalLink, Eye, EyeOff, Radio, RefreshCw, Square, X } from 'lucide-react';
import { ReacstButton, Select } from '@lumacast/ui';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, YouTubeAccount, YouTubeBroadcast, YouTubePrivacy } from '../../shared/desktop-api';
import { getStreamService, validateStreamServiceSettings } from '../../shared/stream-services';
import { formatElapsed } from '../format-elapsed';
import { friendlyError } from '../features/shared/friendly-error';
import './youtube-dock.css';

export interface YouTubeDockProps {
  api: StreamAPI;
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  status: StreamRuntimeStatus;
  activeOutputs: Array<{ id: string; status: StreamRuntimeStatus }>;
  streamingStartedAt: number | null;
  now: number;
  onGoLive(): void;
  onStopStreaming(outputId?: string): void;
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

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function YouTubeDock({ api, settings, onChange, status, activeOutputs, streamingStartedAt, now, onGoLive, onStopStreaming, onOpenDashboard, onHide, style, resizer }: YouTubeDockProps) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [account, setAccount] = useState<YouTubeAccount | null>(null);
  const [broadcasts, setBroadcasts] = useState<YouTubeBroadcast[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [defaultScheduledStartTime] = useState(() => new Date(Date.now() + 5 * 60 * 1000).toISOString());

  useEffect(() => {
    let active = true;
    void api.getYouTubeAccount().then(async (connectedAccount) => {
      if (!active) return;
      setAccount(connectedAccount);
      if (!connectedAccount) return;
      setBroadcastsLoading(true);
      try { setBroadcasts(await api.listYouTubeBroadcasts()); }
      catch (error) { if (active) setIntegrationError(friendlyError(error)); }
      finally { if (active) setBroadcastsLoading(false); }
    }).catch((error) => { if (active) setIntegrationError(friendlyError(error)); });
    return () => { active = false; };
  }, [api]);

  const youtubePreset = getStreamService('youtube');
  const servers = youtubePreset.servers;
  const youtubeSettings: StreamServiceSettings = settings.service === 'youtube' ? settings : { ...settings, service: 'youtube' };
  const validationMessage = validateStreamServiceSettings(youtubeSettings);
  const selectedOutputActive = activeOutputs.some((output) => output.id === 'youtube');
  const otherActiveOutputs = activeOutputs.filter((output) => output.id !== 'youtube');
  const selectedBroadcast = broadcasts.find((broadcast) => broadcast.id === settings.youtube.broadcastId);
  const scheduledStartTime = settings.youtube.scheduledStartTime || defaultScheduledStartTime;
  const readyToStream = account ? Boolean(selectedBroadcast && selectedBroadcast.status !== 'complete') : validationMessage === null;
  const canGoLive = !selectedOutputActive && status.state !== 'connecting' && readyToStream;

  async function refreshBroadcasts(): Promise<void> {
    setBroadcastsLoading(true);
    setIntegrationError('');
    try { setBroadcasts(await api.listYouTubeBroadcasts()); }
    catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setBroadcastsLoading(false); }
  }

  async function connectAccount(): Promise<void> {
    setAccountBusy(true);
    setIntegrationError('');
    try {
      const connectedAccount = await api.connectYouTubeAccount();
      setAccount(connectedAccount);
      setBroadcasts(await api.listYouTubeBroadcasts());
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setAccountBusy(false); }
  }

  async function disconnectAccount(): Promise<void> {
    setAccountBusy(true);
    setIntegrationError('');
    try {
      await api.disconnectYouTubeAccount();
      setAccount(null);
      setBroadcasts([]);
      updateDraft({ broadcastId: '' });
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setAccountBusy(false); }
  }

  async function createBroadcast(): Promise<void> {
    setCreateBusy(true);
    setIntegrationError('');
    try {
      const created = await api.createYouTubeBroadcast({ ...settings.youtube, scheduledStartTime });
      setBroadcasts((previous) => [created, ...previous.filter((broadcast) => broadcast.id !== created.id)]);
      updateDraft({ broadcastId: created.id });
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setCreateBusy(false); }
  }

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
        <div className="youtube-account-row">
          <div className="youtube-account-copy">
            <span className="youtube-account-label">YouTube account</span>
            <span className="youtube-account-name">{account?.channelTitle ?? 'Not connected'}</span>
          </div>
          {account
            ? <>
              <button type="button" className="mini-icon" aria-label="Refresh scheduled broadcasts" disabled={broadcastsLoading} onClick={() => void refreshBroadcasts()}><RefreshCw size={13} /></button>
              <button type="button" className="secondary-button" disabled={accountBusy} onClick={() => void disconnectAccount()}>Disconnect</button>
            </>
            : <button type="button" className="secondary-button" disabled={accountBusy} onClick={() => void connectAccount()}>{accountBusy ? 'Connecting…' : 'Connect YouTube'}</button>}
        </div>

        {account ? <>
          <label className="youtube-field">
            <span>Scheduled broadcast</span>
            <select value={settings.youtube.broadcastId} disabled={broadcastsLoading || selectedOutputActive} onChange={(event) => updateDraft({ broadcastId: event.target.value })}>
              <option value="">Select a broadcast</option>
              {broadcasts.map((broadcast) => (
                <option key={broadcast.id} value={broadcast.id}>
                  {broadcast.title} · {Number.isFinite(Date.parse(broadcast.scheduledStartTime)) ? new Date(broadcast.scheduledStartTime).toLocaleString() : 'Time not set'}
                </option>
              ))}
            </select>
          </label>
          {broadcasts.length === 0 && !broadcastsLoading && <p className="youtube-empty">No upcoming broadcasts. Create one below.</p>}
          <div className="youtube-create-heading">Create a broadcast</div>
          <label className="youtube-field">
            <span>Title</span>
            <input type="text" maxLength={100} value={settings.youtube.title} onChange={(event) => updateDraft({ title: event.target.value })} />
          </label>
          <label className="youtube-field">
            <span>Description</span>
            <textarea rows={3} maxLength={5000} value={settings.youtube.description} onChange={(event) => updateDraft({ description: event.target.value })} />
          </label>
          <label className="youtube-field">
            <span>Scheduled start</span>
            <input type="datetime-local" value={toLocalDateTimeValue(scheduledStartTime)} onChange={(event) => {
              const timestamp = Date.parse(event.target.value);
              updateDraft({ scheduledStartTime: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '' });
            }} />
          </label>
          <label className="youtube-field">
            <span>Privacy</span>
            <Select label="Broadcast privacy" size="sm" value={settings.youtube.privacy} onValueChange={(value) => updateDraft({ privacy: value })} options={PRIVACY_OPTIONS} />
          </label>
          <button
            type="button"
            className="secondary-button youtube-create-button"
            disabled={createBusy || !settings.youtube.title.trim() || !Number.isFinite(Date.parse(scheduledStartTime)) || Date.parse(scheduledStartTime) < Date.now() - 60_000}
            onClick={() => void createBroadcast()}
          >{createBusy ? 'Creating…' : 'Create broadcast'}</button>
        </> : <>
          <p className="youtube-empty">Connect a YouTube account to select scheduled broadcasts and create new ones here.</p>
          <label className="youtube-field">
            <span>Title</span>
            <input type="text" maxLength={100} value={settings.youtube.title} onChange={(event) => updateDraft({ title: event.target.value })} />
          </label>
          <label className="youtube-field">
            <span>Description</span>
            <textarea rows={3} maxLength={5000} value={settings.youtube.description} onChange={(event) => updateDraft({ description: event.target.value })} />
          </label>
          <label className="youtube-field">
            <span>Privacy</span>
            <Select label="Broadcast privacy" size="sm" value={settings.youtube.privacy} onValueChange={(value) => updateDraft({ privacy: value })} options={PRIVACY_OPTIONS} />
          </label>
          <label className="youtube-field">
            <span>Server</span>
            <Select label="Ingest server" size="sm" value={settings.serverId} onValueChange={(value) => update({ serverId: value })} options={servers.map((server) => ({ value: server.id, label: server.label }))} />
          </label>
          <label className="youtube-field">
            <span>{youtubePreset.keyLabel}</span>
            <div className="youtube-key-row">
              <input type={keyVisible ? 'text' : 'password'} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={512} value={settings.streamKey} onChange={(event) => { setPasteFailed(false); update({ streamKey: event.target.value }); }} />
              <button type="button" className="mini-icon" aria-label={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={() => setKeyVisible((visible) => !visible)}>{keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              <button type="button" className="mini-icon" aria-label="Paste stream key" onClick={() => void pasteStreamKey()}><ClipboardPaste size={14} /></button>
            </div>
            {!selectedOutputActive && validationMessage && <span className="youtube-field-error" role="alert">{validationMessage}</span>}
            {pasteFailed && <span className="youtube-field-error" role="alert">Clipboard access was denied.</span>}
          </label>
        </>}
        {integrationError && <p className="youtube-field-error" role="alert">{integrationError}</p>}
      </div>
      <div className="youtube-status-row">
        <span className={`youtube-status-dot ${status.state}`} />
        <span className="youtube-status-text">
          {status.state === 'live' ? 'Live' : status.state === 'connecting' ? 'Connecting…' : status.state === 'error' ? (status.message ?? 'Stream error') : 'Offline'}
        </span>
        {status.state === 'live' && <span className="youtube-elapsed">{formatElapsed(now - (streamingStartedAt ?? now))}</span>}
        {status.state === 'live' && <span className="youtube-bitrate">{status.bitrateKbps ?? 0} kb/s</span>}
      </div>
      {otherActiveOutputs.length > 0 && <div className="youtube-active-outputs" aria-label="Other active outputs">
        {otherActiveOutputs.map((output) => (
          <div className="youtube-active-output" key={output.id}>
            <span className={`youtube-status-dot ${output.status.state}`} />
            <span className="youtube-active-output-name">{output.id === 'primary' ? 'Output' : output.id}</span>
            <span className="youtube-active-output-status">{output.status.state === 'live' ? 'Live' : output.status.state === 'connecting' ? 'Connecting…' : output.status.state === 'error' ? 'Error' : 'Offline'}</span>
            <button type="button" className="secondary-button" aria-label={`End ${output.id} output`} onClick={() => onStopStreaming(output.id)}>End</button>
          </div>
        ))}
      </div>}
      <div className="youtube-dock-footer">
        <ReacstButton variant="ghost" onClick={onOpenDashboard}><ExternalLink size={13} />Open YouTube Studio</ReacstButton>
        {selectedOutputActive
          ? <ReacstButton variant="danger" onClick={() => onStopStreaming('youtube')}><Square size={11} fill="currentColor" />End Stream</ReacstButton>
          : <ReacstButton variant="take" disabled={!canGoLive} onClick={onGoLive}><Radio size={13} />{status.state === 'connecting' ? 'Connecting…' : 'Go Live'}</ReacstButton>}
      </div>
    </section>
  );
}
