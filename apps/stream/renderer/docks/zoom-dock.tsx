/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { RefreshCw } from 'lucide-react';
import { Banner, EmptyState, Panel, ReacstButton, StatusDot, type MenuEntry, type StatusTone } from '@lumacast/ui';
import type { StreamAPI, StreamRuntimeStatus, StreamServiceSettings, ZoomAccount, ZoomMeeting } from '../../shared/desktop-api';
import { formatElapsed } from '../format-elapsed';
import { providerErrorMessage } from '../shared/provider-error';
import { CreateZoomMeetingDialog, ZoomSettingsDialog } from './zoom-dialogs';
import { DockHeader } from './dock-header';
import calendarIcon from '../assets/zoom/calendar-days.svg';
import zoomWordmark from '../assets/zoom/brand-zoom.svg';
import './zoom-dock.css';

const STATUS_TONES: Record<StreamRuntimeStatus['state'], StatusTone> = { live: 'success', connecting: 'warning', error: 'error', stopped: 'neutral' };
type ZoomMeetingMetadata = Pick<ZoomMeeting, 'id' | 'topic' | 'startTime' | 'durationMinutes'>;

export interface ZoomDockProps {
  api: StreamAPI;
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  status: StreamRuntimeStatus;
  /** Output lifecycle actions live in ControlsDock; retained as optional caller compatibility. */
  onGoLive?(): void;
  onStopStreaming?(): void;
  onOperationStart?(): () => void;
  onHide(): void;
  selectionLocked?: boolean;
  streamingStartedAt?: number | null;
  now?: number;
  style?: CSSProperties;
  resizer?: ReactNode;
}

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

function displayMeetingTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Time not set';
  const date = new Date(timestamp);
  const dateLabel = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const timeLabel = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateLabel} · ${timeLabel}`;
}

function ZoomBrandIcon() {
  return <span className="zoom-brand-icon" aria-hidden="true">
    <img src={zoomWordmark} alt="" width="18.1339" height="4.07512" />
  </span>;
}

function ZoomMeetingRow({ meeting, selected, disabled, rowRef, onSelect }: {
  meeting: ZoomMeeting;
  selected: boolean;
  disabled: boolean;
  rowRef?: Ref<HTMLButtonElement>;
  onSelect(): void;
}) {
  return <button
    ref={rowRef}
    className="zoom-meeting-row"
    type="button"
    disabled={disabled}
    aria-pressed={selected}
    data-selected={selected || undefined}
    onClick={onSelect}
  >
    <span className="zoom-meeting-row__icon" aria-hidden="true"><img src={calendarIcon} alt="" width="16" height="16" /></span>
    <span className="zoom-meeting-row__content">
      <span className="zoom-meeting-row__title">{meeting.topic}</span>
      <span className="zoom-meeting-row__date">{displayMeetingTime(meeting.startTime)} · {meeting.durationMinutes} min</span>
    </span>
  </button>;
}

function ZoomMeetingDetails({ meeting, status, elapsed, canReturn, onReturn }: {
  meeting: ZoomMeetingMetadata;
  status: StreamRuntimeStatus;
  elapsed: string | null;
  canReturn: boolean;
  onReturn(): void;
}) {
  const statusLabel = status.state === 'live'
    ? elapsed ? `Live · ${elapsed}` : 'Live'
    : status.state === 'connecting'
      ? status.connectionPhase === 'joining' ? 'Joining meeting'
        : status.connectionPhase === 'starting-output' ? 'Starting output' : 'Connecting'
      : status.state === 'error' ? 'Error' : 'Waiting for meeting output';

  return <section className="zoom-selected-view" aria-label="Selected Zoom meeting">
    <div className="zoom-meeting-details">
      <div className="zoom-meeting-details__title">
        <span className="zoom-meeting-details__icon" aria-hidden="true"><img src={calendarIcon} alt="" width="16" height="16" /></span>
        <strong title={meeting.topic}>{meeting.topic}</strong>
      </div>
      <div className="zoom-meeting-details__status" role="status" aria-live="polite" aria-atomic="true">
        <StatusDot tone={STATUS_TONES[status.state]} />
        <span>{statusLabel}</span>
      </div>
      <div className="zoom-meeting-metrics">
        <div className="zoom-meeting-metric">
          <span className="zoom-meeting-metric__label">Meeting ID</span>
          <span className="zoom-meeting-metric__value" title={meeting.id}>{meeting.id}</span>
        </div>
        <div className="zoom-meeting-metric">
          <span className="zoom-meeting-metric__label">Scheduled duration</span>
          <span className="zoom-meeting-metric__value">{meeting.durationMinutes} min</span>
        </div>
      </div>
      <div className="zoom-meeting-schedule">{displayMeetingTime(meeting.startTime)}</div>
    </div>
    {canReturn && <div className="zoom-selected-actions">
      <ReacstButton className="zoom-return-button" size="sm" variant="default" onClick={onReturn}>Return</ReacstButton>
    </div>}
  </section>;
}

export function ZoomDock({
  api,
  settings,
  onChange,
  status,
  onHide,
  onOperationStart,
  selectionLocked = false,
  streamingStartedAt = null,
  now = Date.now(),
  style,
  resizer,
}: ZoomDockProps) {
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
  const [detailsMeetingId, setDetailsMeetingId] = useState(settings.zoom.selectedMeetingId);
  const [selectedMeetingMetadata, setSelectedMeetingMetadata] = useState<ZoomMeetingMetadata | null>(() => settings.zoom.selectedMeetingId ? {
    id: settings.zoom.selectedMeetingId,
    topic: settings.zoom.topic,
    startTime: settings.zoom.startTime,
    durationMinutes: settings.zoom.durationMinutes,
  } : null);
  const [activeMeeting, setActiveMeeting] = useState<ZoomMeetingMetadata | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const firstMeetingRow = useRef<HTMLButtonElement>(null);
  const returnFocusPending = useRef(false);
  const outputActive = status.state === 'live' || status.state === 'connecting';
  const meetingChangesLocked = outputActive || selectionLocked;
  const meetingChangesLockedRef = useRef(meetingChangesLocked);
  meetingChangesLockedRef.current = meetingChangesLocked;
  const interactionBusy = accountBusy || loading || accountLoading;
  const canManageMeetings = Boolean(account) && !meetingChangesLocked && !interactionBusy && !createBusy;

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
  useEffect(() => {
    if (selectedMeeting) {
      setSelectedMeetingMetadata(selectedMeeting);
      return;
    }
    if (settings.zoom.selectedMeetingId !== selectedMeetingMetadata?.id) {
      setSelectedMeetingMetadata(settings.zoom.selectedMeetingId ? {
        id: settings.zoom.selectedMeetingId,
        topic: settings.zoom.topic,
        startTime: settings.zoom.startTime,
        durationMinutes: settings.zoom.durationMinutes,
      } : null);
    }
  }, [selectedMeeting, selectedMeetingMetadata?.id, settings.zoom.durationMinutes, settings.zoom.selectedMeetingId, settings.zoom.startTime, settings.zoom.topic]);
  useEffect(() => {
    if (settings.zoom.selectedMeetingId) setDetailsMeetingId(settings.zoom.selectedMeetingId);
  }, [settings.zoom.selectedMeetingId]);
  useEffect(() => {
    if (outputActive) {
      if (!activeMeeting && (selectedMeeting ?? selectedMeetingMetadata)) setActiveMeeting(selectedMeeting ?? selectedMeetingMetadata);
      return;
    }
    setActiveMeeting(null);
  }, [outputActive, selectedMeeting, selectedMeetingMetadata, activeMeeting]);
  useEffect(() => {
    if (meetingChangesLocked && !createBusy) setCreateOpen(false);
  }, [createBusy, meetingChangesLocked]);

  const retainedMeeting = outputActive ? (activeMeeting ?? selectedMeeting ?? selectedMeetingMetadata) : selectedMeeting;
  const isShowingActiveMeeting = outputActive && Boolean(retainedMeeting);
  const cachedSelectedMeeting = !accountLoading && !loading && (!accountError || Boolean(account)) && selectedMeetingMetadata?.id === settings.zoom.selectedMeetingId
    ? selectedMeetingMetadata
    : null;
  const selectableMeeting = selectedMeeting ?? cachedSelectedMeeting;
  const selectedMeetingIsStale = Boolean(account && !meetingChangesLocked && settings.zoom.selectedMeetingId && !selectedMeeting && !loading && !meetingsError);
  const showingSelectedDetails = Boolean(selectableMeeting && detailsMeetingId === selectableMeeting.id);
  const visibleMeeting = isShowingActiveMeeting ? retainedMeeting : showingSelectedDetails ? selectableMeeting : null;
  useEffect(() => {
    if (!returnFocusPending.current || visibleMeeting) return;
    returnFocusPending.current = false;
    firstMeetingRow.current?.focus();
  }, [meetings, visibleMeeting]);
  const elapsed = status.state === 'live' && streamingStartedAt !== null
    ? formatElapsed(Math.max(0, now - streamingStartedAt))
    : null;
  const safeStatusMessage = status.state === 'error'
    ? providerErrorMessage('Zoom', status.message, 'Zoom output could not start. Check the meeting and try again.')
    : '';

  function updateZoom(patch: Partial<StreamServiceSettings['zoom']>): void {
    if (meetingChangesLockedRef.current) return;
    onChange({ ...settings, zoom: { ...settings.zoom, ...patch } });
  }

  function openSettings(): void {
    setAccountError('');
    setSettingsOpen(true);
  }

  function openCreate(): void {
    if (!canManageMeetings) return;
    setCreateError('');
    setCreateOpen(true);
  }

  async function retryAccountCheck(): Promise<void> {
    if (meetingChangesLocked) return;
    const id = ++requestId.current;
    setAccountLoading(true);
    setAccountError('');
    setMeetingsError('');
    try {
      const connected = await api.getZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      if (meetingChangesLockedRef.current) return;
      setAccount(connected);
      if (!connected) {
        setMeetings([]);
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
    if (meetingChangesLocked) return;
    const finishOperation = onOperationStart?.();
    const id = ++requestId.current;
    setAccountLoading(false);
    setLoading(false);
    setAccountBusy(true);
    setAccountError('');
    setMeetingsError('');
    try {
      const connected = await api.connectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      if (meetingChangesLockedRef.current) return;
      setAccount(connected);
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
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not connect Zoom. Try again.'));
      }
    } finally {
      finishOperation?.();
      if (mounted.current && id === requestId.current) setAccountBusy(false);
    }
  }

  async function disconnectAccount(): Promise<void> {
    if (meetingChangesLocked) return;
    const finishOperation = onOperationStart?.();
    const id = ++requestId.current;
    setAccountLoading(false);
    setLoading(false);
    setAccountBusy(true);
    setAccountError('');
    try {
      await api.disconnectZoomAccount();
      if (!mounted.current || id !== requestId.current) return;
      if (meetingChangesLockedRef.current) return;
      setAccount(null);
      setMeetings([]);
      setDetailsMeetingId('');
      setSelectedMeetingMetadata(null);
      updateZoom({ selectedMeetingId: '' });
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setAccountError(providerErrorMessage('Zoom', error, 'Could not disconnect Zoom. Try again.'));
      }
    } finally {
      finishOperation?.();
      if (mounted.current && id === requestId.current) setAccountBusy(false);
    }
  }

  async function createMeeting(draft: StreamServiceSettings['zoom']): Promise<void> {
    if (!canManageMeetings) return;
    const finishOperation = onOperationStart?.();
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await api.createZoomMeeting(draft);
      if (!mounted.current) return;
      setMeetings((previous) => [created, ...previous.filter((meeting) => meeting.id !== created.id)]);
      if (!meetingChangesLockedRef.current) {
        const metadata: ZoomMeetingMetadata = {
          id: created.id,
          topic: created.topic || draft.topic,
          startTime: created.startTime || draft.startTime,
          durationMinutes: created.durationMinutes || draft.durationMinutes,
        };
        setSelectedMeetingMetadata(metadata);
        updateZoom({ topic: metadata.topic, startTime: metadata.startTime, durationMinutes: metadata.durationMinutes, selectedMeetingId: metadata.id });
        setDetailsMeetingId(metadata.id);
      }
      setCreateOpen(false);
    } catch (error) {
      if (mounted.current) setCreateError(providerErrorMessage('Zoom', error, 'Could not create the Zoom meeting. Check the details and try again.'));
    } finally {
      finishOperation?.();
      if (mounted.current) setCreateBusy(false);
    }
  }

  const menuItems: MenuEntry[] = [{ id: 'zoom.settings', label: 'Settings', onSelect: openSettings }];
  if (canManageMeetings) menuItems.push({ id: 'zoom.new-meeting', label: 'New meeting', onSelect: openCreate });

  return <Panel density="compact" className="dock zoom-dock" style={style}>
    {resizer}
    <DockHeader
      title="Zoom"
      icon={<ZoomBrandIcon />}
      actions={account ? <ReacstButton.Icon variant="ghost" size="sm" label="Refresh meetings" disabled={loading || accountBusy || accountLoading} onClick={() => void refreshMeetings()}><RefreshCw /></ReacstButton.Icon> : undefined}
      menuItems={menuItems}
      onHide={onHide}
    />

    <div className="zoom-dock-body" aria-busy={accountLoading || loading}>
      {status.state === 'error' && <Banner className="zoom-output-error" tone="error" size="sm">{safeStatusMessage}</Banner>}
      {accountError && account && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" disabled={meetingChangesLocked || interactionBusy} onClick={() => void retryAccountCheck()}>Retry</ReacstButton>}>{accountError}</Banner>}
      {meetingsError && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" disabled={loading || accountBusy || accountLoading} onClick={() => void refreshMeetings()}>Retry</ReacstButton>}>Could not load meetings: {meetingsError}</Banner>}
      {selectedMeetingIsStale && visibleMeeting?.id === settings.zoom.selectedMeetingId && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" disabled={loading || accountBusy} onClick={() => void refreshMeetings()}>Refresh</ReacstButton>}>The selected meeting is unavailable. Return to choose another meeting or refresh the list.</Banner>}

      {visibleMeeting ? <ZoomMeetingDetails
        meeting={visibleMeeting}
        status={status}
        elapsed={elapsed}
        canReturn={!meetingChangesLocked}
        onReturn={() => {
          returnFocusPending.current = true;
          updateZoom({ selectedMeetingId: '' });
          setDetailsMeetingId('');
        }}
      />
        : accountLoading ? <ZoomNotice title="Loading meetings…" description="Fetching scheduled Zoom meetings." />
          : accountError && !account ? <ZoomNotice title="Could not check Zoom" description={accountError} tone="error">
            <ReacstButton size="sm" onClick={() => void retryAccountCheck()}>Try again</ReacstButton>
          </ZoomNotice>
            : !account ? <ZoomNotice title="Connect Zoom" description="Connect your account to choose a scheduled meeting.">
              <ReacstButton size="sm" variant="default" onClick={openSettings}>Connect Zoom</ReacstButton>
            </ZoomNotice>
              : loading && meetings.length === 0 ? <ZoomNotice title="Loading meetings…" description="Fetching scheduled Zoom meetings." />
                : meetings.length === 0 && !meetingsError ? <ZoomNotice title="No scheduled meetings" description="Create a meeting to use Zoom output.">
                  <ReacstButton size="sm" variant="default" disabled={!canManageMeetings} onClick={openCreate}>New meeting</ReacstButton>
                </ZoomNotice>
                  : <div className="zoom-meeting-list" aria-label="Scheduled Zoom meetings">
                    {meetings.map((meeting, index) => <ZoomMeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      selected={settings.zoom.selectedMeetingId === meeting.id}
                      disabled={meetingChangesLocked || interactionBusy}
                      rowRef={index === 0 ? firstMeetingRow : undefined}
                      onSelect={() => {
                        if (meetingChangesLocked || interactionBusy) return;
                        setSelectedMeetingMetadata(meeting);
                        updateZoom({ topic: meeting.topic, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes, selectedMeetingId: meeting.id });
                        setDetailsMeetingId(meeting.id);
                      }}
                    />)}
                  </div>}
    </div>

    <ZoomSettingsDialog open={settingsOpen} account={account} busy={accountBusy} readOnly={meetingChangesLocked} error={accountError} onConnect={() => void connectAccount()} onDisconnect={() => void disconnectAccount()} onClose={() => setSettingsOpen(false)} />
    <CreateZoomMeetingDialog open={createOpen} initialDraft={settings.zoom} busy={createBusy} error={createError} onClose={() => setCreateOpen(false)} onSubmit={(draft) => void createMeeting(draft)} />
  </Panel>;
}
