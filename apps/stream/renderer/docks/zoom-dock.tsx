/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ellipsis, RefreshCw, Video, X } from 'lucide-react';
import { Banner, EmptyState, Panel, ReacstButton, Select, StatusDot, type StatusTone } from '@lumacast/ui';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, ZoomAccount, ZoomMeeting } from '../../shared/desktop-api';
import { providerErrorMessage } from '../features/shared/provider-error';
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

function ZoomNotice({ title, description, children, tone = 'info' }: {
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: 'info' | 'warning' | 'error';
}) {
  return <EmptyState.Root className="zoom-panel-notice" data-tone={tone}>
    <EmptyState.Title>{title}</EmptyState.Title>
    {description && <EmptyState.Description>{description}</EmptyState.Description>}
    {children && <EmptyState.Action className="zoom-panel-notice__actions">{children}</EmptyState.Action>}
  </EmptyState.Root>;
}

function displayTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Time not set';
}

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
        if (mounted.current && id === requestId.current) {
          setMeetingsError(providerErrorMessage('Zoom', error, 'Could not load Zoom meetings. Try again.'));
        }
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    }).catch((error) => {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not check your Zoom account. Try again.'));
        setAccountLoading(false);
      }
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
  const selectedMeetingIsStale = Boolean(account && !outputActive && settings.zoom.selectedMeetingId && !selectedMeeting && !loading && !meetingsError);
  const locked = outputActive || accountBusy || loading || accountLoading;
  const canStart = Boolean(account && selectedMeeting && !locked);
  const visibleMeeting = outputActive ? retainedMeeting : selectedMeeting;
  const safeStatusMessage = status.state === 'error'
    ? providerErrorMessage('Zoom', status.message, 'Zoom output could not start. Check the meeting and try again.')
    : '';

  function updateZoom(patch: Partial<StreamServiceSettings['zoom']>): void {
    onChange({ ...settings, zoom: { ...settings.zoom, ...patch } });
  }

  async function retryAccountCheck(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(true);
    setAccountError('');
    setMeetingsError('');
    try {
      const connected = await api.getZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(connected);
      if (!connected) {
        setMeetings([]);
        updateZoom({ selectedMeetingId: '' });
        return;
      }
      setLoading(true);
      try {
        const next = await api.listZoomMeetings();
        if (mounted.current && id === requestId.current) setMeetings(next);
      } catch (error) {
        if (mounted.current && id === requestId.current) {
          setMeetingsError(providerErrorMessage('Zoom', error, 'Could not load Zoom meetings. Try again.'));
        }
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not check your Zoom account. Try again.'));
      }
    } finally {
      if (mounted.current && id === requestId.current) setAccountLoading(false);
    }
  }

  const refreshMeetings = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setMeetingsError('');
    try {
      const next = await api.listZoomMeetings();
      if (mounted.current && id === requestId.current) setMeetings(next);
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setMeetingsError(providerErrorMessage('Zoom', error, 'Could not load Zoom meetings. Try again.'));
      }
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [api]);

  async function connectAccount(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(false);
    setLoading(false);
    setAccountBusy(true);
    setAccountError('');
    setMeetingsError('');
    try {
      const connected = await api.connectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(connected);
      setLoading(true);
      try {
        const next = await api.listZoomMeetings();
        if (mounted.current && id === requestId.current) setMeetings(next);
      } catch (error) {
        if (mounted.current && id === requestId.current) {
          setMeetingsError(providerErrorMessage('Zoom', error, 'Could not load Zoom meetings. Try again.'));
        }
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not connect Zoom. Try again.'));
      }
    } finally {
      if (mounted.current && id === requestId.current) setAccountBusy(false);
    }
  }

  async function disconnectAccount(): Promise<void> {
    const id = ++requestId.current;
    setAccountLoading(false);
    setLoading(false);
    setAccountBusy(true);
    setAccountError('');
    try {
      await api.disconnectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      setAccount(null);
      setMeetings([]);
      updateZoom({ selectedMeetingId: '' });
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not disconnect Zoom. Try again.'));
      }
    } finally {
      if (mounted.current && id === requestId.current) setAccountBusy(false);
    }
  }

  async function createMeeting(draft: StreamServiceSettings['zoom']): Promise<void> {
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await api.createZoomMeeting(draft);
      if (!mounted.current) return;
      setMeetings((previous) => [created, ...previous.filter((meeting) => meeting.id !== created.id)]);
      updateZoom({ topic: draft.topic, startTime: draft.startTime, durationMinutes: draft.durationMinutes, selectedMeetingId: created.id });
      setCreateOpen(false);
    } catch (error) {
      if (mounted.current) setCreateError(providerErrorMessage('Zoom', error, 'Could not create the Zoom meeting. Check the details and try again.'));
    } finally {
      if (mounted.current) setCreateBusy(false);
    }
  }

  const outputStateLabel = status.state === 'live' ? 'Live' : status.state === 'connecting' ? 'Connecting' : status.state === 'error' ? 'Error' : 'Offline';

  return <Panel density="compact" className="dock zoom-dock" style={style}>
    {resizer}
    <Panel.Header data-dock-handle className="cursor-grab select-none">
      <Panel.HeaderTitle>Zoom</Panel.HeaderTitle>
      <Panel.HeaderActions>
        {account && !outputActive && <ReacstButton.Icon variant="ghost" size="sm" label="Refresh meetings" disabled={loading || accountBusy || accountLoading} onClick={() => void refreshMeetings()}><RefreshCw /></ReacstButton.Icon>}
        <ReacstButton.Icon variant="ghost" size="sm" label="Zoom settings" onClick={() => { setAccountError(''); setSettingsOpen(true); }}><Ellipsis /></ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" size="sm" label="Hide Zoom" onClick={onHide}><X /></ReacstButton.Icon>
      </Panel.HeaderActions>
    </Panel.Header>

    <div className="zoom-provider-row">
      <span className="zoom-provider-mark" aria-hidden="true"><Video /></span>
      <span className="zoom-provider-wordmark">zoom</span>
      {account && <span className="zoom-provider-account" title={account.email || account.displayName}>{account.email || account.displayName}</span>}
    </div>

    <div className="zoom-dock-body">
      {status.state === 'error' && <Banner tone="error" size="sm">{safeStatusMessage}</Banner>}

      {accountLoading ? <ZoomNotice title="Checking Zoom…" description="Loading your account and scheduled meetings." />
        : accountError && !account ? <ZoomNotice title="Could not check Zoom" description={accountError} tone="error">
          <ReacstButton size="sm" onClick={() => void retryAccountCheck()}>Try again</ReacstButton>
        </ZoomNotice>
          : !account ? <ZoomNotice title="Connect Zoom" description="Connect your account to choose a scheduled meeting.">
            <ReacstButton size="sm" variant="default" onClick={() => { setAccountError(''); setSettingsOpen(true); }}>Connect Zoom</ReacstButton>
          </ZoomNotice>
            : <>
              {accountError && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" onClick={() => void retryAccountCheck()}>Retry</ReacstButton>}>{accountError}</Banner>}
              {meetingsError && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" disabled={locked} onClick={() => void refreshMeetings()}>Retry</ReacstButton>}>Could not load meetings: {meetingsError}</Banner>}

              {loading && meetings.length === 0 ? <ZoomNotice title="Loading meetings…" description="Fetching scheduled Zoom meetings." />
                : meetings.length === 0 && !meetingsError ? <ZoomNotice title="No scheduled meetings" description="Create a meeting to use Zoom output.">
                  <ReacstButton size="sm" variant="default" disabled={locked} onClick={() => { setCreateError(''); setCreateOpen(true); }}>New meeting</ReacstButton>
                </ZoomNotice>
                  : <>
                    {meetings.length > 0 && <Select size="sm" label="Scheduled meeting" value={settings.zoom.selectedMeetingId} disabled={locked} onValueChange={(value) => updateZoom({ selectedMeetingId: value })} options={[{ value: '', label: 'Select a meeting' }, ...meetings.map((meeting) => ({ value: meeting.id, label: `${meeting.topic} · ${displayTime(meeting.startTime)}` }))]} />}
                    {visibleMeeting && <div className="zoom-meeting-summary">
                      {outputActive && <span className="zoom-meeting-summary__eyebrow">Output meeting</span>}
                      <strong>{visibleMeeting.topic}</strong>
                      <span>{displayTime(visibleMeeting.startTime)} · {visibleMeeting.durationMinutes} min</span>
                    </div>}
                    {selectedMeetingIsStale && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" disabled={locked} onClick={() => void refreshMeetings()}>Refresh</ReacstButton>}>The selected meeting is unavailable. Choose another meeting or refresh the list.</Banner>}
                    {meetings.length > 0 && <ReacstButton size="sm" variant="default" disabled={locked} onClick={() => { setCreateError(''); setCreateOpen(true); }}>New meeting</ReacstButton>}
                  </>}
            </>}
      {outputActive && !account && retainedMeeting && <div className="zoom-meeting-summary">
        <span className="zoom-meeting-summary__eyebrow">Output meeting</span>
        <strong>{retainedMeeting.topic}</strong>
        <span>{displayTime(retainedMeeting.startTime)} · {retainedMeeting.durationMinutes} min</span>
      </div>}
    </div>

    <div className="zoom-dock-footer">
      <div className="zoom-footer-row">
        <div className="zoom-status-row" role="group" aria-label={`Zoom output ${status.state}`}>
          <StatusDot tone={STATUS_TONES[status.state]} />
          <span className="zoom-status-text" role="status" aria-live="polite" aria-atomic="true">{outputStateLabel}</span>
        </div>
        {outputActive
          ? <ReacstButton variant={status.state === 'live' ? 'danger' : 'default'} className="zoom-footer-action" aria-label={status.state === 'live' ? 'Stop Zoom output' : 'Cancel Zoom output'} onClick={onStopStreaming}>{status.state === 'live' ? 'Stop output' : 'Cancel'}</ReacstButton>
          : canStart && <ReacstButton variant="success" className="zoom-footer-action" aria-label={status.state === 'error' ? 'Try Zoom output again' : 'Start Zoom output'} onClick={onGoLive}>{status.state === 'error' ? 'Try again' : 'Start output'}</ReacstButton>}
      </div>
    </div>

    <ZoomSettingsDialog open={settingsOpen} account={account} busy={accountBusy} readOnly={outputActive} error={accountError} onConnect={() => void connectAccount()} onDisconnect={() => void disconnectAccount()} onClose={() => setSettingsOpen(false)} />
    <CreateZoomMeetingDialog open={createOpen} initialDraft={settings.zoom} busy={createBusy} error={createError} onClose={() => setCreateOpen(false)} onSubmit={(draft) => void createMeeting(draft)} />
  </Panel>;
}
