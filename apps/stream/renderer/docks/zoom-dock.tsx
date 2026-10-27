/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RefreshCw, Settings2, X } from 'lucide-react';
import { Banner, EmptyState, Panel, ReacstButton, Select, StatusDot, type StatusTone } from '@lumacast/ui';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, ZoomAccount, ZoomMeeting } from '../../shared/desktop-api';
import { friendlyError } from '../features/shared/friendly-error';
import { CreateZoomMeetingDialog, ZoomSettingsDialog } from './zoom-dialogs';
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

export function ZoomDock({ api, settings, onChange, status, onGoLive, onStopStreaming, onHide, style, resizer }: ZoomDockProps) {
  const [account, setAccount] = useState<ZoomAccount | null>(null);
  const [meetings, setMeetings] = useState<ZoomMeeting[]>([]);
  const [accountLoading, setAccountLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [meetingsError, setMeetingsError] = useState('');
  const [createError, setCreateError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const outputActive = status.state === 'live' || status.state === 'connecting';
  const [activeMeeting, setActiveMeeting] = useState<ZoomMeeting | null>(null);

  useEffect(() => {
    mounted.current = true;
    const id = ++requestId.current;
    void api.getZoomAccount().then(async (connected) => {
      if (!mounted.current || id !== requestId.current) return;
      setAccount(connected);
      setAccountLoading(false);
      if (!connected) return;
      setLoading(true);
      try {
        const next = await api.listZoomMeetings();
        if (mounted.current && id === requestId.current) setMeetings(next);
      } catch (error) {
        if (mounted.current && id === requestId.current) setMeetingsError(friendlyError(error));
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    }).catch((error) => {
      if (mounted.current && id === requestId.current) { setAccountError(friendlyError(error)); setAccountLoading(false); }
    });
    return () => { mounted.current = false; requestId.current += 1; };
  }, [api]);

  const selectedMeeting = meetings.find((meeting) => meeting.id === settings.zoom.selectedMeetingId) ?? null;
  const previousOutputActive = useRef(false);
  useEffect(() => {
    if (outputActive && (!previousOutputActive.current || !activeMeeting) && selectedMeeting) setActiveMeeting(selectedMeeting);
    if (!outputActive) setActiveMeeting(null);
    previousOutputActive.current = outputActive;
  }, [outputActive, selectedMeeting, activeMeeting]);
  const retainedMeeting = outputActive ? (activeMeeting ?? selectedMeeting) : selectedMeeting;
  const locked = outputActive || accountBusy || loading || accountLoading;

  function updateZoom(patch: Partial<StreamServiceSettings['zoom']>): void {
    onChange({ ...settings, zoom: { ...settings.zoom, ...patch } });
  }

  async function retryAccountCheck(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(true); setAccountError(''); setMeetingsError('');
    try {
      const connected = await api.getZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(connected);
      if (!connected) return;
      setLoading(true);
      try {
        const next = await api.listZoomMeetings();
        if (mounted.current && id === requestId.current) setMeetings(next);
      } catch (error) {
        if (mounted.current && id === requestId.current) setMeetingsError(friendlyError(error));
      } finally { if (mounted.current && id === requestId.current) setLoading(false); }
    } catch (error) {
      if (mounted.current && id === requestId.current) setAccountError(friendlyError(error));
    } finally { if (mounted.current && id === requestId.current) setAccountLoading(false); }
  }

  const refreshMeetings = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setMeetingsError('');
    try {
      const next = await api.listZoomMeetings();
      if (mounted.current && id === requestId.current) setMeetings(next);
    } catch (error) {
      if (mounted.current && id === requestId.current) setMeetingsError(friendlyError(error));
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [api]);

  async function connectAccount(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(false); setLoading(false);
    setAccountBusy(true); setAccountError(''); setMeetingsError('');
    try {
      const connected = await api.connectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(connected);
      setLoading(true);
      try {
        const next = await api.listZoomMeetings();
        if (mounted.current && id === requestId.current) { setMeetings(next); setMeetingsError(''); }
      } catch (error) {
        if (mounted.current && id === requestId.current) setMeetingsError(friendlyError(error));
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) setAccountError(friendlyError(error));
    } finally { if (mounted.current && id === requestId.current) setAccountBusy(false); }
  }

  async function disconnectAccount(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(false); setLoading(false);
    setAccountBusy(true); setAccountError('');
    try {
      await api.disconnectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(null); setMeetings([]); updateZoom({ selectedMeetingId: '' });
    } catch (error) {
      if (mounted.current && id === requestId.current) setAccountError(friendlyError(error));
    } finally { if (mounted.current && id === requestId.current) setAccountBusy(false); }
  }

  async function createMeeting(draft: StreamServiceSettings['zoom']): Promise<void> {
    setCreateBusy(true); setCreateError('');
    try {
      const created = await api.createZoomMeeting(draft);
      if (!mounted.current) return;
      setMeetings((previous) => [created, ...previous.filter((meeting) => meeting.id !== created.id)]);
      updateZoom({ topic: draft.topic, startTime: draft.startTime, durationMinutes: draft.durationMinutes, selectedMeetingId: created.id });
      setCreateOpen(false);
    } catch (error) { if (mounted.current) setCreateError(friendlyError(error)); }
    finally { if (mounted.current) setCreateBusy(false); }
  }

  const statusText = status.state === 'live' ? 'Sending to Zoom' : status.state === 'connecting' ? (status.message ?? 'Joining…') : status.state === 'error' ? (status.message ?? 'Meeting error') : '';
  return <Panel density="compact" className="dock zoom-dock" style={style}>
    {resizer}
    <Panel.Header data-dock-handle className="cursor-grab select-none">
      <Panel.HeaderTitle>Zoom</Panel.HeaderTitle>
      <Panel.HeaderActions>
        {account && <ReacstButton.Icon variant="ghost" size="sm" label="Refresh meetings" disabled={loading || locked} onClick={() => void refreshMeetings()}><RefreshCw /></ReacstButton.Icon>}
        <ReacstButton.Icon variant="ghost" size="sm" label="Zoom settings" onClick={() => setSettingsOpen(true)}><Settings2 /></ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" size="sm" label="Hide Zoom" onClick={onHide}><X /></ReacstButton.Icon>
      </Panel.HeaderActions>
    </Panel.Header>
    <div className="zoom-dock-body">
      {accountLoading ? <div className="zoom-loading" role="status">Loading Zoom…</div> : account ? <>
        {accountError && <Banner tone="error" size="sm">{accountError}</Banner>}
        {meetingsError ? <EmptyState.Root><EmptyState.Title>Couldn’t load meetings</EmptyState.Title><EmptyState.Description>{meetingsError}</EmptyState.Description><EmptyState.Action><ReacstButton size="sm" disabled={locked} onClick={() => void refreshMeetings()}>Retry</ReacstButton></EmptyState.Action></EmptyState.Root> : <>
          {meetings.length === 0 && !loading ? <EmptyState.Root><EmptyState.Title>No scheduled meetings</EmptyState.Title><EmptyState.Description>Create a meeting to use Zoom output.</EmptyState.Description></EmptyState.Root> : <Select size="sm" label="Scheduled meeting" value={settings.zoom.selectedMeetingId} disabled={locked} onValueChange={(value) => updateZoom({ selectedMeetingId: value })} options={[{ value: '', label: 'Select a meeting' }, ...meetings.map((meeting) => ({ value: meeting.id, label: `${meeting.topic} · ${Number.isFinite(Date.parse(meeting.startTime)) ? new Date(meeting.startTime).toLocaleString() : 'Time not set'}` }))]} />}
          {selectedMeeting && <div className="zoom-meeting-summary"><strong>{selectedMeeting.topic}</strong><span>{Number.isFinite(Date.parse(selectedMeeting.startTime)) ? new Date(selectedMeeting.startTime).toLocaleString() : 'Time not set'} · {selectedMeeting.durationMinutes} min</span></div>}
          {!selectedMeeting && settings.zoom.selectedMeetingId && !loading && <p className="zoom-stale-selection">The selected meeting is no longer in the refreshed list.</p>}
        </>}
        <ReacstButton size="sm" variant="default" disabled={locked} onClick={() => { setCreateError(''); setCreateOpen(true); }}>New meeting</ReacstButton>
      </> : accountError ? <EmptyState.Root className="zoom-disconnected"><EmptyState.Title>Couldn’t check Zoom</EmptyState.Title><EmptyState.Description>{accountError}</EmptyState.Description><EmptyState.Action><ReacstButton size="sm" onClick={() => void retryAccountCheck()}>Retry</ReacstButton></EmptyState.Action></EmptyState.Root> : <EmptyState.Root className="zoom-disconnected"><EmptyState.Title>Connect Zoom</EmptyState.Title><EmptyState.Description>Connect your account to choose a scheduled meeting.</EmptyState.Description><EmptyState.Action><ReacstButton size="sm" onClick={() => setSettingsOpen(true)}>Connect Zoom</ReacstButton></EmptyState.Action></EmptyState.Root>}
    </div>
    {(statusText || outputActive) && <div className="zoom-status-row"><StatusDot tone={STATUS_TONES[status.state]} size="md" /><span>{statusText}</span></div>}
    <div className="zoom-live-controls">
      {(outputActive || (account && selectedMeeting)) && <ReacstButton variant={status.state === 'live' ? 'danger' : status.state === 'connecting' ? 'default' : 'success'} disabled={outputActive ? false : locked} onClick={outputActive ? onStopStreaming : onGoLive}>{status.state === 'live' ? 'Stop Zoom output' : status.state === 'connecting' ? 'Cancel Zoom output' : 'Start Zoom output'}</ReacstButton>}
      {!outputActive && account && selectedMeeting && <span>Production Studio requires the meeting host or co-host.</span>}
      {outputActive && retainedMeeting && <span>Output active for {retainedMeeting.topic}</span>}
    </div>
    <ZoomSettingsDialog open={settingsOpen} account={account} busy={accountBusy} readOnly={outputActive} error={accountError} onConnect={() => void connectAccount()} onDisconnect={() => void disconnectAccount()} onClose={() => setSettingsOpen(false)} />
    <CreateZoomMeetingDialog open={createOpen} initialDraft={settings.zoom} busy={createBusy} error={createError} onClose={() => setCreateOpen(false)} onSubmit={(draft) => void createMeeting(draft)} />
  </Panel>;
}
