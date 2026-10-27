/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Banner, EmptyState, Panel, ReacstButton, StatusDot, type StatusTone } from '@lumacast/ui';
import type {
  StreamAPI,
  StreamRuntimeStatus,
  StreamServiceSettings,
  YouTubeAccount,
  YouTubeBroadcast,
  YouTubeBroadcastDraft,
  YouTubeLiveDetails,
} from '../../shared/desktop-api';
import { validateStreamServiceSettings } from '../../shared/stream-services';
import { formatElapsed } from '../format-elapsed';
import { friendlyError } from '../features/shared/friendly-error';
import { YouTubeSettingsDialog, CreateYouTubeStreamDialog, EndYouTubeStreamDialog } from './youtube-dialogs';
import { YouTubeStreamDetails } from './youtube-stream-details';
import { YouTubeStreamRow } from './youtube-stream-row';
import studioWordmark from '../assets/youtube/studio-wordmark.svg';
import './youtube-dock.css';

const DETAILS_POLL_INTERVAL_MS = 30_000;

const STATUS_TONES: Record<StreamRuntimeStatus['state'], StatusTone> = { live: 'success', connecting: 'warning', error: 'error', stopped: 'neutral' };

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
  streamingStartedAt,
  now,
  onGoLive,
  onStopStreaming,
  onOpenDashboard,
  onHide,
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
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [endStopPending, setEndStopPending] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [detailsResult, setDetailsResult] = useState<{ broadcastId: string; details: YouTubeLiveDetails } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsReload, setDetailsReload] = useState(0);
  const broadcastRequestId = useRef(0);
  const detailsRequestInFlight = useRef(false);
  const dockBodyRef = useRef<HTMLDivElement | null>(null);
  const wasChooserOpen = useRef(false);
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
        const message = friendlyError(error);
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
  const details = accountChannelId && detailsResult?.broadcastId === settings.youtube.broadcastId ? detailsResult.details : null;
  const validationMessage = validateStreamServiceSettings(youtubeSettings);
  const scheduledBroadcasts = broadcasts.filter((broadcast) => broadcast.status !== 'complete');
  const selectedBroadcast = scheduledBroadcasts.find((broadcast) => broadcast.id === settings.youtube.broadcastId);
  const outputIsRunning = status.state === 'connecting' || status.state === 'live';
  const youtubeOutputStillActive = activeOutputs.some((output) => output.id === 'youtube');
  const canUseManualOutput = !account && validationMessage === null;
  const canUseManagedOutput = Boolean(account && settings.youtube.broadcastId && (selectedBroadcast || details?.title));
  const canGoLive = !accountLoading && !accountBusy && !broadcastsLoading && !youtubeOutputStillActive && !outputIsRunning && (canUseManagedOutput || canUseManualOutput);
  const hasStaleSelection = Boolean(account && settings.youtube.broadcastId && !selectedBroadcast);
  const otherActiveOutputs = activeOutputs.filter((output) => output.id !== 'youtube');

  useEffect(() => {
    const broadcastId = accountChannelId && pageVisible ? settings.youtube.broadcastId : '';
    let active = true;
    let timer: number | undefined;

    if (!broadcastId) {
      setDetailsLoading(false);
      if (!accountChannelId) {
        setDetailsResult(null);
        setDetailsError('');
      }
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
          setDetailsResult({ broadcastId, details: nextDetails });
          setDetailsError('');
        }
      } catch (error) {
        if (active) setDetailsError(friendlyError(error));
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
  }, [accountChannelId, api, detailsReload, outputIsRunning, pageVisible, settings.youtube.broadcastId]);

  function update(patch: Partial<StreamServiceSettings>): void {
    onChange({ ...settings, service: 'youtube', ...patch });
  }

  function updateYoutubeDraft(patch: Partial<StreamServiceSettings['youtube']>): void {
    update({ youtube: { ...settings.youtube, ...patch } });
  }

  async function connectAccount(): Promise<void> {
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
      setSettingsError(friendlyError(error));
    } finally {
      setAccountBusy(false);
      setAccountLoading(false);
      setBroadcastsLoading(false);
    }
  }

  async function disconnectAccount(): Promise<void> {
    setAccountBusy(true);
    setSettingsError('');
    try {
      await api.disconnectYouTubeAccount();
      setAccount(null);
      setBroadcasts([]);
      setBroadcastsError('');
      updateYoutubeDraft({ broadcastId: '' });
    } catch (error) {
      setSettingsError(friendlyError(error));
    } finally {
      setAccountBusy(false);
    }
  }

  async function createStream(draft: YouTubeBroadcastDraft): Promise<void> {
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await api.createYouTubeBroadcast({ ...draft, broadcastId: '' });
      setBroadcasts((previous) => [created, ...previous.filter((broadcast) => broadcast.id !== created.id)]);
      updateYoutubeDraft({
        title: draft.title,
        description: draft.description,
        privacy: draft.privacy,
        scheduledStartTime: draft.scheduledStartTime,
        broadcastId: created.id,
      });
      setCreateOpen(false);
      setChooserOpen(false);
    } catch (error) {
      setCreateError(friendlyError(error));
    } finally {
      setCreateBusy(false);
    }
  }

  function selectBroadcast(broadcast: YouTubeBroadcast): void {
    if (outputIsRunning) return;
    updateYoutubeDraft({ broadcastId: broadcast.id });
    setChooserOpen(false);
  }

  const showDetails = outputIsRunning || status.state === 'error' || (!accountLoading && !broadcastsLoading && (Boolean(selectedBroadcast) || canUseManualOutput));
  const selectedTitle = selectedBroadcast?.title ?? (canUseManualOutput ? settings.youtube.title || 'Manual RTMPS' : '');
  const refreshBusy = accountLoading || broadcastsLoading || accountBusy;

  useEffect(() => {
    if (chooserOpen && !wasChooserOpen.current) {
      dockBodyRef.current?.querySelector<HTMLElement>('.youtube-stream-row, .youtube-new-stream-button')?.focus();
    } else if (!chooserOpen && wasChooserOpen.current && selectedBroadcast) {
      dockBodyRef.current?.querySelector<HTMLButtonElement>('.youtube-stream-select-button')?.focus();
    } else if (!chooserOpen && wasChooserOpen.current) {
      dockBodyRef.current?.querySelector<HTMLButtonElement>('.youtube-open-stream-chooser')?.focus();
    }
    wasChooserOpen.current = chooserOpen;
  }, [chooserOpen, selectedBroadcast]);

  useEffect(() => {
    if (endStopPending && !youtubeOutputStillActive && !outputIsRunning) {
      setEndStopPending(false);
      setEndConfirmOpen(false);
    }
  }, [endStopPending, outputIsRunning, youtubeOutputStillActive]);

  let body: ReactNode;
  if (showDetails) {
    body = (
      <>
        {chooserOpen && account && !outputIsRunning && (
          <div className="youtube-stream-chooser" role="region" aria-label="Choose a scheduled YouTube stream">
            <div className="youtube-stream-list-heading">
              <strong role="heading" aria-level={2}>Select a stream</strong>
              <ReacstButton variant="default" className="youtube-new-stream-button" onClick={() => { setCreateError(''); setCreateOpen(true); }}>New stream</ReacstButton>
              <ReacstButton.Icon variant="ghost" size="sm" label="Close stream chooser" onClick={() => setChooserOpen(false)}><X /></ReacstButton.Icon>
            </div>
            {broadcastsLoading
              ? <StreamNotice title="Loading streams" description="Fetching your scheduled YouTube streams." />
              : broadcastsError
                ? <StreamNotice title="Could not load streams" description={broadcastsError} tone="error"><ReacstButton variant="default" onClick={() => void refreshStreams()}>Try again</ReacstButton></StreamNotice>
                : scheduledBroadcasts.length === 0
                  ? <StreamNotice title="No scheduled streams" description="Create a YouTube stream to get started." />
                  : <div className="youtube-stream-list" role="list">
                    {scheduledBroadcasts.map((broadcast) => (
                      <div role="listitem" key={broadcast.id}>
                        <YouTubeStreamRow
                          stream={broadcast}
                          selected={broadcast.id === settings.youtube.broadcastId}
                          disabled={outputIsRunning}
                          onSelect={selectBroadcast}
                        />
                      </div>
                    ))}
                  </div>}
          </div>
        )}
        {broadcastsError && account && !chooserOpen && (
          <Banner tone="warning" size="sm" action={<ReacstButton size="xs" onClick={() => void refreshStreams()}>Retry</ReacstButton>}>Streams could not be refreshed: {broadcastsError}</Banner>
        )}
        {hasStaleSelection && !selectedBroadcast && !details?.title && !chooserOpen && !outputIsRunning && !youtubeOutputStillActive && (
          <Banner tone="warning" size="sm" action={<ReacstButton size="xs" className="youtube-open-stream-chooser" onClick={() => setChooserOpen(true)}>Choose stream</ReacstButton>}>Selected stream is unavailable.</Banner>
        )}
        <div hidden={chooserOpen}>
          <YouTubeStreamDetails
            title={selectedTitle}
            details={details}
            loading={detailsLoading}
            onChooseStream={account && (selectedBroadcast || details?.title) && !outputIsRunning && !youtubeOutputStillActive ? () => setChooserOpen(true) : undefined}
          />
        </div>
        {detailsError && account && settings.youtube.broadcastId && (
          <Banner tone="error" size="sm" action={<ReacstButton size="xs" onClick={() => setDetailsReload((current) => current + 1)}>Retry details</ReacstButton>}>Stream details could not be refreshed: {detailsError}</Banner>
        )}
        {status.state === 'error' && status.message && <Banner tone="error" size="sm">{status.message}</Banner>}
      </>
    );
  } else if (accountLoading) {
    body = <StreamNotice title="Loading streams…" description="Fetching upcoming streams." />;
  } else if (broadcastsError && !account) {
    body = <StreamNotice title="Could not check YouTube connection" description={broadcastsError} tone="error"><ReacstButton variant="default" onClick={() => void refreshStreams()}>Try again</ReacstButton></StreamNotice>;
  } else if (!account) {
    body = (
      <StreamNotice title="Not connected" description="Connect YouTube in Settings to manage streams.">
        <ReacstButton variant="default" onClick={() => { setSettingsError(''); setSettingsOpen(true); }}>Connect YouTube</ReacstButton>
      </StreamNotice>
    );
  } else if (broadcastsLoading) {
    body = <StreamNotice title="Loading streams…" description="Fetching upcoming streams." />;
  } else if (broadcastsError) {
    body = <StreamNotice title="Could not load streams" description={broadcastsError} tone="error"><ReacstButton variant="default" onClick={() => void refreshStreams()}>Try again</ReacstButton></StreamNotice>;
  } else if (chooserOpen) {
    body = (
      <div className="youtube-stream-chooser" role="region" aria-label="Choose a scheduled YouTube stream">
        <div className="youtube-stream-list-heading">
          <strong role="heading" aria-level={2}>Select a stream</strong>
          <ReacstButton variant="default" className="youtube-new-stream-button" onClick={() => { setCreateError(''); setCreateOpen(true); }}>New stream</ReacstButton>
          <ReacstButton.Icon variant="ghost" size="sm" label="Close stream chooser" onClick={() => setChooserOpen(false)}><X /></ReacstButton.Icon>
        </div>
        {scheduledBroadcasts.length === 0
          ? <StreamNotice title="No scheduled streams" description="Create a stream to get started." />
          : <div className="youtube-stream-list" role="list">
            {scheduledBroadcasts.map((broadcast) => (
              <div role="listitem" key={broadcast.id}>
                <YouTubeStreamRow
                  stream={broadcast}
                  selected={broadcast.id === settings.youtube.broadcastId}
                  onSelect={selectBroadcast}
                />
              </div>
            ))}
          </div>}
      </div>
    );
  } else if (hasStaleSelection) {
    body = (
      <>
        <StreamNotice title="Selected stream unavailable" description="This stream is no longer in your upcoming list. Refresh or choose another stream." tone="warning">
          <ReacstButton variant="default" onClick={() => void refreshStreams()}>Refresh streams</ReacstButton>
          <ReacstButton variant="success" className="youtube-open-stream-chooser" onClick={() => setChooserOpen(true)}>Choose another</ReacstButton>
        </StreamNotice>
        <YouTubeStreamDetails title={settings.youtube.title} details={details} loading={detailsLoading} />
        {detailsError && <Banner tone="error" size="sm" action={<ReacstButton size="xs" onClick={() => setDetailsReload((current) => current + 1)}>Retry details</ReacstButton>}>Stream details could not be refreshed: {detailsError}</Banner>}
      </>
    );
  } else if (selectedBroadcast) {
    body = <YouTubeStreamDetails title={selectedBroadcast.title} details={details} loading={detailsLoading} />;
  } else {
    body = (
      <StreamNotice title="No stream selected" description="Choose an upcoming stream to get started.">
        <ReacstButton variant="default" className="youtube-open-stream-chooser" onClick={() => setChooserOpen(true)}>Select stream</ReacstButton>
      </StreamNotice>
    );
  }

  return (
    <Panel density="compact" className="dock youtube-dock" style={style}>
      {resizer}
      <Panel.Header data-dock-handle className="cursor-grab select-none">
        <Panel.HeaderTitle>YouTube Live</Panel.HeaderTitle>
        <Panel.HeaderActions>
          {account && !outputIsRunning && !youtubeOutputStillActive && (
            <ReacstButton.Icon variant="ghost" size="sm" label="Refresh streams" disabled={refreshBusy} onClick={() => { void refreshStreams(); setDetailsReload((current) => current + 1); }}>
              <RefreshCw />
            </ReacstButton.Icon>
          )}
          {!outputIsRunning && !youtubeOutputStillActive && <ReacstButton variant="ghost" size="sm" onClick={() => { setSettingsError(''); setSettingsOpen(true); }}>Settings</ReacstButton>}

          <ReacstButton.Icon variant="ghost" size="sm" label="Hide YouTube Live" onClick={onHide}><X /></ReacstButton.Icon>
        </Panel.HeaderActions>
      </Panel.Header>
      <div className="youtube-studio-brand-row">
        <button type="button" className="youtube-studio-brand-button" aria-label="Open YouTube Studio" title="Open YouTube Studio" onClick={onOpenDashboard}>
          <img src={studioWordmark} alt="YouTube Studio" width={65.0667} height={16} draggable={false} />
        </button>
      </div>

      <div className="youtube-dock-body" ref={dockBodyRef}>{body}</div>

      {otherActiveOutputs.length > 0 && <div className="youtube-active-outputs" aria-label="Other active outputs">
        {otherActiveOutputs.map((output) => (
          <div className="youtube-active-output" key={output.id}>
            <StatusDot tone={STATUS_TONES[output.status.state]} />
            <span className="youtube-active-output-name">{output.id === 'primary' ? 'Output' : output.id}</span>
            <span className="youtube-active-output-status">{output.status.state === 'live' ? 'Live' : output.status.state === 'connecting' ? 'Connecting' : output.status.state === 'error' ? 'Error' : 'Offline'}</span>
            <ReacstButton size="sm" label={`End ${output.id} output`} onClick={() => onStopStreaming(output.id)}>End</ReacstButton>
          </div>
        ))}
      </div>}

      <div className="youtube-dock-footer">
        <div className="youtube-status-row" role="group" aria-label={`YouTube output ${status.state}`}>
          <StatusDot tone={STATUS_TONES[status.state]} />
          <span className="youtube-status-text" role="status" aria-live="polite" aria-atomic="true">{status.state === 'live' ? 'Live' : status.state === 'connecting' ? 'Connecting' : status.state === 'error' ? 'Error' : 'Offline'}</span>
          {status.state === 'live' && <span className="youtube-elapsed">{formatElapsed(now - (streamingStartedAt ?? now))}</span>}
          {status.state === 'live' && <span className="youtube-bitrate">{status.bitrateKbps ?? 0} kb/s</span>}
        </div>
        {status.state === 'connecting'
          ? <ReacstButton variant="default" className="youtube-footer-action" onClick={() => onStopStreaming('youtube')}>Cancel</ReacstButton>
          : status.state === 'live'
            ? <ReacstButton variant="danger" className="youtube-footer-action" disabled={endStopPending} onClick={() => setEndConfirmOpen(true)}>{endStopPending ? 'Ending…' : 'End stream'}</ReacstButton>
            : status.state === 'error'
              ? canGoLive && <ReacstButton variant="success" className="youtube-footer-action" onClick={onGoLive}>Try again</ReacstButton>
              : canGoLive && <ReacstButton variant="success" className="youtube-footer-action" onClick={onGoLive}>Go live</ReacstButton>}
      </div>

      <YouTubeSettingsDialog
        open={settingsOpen}
        account={account}
        busy={accountBusy || accountLoading}
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
        error={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={(draft) => { void createStream(draft); }}
      />
      <EndYouTubeStreamDialog
        open={endConfirmOpen}
        busy={endStopPending}
        onCancel={() => { if (!endStopPending) setEndConfirmOpen(false); }}
        onConfirm={() => {
          if (endStopPending) return;
          setEndStopPending(true);
          onStopStreaming('youtube');
        }}
      />
    </Panel>
  );
}
