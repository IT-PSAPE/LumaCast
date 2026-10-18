/// <reference types="vite/client" />
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, ZoomAccount, ZoomMeeting } from '../../shared/desktop-api';
import { friendlyError } from '../features/shared/friendly-error';
import './zoom-dock.css';

export interface ZoomDockProps {
  api: StreamAPI;
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  status: StreamRuntimeStatus;
  onGoLive(): void;
  onStopStreaming(): void;
  onHide(): void;
  style?: CSSProperties;
  resizer?: ReactNode;
}

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ZoomDock({ api, settings, onChange, status, onGoLive, onStopStreaming, onHide, style, resizer }: ZoomDockProps) {
  const [account, setAccount] = useState<ZoomAccount | null>(null);
  const [meetings, setMeetings] = useState<ZoomMeeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [defaultStartTime] = useState(() => new Date(Date.now() + 10 * 60 * 1000).toISOString());

  useEffect(() => {
    let active = true;
    void api.getZoomAccount().then(async (connected) => {
      if (!active) return;
      setAccount(connected);
      if (!connected) return;
      setLoading(true);
      try { setMeetings(await api.listZoomMeetings()); }
      catch (error) { if (active) setIntegrationError(friendlyError(error)); }
      finally { if (active) setLoading(false); }
    }).catch((error) => { if (active) setIntegrationError(friendlyError(error)); });
    return () => { active = false; };
  }, [api]);

  const selectedMeetingId = settings.zoom.selectedMeetingId;
  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId);
  const startTime = settings.zoom.startTime || defaultStartTime;

  function updateZoom(patch: Partial<StreamServiceSettings['zoom']>): void {
    onChange({ ...settings, zoom: { ...settings.zoom, ...patch } });
  }

  async function refreshMeetings(): Promise<void> {
    setLoading(true);
    setIntegrationError('');
    try { setMeetings(await api.listZoomMeetings()); }
    catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setLoading(false); }
  }

  async function connectAccount(): Promise<void> {
    setAccountBusy(true);
    setIntegrationError('');
    try {
      setAccount(await api.connectZoomAccount());
      setMeetings(await api.listZoomMeetings());
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setAccountBusy(false); }
  }

  async function disconnectAccount(): Promise<void> {
    setAccountBusy(true);
    setIntegrationError('');
    try {
      await api.disconnectZoomAccount();
      setAccount(null);
      setMeetings([]);
      updateZoom({ selectedMeetingId: '' });
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setAccountBusy(false); }
  }

  async function createMeeting(): Promise<void> {
    setCreateBusy(true);
    setIntegrationError('');
    try {
      const created = await api.createZoomMeeting({ ...settings.zoom, startTime });
      setMeetings((previous) => [created, ...previous.filter((meeting) => meeting.id !== created.id)]);
      updateZoom({ selectedMeetingId: created.id });
    } catch (error) { setIntegrationError(friendlyError(error)); }
    finally { setCreateBusy(false); }
  }

  return (
    <section className="dock zoom-dock" style={style}>
      {resizer}
      <div className="dock-title"><span>Zoom Meeting Control Panel</span><button className="mini-icon" aria-label="Hide Zoom Meeting Control Panel" onClick={onHide}><X size={14} /></button></div>
      <div className="zoom-dock-body">
        <div className="zoom-account-row">
          <div className="zoom-account-copy">
            <span className="zoom-account-label">Zoom account</span>
            <span className="zoom-account-name">{account ? (account.email ? `${account.displayName} · ${account.email}` : account.displayName) : 'Not connected'}</span>
          </div>
          {account
            ? <>
              <button type="button" className="mini-icon" aria-label="Refresh scheduled meetings" disabled={loading} onClick={() => void refreshMeetings()}><RefreshCw size={13} /></button>
              <button type="button" className="secondary-button" disabled={accountBusy} onClick={() => void disconnectAccount()}>Disconnect</button>
            </>
            : <button type="button" className="secondary-button" disabled={accountBusy} onClick={() => void connectAccount()}>{accountBusy ? 'Connecting…' : 'Connect Zoom'}</button>}
        </div>

        {account ? <>
          <label className="zoom-field">
            <span>Scheduled meeting</span>
            <select value={selectedMeetingId} disabled={loading} onChange={(event) => updateZoom({ selectedMeetingId: event.target.value })}>
              <option value="">Select a meeting</option>
              {meetings.map((meeting) => (
                <option key={meeting.id} value={meeting.id}>
                  {meeting.topic} · {Number.isFinite(Date.parse(meeting.startTime)) ? new Date(meeting.startTime).toLocaleString() : 'Time not set'}
                </option>
              ))}
            </select>
          </label>
          {meetings.length === 0 && !loading && <p className="zoom-empty">No upcoming scheduled meetings. Create one below.</p>}
          {selectedMeeting && <p className="zoom-meeting-meta">{selectedMeeting.durationMinutes} min · {selectedMeeting.status}</p>}
          <div className="zoom-create-heading">Create a meeting</div>
          <label className="zoom-field">
            <span>Meeting name</span>
            <input type="text" maxLength={200} value={settings.zoom.topic} onChange={(event) => updateZoom({ topic: event.target.value })} />
          </label>
          <label className="zoom-field">
            <span>Scheduled start</span>
            <input type="datetime-local" value={toLocalDateTimeValue(startTime)} onChange={(event) => {
              const timestamp = Date.parse(event.target.value);
              updateZoom({ startTime: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '' });
            }} />
          </label>
          <label className="zoom-field">
            <span>Duration (minutes)</span>
            <input type="number" min={1} max={1440} step={1} value={settings.zoom.durationMinutes} onChange={(event) => updateZoom({ durationMinutes: Number(event.target.value) })} />
          </label>
          <button
            type="button"
            className="secondary-button zoom-create-button"
            disabled={createBusy || !settings.zoom.topic.trim() || !Number.isFinite(Date.parse(startTime)) || Date.parse(startTime) < Date.now() - 60_000 || !Number.isInteger(settings.zoom.durationMinutes) || settings.zoom.durationMinutes < 1 || settings.zoom.durationMinutes > 1440}
            onClick={() => void createMeeting()}
          >{createBusy ? 'Creating…' : 'Create meeting'}</button>
        </> : <p className="zoom-empty">Connect a Zoom account to select scheduled meetings and create new ones here.</p>}
        {integrationError && <p className="zoom-error" role="alert">{integrationError}</p>}
      </div>
      <div className="zoom-status-row">
        <span className={`zoom-status-dot ${status.state}`} />
        <span>{status.state === 'live' ? 'Sending to Zoom' : status.state === 'connecting' ? (status.message ?? 'Joining…') : status.state === 'error' ? (status.message ?? 'Meeting error') : 'Not in a meeting'}</span>
      </div>
      {account && selectedMeeting && <div className="zoom-live-controls">
        <button
          type="button"
          className={status.state === 'live' || status.state === 'connecting' ? 'secondary-button' : 'primary-button'}
          disabled={!selectedMeetingId || !account}
          onClick={status.state === 'live' || status.state === 'connecting' ? onStopStreaming : onGoLive}
        >{status.state === 'live' ? 'Stop Zoom output' : status.state === 'connecting' ? 'Cancel Zoom output' : 'Start Zoom output'}</button>
        <span>Production Studio requires the meeting host or co-host.</span>
      </div>
      }
    </section>
  );
}
