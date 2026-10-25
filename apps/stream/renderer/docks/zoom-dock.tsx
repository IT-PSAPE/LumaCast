/// <reference types="vite/client" />
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Banner, EmptyState, NumberField, ReacstButton, Select, StatusDot, TextField, type StatusTone } from '@lumacast/ui';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, ZoomAccount, ZoomMeeting } from '../../shared/desktop-api';
import { friendlyError } from '../features/shared/friendly-error';
import { DockTitle } from './dock-title';
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

const STATUS_TONES: Record<StreamRuntimeStatus['state'], StatusTone> = { live: 'success', connecting: 'warning', error: 'error', stopped: 'neutral' };

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
      <DockTitle title="Zoom Meeting Control Panel" onHide={onHide} />
      <div className="zoom-dock-body">
        <div className="zoom-account-row">
          <div className="zoom-account-copy">
            <span className="zoom-account-label">Zoom account</span>
            <span className="zoom-account-name">{account ? (account.email ? `${account.displayName} · ${account.email}` : account.displayName) : 'Not connected'}</span>
          </div>
          {account
            ? <>
              <ReacstButton.Icon variant="ghost" size="sm" label="Refresh scheduled meetings" disabled={loading} onClick={() => void refreshMeetings()}><RefreshCw /></ReacstButton.Icon>
              <ReacstButton size="sm" disabled={accountBusy} onClick={() => void disconnectAccount()}>Disconnect</ReacstButton>
            </>
            : <ReacstButton size="sm" disabled={accountBusy} onClick={() => void connectAccount()}>{accountBusy ? 'Connecting…' : 'Connect Zoom'}</ReacstButton>}
        </div>

        {account ? <>
          <Select
            size="sm"
            label="Scheduled meeting"
            value={selectedMeetingId}
            disabled={loading}
            onValueChange={(value) => updateZoom({ selectedMeetingId: value })}
            options={[
              { value: '', label: 'Select a meeting' },
              ...meetings.map((meeting) => ({
                value: meeting.id,
                label: `${meeting.topic} · ${Number.isFinite(Date.parse(meeting.startTime)) ? new Date(meeting.startTime).toLocaleString() : 'Time not set'}`,
              })),
            ]}
          />
          {meetings.length === 0 && !loading && <EmptyState.Root><EmptyState.Description>No upcoming scheduled meetings. Create one below.</EmptyState.Description></EmptyState.Root>}
          {selectedMeeting && <p className="zoom-meeting-meta">{selectedMeeting.durationMinutes} min · {selectedMeeting.status}</p>}
          <div className="zoom-create-heading">Create a meeting</div>
          <TextField size="sm" label="Meeting name" maxLength={200} commitOn="change" value={settings.zoom.topic} onValueChange={(topic) => updateZoom({ topic })} />
          <label className="zoom-field">
            <span>Scheduled start</span>
            <input type="datetime-local" value={toLocalDateTimeValue(startTime)} onChange={(event) => {
              const timestamp = Date.parse(event.target.value);
              updateZoom({ startTime: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '' });
            }} />
          </label>
          <NumberField size="sm" label="Duration" suffix="min" min={1} max={1440} step={1} precision={0} value={settings.zoom.durationMinutes} onValueChange={(durationMinutes) => updateZoom({ durationMinutes })} />
          <ReacstButton
            size="sm"
            className="zoom-create-button"
            disabled={createBusy || !settings.zoom.topic.trim() || !Number.isFinite(Date.parse(startTime)) || Date.parse(startTime) < Date.now() - 60_000 || !Number.isInteger(settings.zoom.durationMinutes) || settings.zoom.durationMinutes < 1 || settings.zoom.durationMinutes > 1440}
            onClick={() => void createMeeting()}
          >{createBusy ? 'Creating…' : 'Create meeting'}</ReacstButton>
        </> : <EmptyState.Root><EmptyState.Description>Connect a Zoom account to select scheduled meetings and create new ones here.</EmptyState.Description></EmptyState.Root>}
        {integrationError && <Banner tone="error" size="sm">{integrationError}</Banner>}
      </div>
      <div className="zoom-status-row">
        <StatusDot tone={STATUS_TONES[status.state]} />
        <span>{status.state === 'live' ? 'Sending to Zoom' : status.state === 'connecting' ? (status.message ?? 'Joining…') : status.state === 'error' ? (status.message ?? 'Meeting error') : 'Not in a meeting'}</span>
      </div>
      {account && selectedMeeting && <div className="zoom-live-controls">
        <ReacstButton
          variant={status.state === 'live' || status.state === 'connecting' ? 'default' : 'primary'}
          disabled={!selectedMeetingId || !account}
          onClick={status.state === 'live' || status.state === 'connecting' ? onStopStreaming : onGoLive}
        >{status.state === 'live' ? 'Stop Zoom output' : status.state === 'connecting' ? 'Cancel Zoom output' : 'Start Zoom output'}</ReacstButton>
        <span>Production Studio requires the meeting host or co-host.</span>
      </div>
      }
    </section>
  );
}
