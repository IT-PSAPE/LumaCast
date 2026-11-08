/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Banner, EmptyState, Panel, ReacstButton } from '@lumacast/ui';
import type {
  StreamAPI,
  StreamRuntimeStatus,
  StreamServiceSettings,
  YouTubeAccount,
  YouTubeBroadcast,
  YouTubeBroadcastDraft,
  YouTubeLiveDetails,
} from '../../shared/desktop-api';
import { getStreamService, validateStreamServiceSettings } from '../../shared/stream-services';
import { providerErrorMessage } from '../shared/provider-error';
import { DockHeader } from './dock-header';
import { YouTubeSettingsDialog, CreateYouTubeStreamDialog } from './youtube-dialogs';
import { YouTubeStreamDetails } from './youtube-stream-details';
import { YouTubeStreamRow } from './youtube-stream-row';
import youtubeIcon from '../assets/youtube/youtube-icon.svg';
import './youtube-dock.css';

const DETAILS_POLL_INTERVAL_MS = 30_000;
const MANUAL_METRICS_UNAVAILABLE_MESSAGE = 'Viewer counts require a connected YouTube account and a selected stream.';

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
  selectionLocked?: boolean;
  onOperationStart?: () => () => void;
  style?: CSSProperties;
  resizer?: ReactNode;
}

function makeDefaultScheduledStartTime(savedTime?: string): string {
  const savedTimestamp = savedTime ? Date.parse(savedTime) : Number.NaN;
  if (Number.isFinite(savedTimestamp) && savedTimestamp > Date.now()) return new Date(savedTimestamp).toISOString();
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

/** Problems and warnings are in-flow Banners; neutral states (loading, empty, not connected) are EmptyStates. */
function StreamNotice({
  title,
  description,
  children,
  tone = 'info',
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: 'info' | 'warning' | 'error';
}) {
  if (tone === 'info') {
    return (
      <EmptyState.Root className="youtube-panel-notice">
        <EmptyState.Title>{title}</EmptyState.Title>
        {description && <EmptyState.Description>{description}</EmptyState.Description>}
        {children && <EmptyState.Action className="youtube-panel-notice__actions">{children}</EmptyState.Action>}
      </EmptyState.Root>
    );
  }
  return <Banner tone={tone} size="sm" title={title} action={children}>{description}</Banner>;
}

export function YouTubeDock({
  api,
  settings,
  onChange,
  status,
  activeOutputs,
  onOpenDashboard,
  onHide,
  selectionLocked: selectionLockedProp,
  onOperationStart,
  style,
  resizer,
}: YouTubeDockProps) {
  const [account, setAccount] = useState<YouTubeAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountBusy, setAccountBusy] = useState(false);
  const [broadcasts, setBroadcasts] = useState<YouTubeBroadcast[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [broadcastsError, setBroadcastsError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsResult, setDetailsResult] = useState<{ broadcastId: string; details: YouTubeLiveDetails; outputState: StreamRuntimeStatus['state'] } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsReload, setDetailsReload] = useState(0);
  const broadcastRequestId = useRef(0);
  const knownBroadcastRef = useRef<YouTubeBroadcast | null>(null);
  const detailsRequestInFlight = useRef(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  const refreshStreams = useCallback(async () => {
    const requestId = ++broadcastRequestId.current;
    setAccountLoading(true);
    setBroadcastsLoading(true);
    setBroadcastsError('');
    setSettingsError('');
    try {
      const connectedAccount = await api.getYouTubeAccount();
      if (requestId !== broadcastRequestId.current) return;
      setAccount(connectedAccount);
      if (!connectedAccount) {
        setBroadcasts([]);
        return;
      }
      const nextBroadcasts = await api.listYouTubeBroadcasts();
      if (requestId === broadcastRequestId.current) setBroadcasts(nextBroadcasts);
    } catch (error) {
      if (requestId === broadcastRequestId.current) {
        const message = providerErrorMessage('YouTube', error, 'Could not load YouTube streams.');
        setBroadcastsError(message);
        setSettingsError(message);
      }
    } finally {
      if (requestId === broadcastRequestId.current) {
        setAccountLoading(false);
        setBroadcastsLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void refreshStreams();
    return () => { broadcastRequestId.current += 1; };
  }, [refreshStreams]);

  const youtubeSettings: StreamServiceSettings = settings.service === 'youtube' ? settings : { ...settings, service: 'youtube' };
  const accountChannelId = account?.channelId ?? '';
  const details = detailsResult?.broadcastId === settings.youtube.broadcastId ? detailsResult.details : null;
  const validationMessage = validateStreamServiceSettings(youtubeSettings);
  const scheduledBroadcasts = broadcasts.filter((broadcast) => broadcast.status !== 'complete');
  const selectedBroadcast = scheduledBroadcasts.find((broadcast) => broadcast.id === settings.youtube.broadcastId);
  useEffect(() => {
    const latestSelectedBroadcast = broadcasts.find((broadcast) => broadcast.id === settings.youtube.broadcastId);
    if (latestSelectedBroadcast) knownBroadcastRef.current = latestSelectedBroadcast;
  }, [broadcasts, settings.youtube.broadcastId]);
  const cachedSelectedBroadcast = knownBroadcastRef.current?.id === settings.youtube.broadcastId ? knownBroadcastRef.current : null;
  const displayedBroadcast = selectedBroadcast ?? cachedSelectedBroadcast;
  const outputIsRunning = status.state === 'connecting' || status.state === 'live';
  const youtubeOutputStillActive = activeOutputs.some((output) => output.id === 'youtube');
  const hasManagedSelection = Boolean(settings.youtube.broadcastId);
  const canUseManualOutput = !account && validationMessage === null;
  const activeOutputExists = activeOutputs.some((output) => output.status.state === 'connecting' || output.status.state === 'live');
  const globallyLocked = Boolean(selectionLockedProp || outputIsRunning || activeOutputExists);
  const selectionLocked = globallyLocked || youtubeOutputStillActive;
  const hasStaleSelection = Boolean(settings.youtube.broadcastId && !selectedBroadcast);

  useEffect(() => {
    const broadcastId = accountChannelId && pageVisible ? settings.youtube.broadcastId : '';
    let active = true;
    let timer: number | undefined;

    if (!broadcastId) {
      setDetailsLoading(false);
      return;
    }

    setDetailsError('');
    setDetailsLoading(true);

    const poll = async () => {
      if (!active) return;
      if (detailsRequestInFlight.current) {
        timer = window.setTimeout(poll, 250);
        return;
      }
      detailsRequestInFlight.current = true;
      setDetailsLoading(true);
      try {
        const nextDetails = await api.getYouTubeLiveDetails(broadcastId);
        if (active) {
          setDetailsResult({ broadcastId, details: nextDetails, outputState: status.state });
          setDetailsError('');
        }
      } catch (error) {
        if (active) setDetailsError(providerErrorMessage('YouTube', error, 'Could not load YouTube live details.'));
      } finally {
        detailsRequestInFlight.current = false;
        if (active) {
          setDetailsLoading(false);
          timer = window.setTimeout(poll, outputIsRunning ? DETAILS_POLL_INTERVAL_MS : 60_000);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accountChannelId, api, detailsReload, outputIsRunning, pageVisible, settings.youtube.broadcastId, status.state]);

  useEffect(() => {
    if (settings.youtube.broadcastId) return;
    knownBroadcastRef.current = null;
    setDetailsResult(null);
    setDetailsError('');
  }, [settings.youtube.broadcastId]);

  function update(patch: Partial<StreamServiceSettings>): void {
    onChange({ ...settings, service: 'youtube', ...patch });
  }

  function updateYoutubeDraft(patch: Partial<StreamServiceSettings['youtube']>): void {
    update({ youtube: { ...settings.youtube, ...patch } });
  }

  async function connectAccount(): Promise<void> {
    if (selectionLocked) return;
    const finishOperation = onOperationStart?.();
    setAccountBusy(true);
    setSettingsError('');
    try {
      const connectedAccount = await api.connectYouTubeAccount();
      setAccount(connectedAccount);
      setBroadcastsLoading(true);
      const nextBroadcasts = await api.listYouTubeBroadcasts();
      setBroadcasts(nextBroadcasts);
      setBroadcastsError('');
    } catch (error) {
      setSettingsError(providerErrorMessage('YouTube', error, 'Could not connect YouTube account.'));
    } finally {
      setAccountBusy(false);
      setAccountLoading(false);
      setBroadcastsLoading(false);
      finishOperation?.();
    }
  }

  async function disconnectAccount(): Promise<void> {
    if (selectionLocked) return;
    const finishOperation = onOperationStart?.();
    setAccountBusy(true);
    setSettingsError('');
    try {
      await api.disconnectYouTubeAccount();
      setAccount(null);
      setBroadcasts([]);
      setBroadcastsError('');
      updateYoutubeDraft({ broadcastId: '' });
    } catch (error) {
      setSettingsError(providerErrorMessage('YouTube', error, 'Could not disconnect YouTube account.'));
    } finally {
      setAccountBusy(false);
      finishOperation?.();
    }
  }

  async function createStream(draft: YouTubeBroadcastDraft): Promise<void> {
    if (selectionLocked) return;
    const finishOperation = onOperationStart?.();
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await api.createYouTubeBroadcast({ ...draft, broadcastId: '' });
      knownBroadcastRef.current = created;
      setBroadcasts((previous) => [created, ...previous.filter((broadcast) => broadcast.id !== created.id)]);
      updateYoutubeDraft({
        title: draft.title,
        description: draft.description,
        privacy: draft.privacy,
        scheduledStartTime: draft.scheduledStartTime,
        broadcastId: created.id,
      });
      setCreateOpen(false);
    } catch (error) {
      setCreateError(providerErrorMessage('YouTube', error, 'Could not create YouTube stream.'));
    } finally {
      setCreateBusy(false);
      finishOperation?.();
    }
  }

  function selectBroadcast(broadcast: YouTubeBroadcast): void {
    if (selectionLocked) return;
    knownBroadcastRef.current = broadcast;
    updateYoutubeDraft({
      broadcastId: broadcast.id,
      title: broadcast.title,
      description: broadcast.description,
      scheduledStartTime: broadcast.scheduledStartTime,
    });
  }

  function returnToStreamList(): void {
    if (selectionLocked || (status.state !== 'stopped' && status.state !== 'error')) return;
    updateYoutubeDraft({ broadcastId: '' });
  }

  const manualServer = getStreamService('youtube').servers.find((server) => server.id === settings.serverId);
  const manualTitle = manualServer?.url.startsWith('rtmp:') ? 'Manual RTMP' : 'Manual RTMPS';
  const hasManualOutputState = !hasManagedSelection && status.state !== 'stopped';
  const showManualDetails = canUseManualOutput || hasManualOutputState;
  const showDetails = (hasManagedSelection || showManualDetails)
    && (selectionLocked || hasManualOutputState || (!accountLoading && !broadcastsLoading));
  const selectedTitle = details?.title ?? displayedBroadcast?.title ?? (showManualDetails ? settings.youtube.title || manualTitle : 'Selected stream unavailable');
  const refreshBusy = accountLoading || broadcastsLoading || accountBusy;

  const canReturn = hasManagedSelection && !selectionLocked && (status.state === 'stopped' || status.state === 'error');
  const openSettings = () => {
    if (selectionLocked) return;
    setSettingsError('');
    setSettingsOpen(true);
  };
  const openCreate = () => {
    if (selectionLocked) return;
    setCreateError('');
    setCreateOpen(true);
  };
  const headerMenuItems = [
    { id: 'youtube.settings', label: 'YouTube settings', disabled: selectionLocked, onSelect: openSettings },
    { id: 'youtube.new-stream', label: 'New stream', disabled: !account || selectionLocked, onSelect: openCreate },
    { id: 'youtube.studio', label: 'Open YouTube Studio', disabled: selectionLocked, onSelect: onOpenDashboard },
  ];

  let body: ReactNode;
  if (showDetails) {
    body = (
      <>
        {hasStaleSelection && account && !selectionLocked && <Banner tone="warning" size="sm">Selected stream is unavailable.</Banner>}
        {broadcastsError && account && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" onClick={() => void refreshStreams()}>Retry</ReacstButton>}>Streams could not be refreshed: {broadcastsError}</Banner>}
        {detailsError && account && hasManagedSelection && (
          <Banner tone="error" size="sm" action={<ReacstButton size="xs" onClick={() => setDetailsReload((current) => current + 1)}>Retry details</ReacstButton>}>Stream details could not be refreshed: {detailsError}</Banner>
        )}
        <YouTubeStreamDetails
          title={selectedTitle}
          details={details}
          loading={detailsLoading}
          outputState={status.state}
          providerHealthFresh={detailsResult?.broadcastId === settings.youtube.broadcastId && detailsResult.outputState === status.state}
          metricsUnavailableMessage={showManualDetails ? MANUAL_METRICS_UNAVAILABLE_MESSAGE : undefined}
          onReturn={canReturn ? returnToStreamList : undefined}
        />
      </>
    );
  } else if (accountLoading || broadcastsLoading) {
    body = <StreamNotice title="Loading streams…" description="Fetching upcoming streams." />;
  } else if (broadcastsError && !account) {
    body = <StreamNotice title="Could not check YouTube connection" description={broadcastsError} tone="error"><ReacstButton variant="default" onClick={() => void refreshStreams()}>Try again</ReacstButton></StreamNotice>;
  } else if (!account && !canUseManualOutput) {
    body = (
      <StreamNotice title="Not connected" description="Connect YouTube in Settings to manage streams.">
        <ReacstButton variant="default" disabled={selectionLocked} onClick={openSettings}>Connect YouTube</ReacstButton>
      </StreamNotice>
    );
  } else if (broadcastsError && scheduledBroadcasts.length === 0) {
    body = <StreamNotice title="Could not load streams" description={broadcastsError} tone="error"><ReacstButton variant="default" onClick={() => void refreshStreams()}>Try again</ReacstButton></StreamNotice>;
  } else if (account && scheduledBroadcasts.length === 0) {
    body = (
      <StreamNotice title="No scheduled stream" description="Create a stream to use YouTube output.">
        <ReacstButton variant="default" className="youtube-new-stream-button" disabled={selectionLocked} onClick={openCreate}>New stream</ReacstButton>
      </StreamNotice>
    );
  } else {
    body = (
      <>
        {broadcastsError && <Banner tone="warning" size="sm" action={<ReacstButton size="xs" onClick={() => void refreshStreams()}>Retry</ReacstButton>}>Streams could not be refreshed: {broadcastsError}</Banner>}
        <div className="youtube-stream-list" role="list" aria-label="Scheduled YouTube streams">
          {scheduledBroadcasts.map((broadcast) => (
            <div role="listitem" key={broadcast.id}>
              <YouTubeStreamRow stream={broadcast} disabled={selectionLocked} onSelect={selectBroadcast} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (status.state === 'error' && status.message) {
    body = <><Banner tone="error" size="sm">{providerErrorMessage('YouTube', status.message, 'YouTube streaming failed.')}</Banner>{body}</>;
  }

  return (
    <Panel density="compact" className="dock youtube-dock" style={style}>
      {resizer}
      <DockHeader
        title="YouTube Live"
        icon={<img className="youtube-dock-header__icon" src={youtubeIcon} alt="" width={24} height={24} draggable={false} />}
        actions={account && <ReacstButton.Icon variant="ghost" size="sm" label="Refresh streams" disabled={refreshBusy} onClick={() => { void refreshStreams(); setDetailsReload((current) => current + 1); }}><RefreshCw /></ReacstButton.Icon>}
        menuItems={headerMenuItems}
        onHide={onHide}
      />

      <div className="youtube-dock-body">{body}</div>

      <YouTubeSettingsDialog
        open={settingsOpen}
        account={account}
        busy={accountBusy || accountLoading}
        readOnly={selectionLocked}
        readClipboardText={api.readClipboardText}
        error={settingsError}
        settings={youtubeSettings}
        onChange={(nextSettings) => onChange({ ...nextSettings, service: 'youtube' })}
        onConnect={() => { void connectAccount(); }}
        onDisconnect={() => { void disconnectAccount(); }}
        onClose={() => setSettingsOpen(false)}
      />
      <CreateYouTubeStreamDialog
        open={createOpen}
        initialDraft={{ ...settings.youtube, broadcastId: '', scheduledStartTime: makeDefaultScheduledStartTime(settings.youtube.scheduledStartTime) }}
        busy={createBusy}
        selectionLocked={selectionLocked}
        error={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={(draft) => { void createStream(draft); }}
      />
    </Panel>
  );
}
