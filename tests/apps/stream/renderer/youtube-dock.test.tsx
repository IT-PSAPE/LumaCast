import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createDefaultStreamServiceSettings,
  type StreamAPI,
  type StreamRuntimeStatus,
  type StreamServiceSettings,
  type YouTubeAccount,
  type YouTubeBroadcast,
  type YouTubeLiveDetails,
} from '../../../../apps/stream/shared/desktop-api';
import { YouTubeDock } from '../../../../apps/stream/renderer/docks/youtube-dock';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const OFFLINE_STATUS: StreamRuntimeStatus = { state: 'stopped' };
const ACCOUNT: YouTubeAccount = { channelId: 'channel-1', channelTitle: 'Creator channel' };
const BROADCAST: YouTubeBroadcast = {
  id: 'broadcast-1',
  title: 'Launch stream',
  description: 'Product launch',
  scheduledStartTime: '2026-10-25T12:30:00.000Z',
  status: 'upcoming',
  privacy: 'unlisted',
  thumbnailUrl: 'https://example.test/launch.jpg',
};
const LIVE_DETAILS: YouTubeLiveDetails = {
  title: 'Launch stream',
  currentViewers: 37,
  viewCount: 82,
  health: 'excellent',
  notices: [],
};
const PROVIDER_FAILURE = 'YouTube denied access. Reconnect the account or check its live streaming eligibility.';

type YouTubeAPI = Pick<
  StreamAPI,
  | 'getYouTubeAccount'
  | 'connectYouTubeAccount'
  | 'disconnectYouTubeAccount'
  | 'listYouTubeBroadcasts'
  | 'getYouTubeLiveDetails'
  | 'createYouTubeBroadcast'
>;

type DockOverrides = {
  api?: Partial<YouTubeAPI>;
  settings?: Partial<StreamServiceSettings>;
  status?: StreamRuntimeStatus;
  activeOutputs?: Array<{ id: string; status: StreamRuntimeStatus }>;
  streamingStartedAt?: number | null;
  now?: number;
  onGoLive?: () => void;
  onStopStreaming?: (outputId?: string) => void;
  onOpenDashboard?: () => void;
  onHide?: () => void;
};

function createApi(overrides: Partial<YouTubeAPI> = {}): StreamAPI {
  const api: YouTubeAPI = {
    getYouTubeAccount: vi.fn().mockResolvedValue(ACCOUNT),
    connectYouTubeAccount: vi.fn().mockResolvedValue(ACCOUNT),
    disconnectYouTubeAccount: vi.fn().mockResolvedValue(undefined),
    listYouTubeBroadcasts: vi.fn().mockResolvedValue([BROADCAST]),
    getYouTubeLiveDetails: vi.fn().mockResolvedValue(LIVE_DETAILS),
    createYouTubeBroadcast: vi.fn().mockResolvedValue(BROADCAST),
    ...overrides,
  };
  return api as StreamAPI;
}

function renderDock(overrides: DockOverrides = {}) {
  const defaultSettings = createDefaultStreamServiceSettings();
  const settings: StreamServiceSettings = {
    ...defaultSettings,
    ...overrides.settings,
    youtube: { ...defaultSettings.youtube, ...overrides.settings?.youtube },
  };
  const api = createApi(overrides.api);
  const onChange = vi.fn();
  const onGoLive = overrides.onGoLive ?? vi.fn();
  const onStopStreaming = overrides.onStopStreaming ?? vi.fn();
  const onOpenDashboard = overrides.onOpenDashboard ?? vi.fn();
  const onHide = overrides.onHide ?? vi.fn();
  let dockStatus = overrides.status ?? OFFLINE_STATUS;
  let activeOutputs = overrides.activeOutputs ?? [];

  function DockHarness() {
    const [currentSettings, setCurrentSettings] = useState(settings);
    return (
      <YouTubeDock
        api={api}
        settings={currentSettings}
        onChange={(nextSettings) => {
          onChange(nextSettings);
          setCurrentSettings(nextSettings);
        }}
        status={dockStatus}
        activeOutputs={activeOutputs}
        streamingStartedAt={overrides.streamingStartedAt ?? null}
        now={overrides.now ?? Date.now()}
        onGoLive={onGoLive}
        onStopStreaming={onStopStreaming}
        onOpenDashboard={onOpenDashboard}
        onHide={onHide}
      />
    );
  }

  const view = render(<DockHarness />);
  function setRuntimeState(nextStatus: StreamRuntimeStatus, nextActiveOutputs: Array<{ id: string; status: StreamRuntimeStatus }>) {
    dockStatus = nextStatus;
    activeOutputs = nextActiveOutputs;
    view.rerender(<DockHarness />);
  }
  return { ...view, api, settings, onChange, onGoLive, onStopStreaming, onOpenDashboard, onHide, setRuntimeState };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('YouTubeDock', () => {
  it('loads account and broadcasts before showing the no-selection state', async () => {
    const accountRequest = deferred<YouTubeAccount | null>();
    const broadcastsRequest = deferred<YouTubeBroadcast[]>();
    const api = createApi({
      getYouTubeAccount: vi.fn(() => accountRequest.promise),
      listYouTubeBroadcasts: vi.fn(() => broadcastsRequest.promise),
    });
    renderDock({ api });

    expect(screen.getByText('Loading streams…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    await act(async () => {
      accountRequest.resolve(ACCOUNT);
      await accountRequest.promise;
    });
    await waitFor(() => expect(api.listYouTubeBroadcasts).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Loading streams…')).toBeInTheDocument();

    await act(async () => {
      broadcastsRequest.resolve([BROADCAST]);
      await broadcastsRequest.promise;
    });
    expect(await screen.findByText('No stream selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select stream' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(api.getYouTubeLiveDetails).not.toHaveBeenCalled();
  });

  it('opens account and manual RTMPS settings from the disconnected notice', async () => {
    const { api, onChange, onGoLive } = renderDock({
      api: {
        getYouTubeAccount: vi.fn().mockResolvedValue(null),
      },
    });

    const openSettings = await screen.findByRole('button', { name: 'Connect YouTube' });
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stream Key')).not.toBeInTheDocument();
    fireEvent.click(openSettings);

    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });
    expect(api.connectYouTubeAccount).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('heading', { name: 'Manual RTMPS' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'YouTube ingest server' })).toBeInTheDocument();

    const streamKey = within(dialog).getByLabelText('Stream Key');
    expect(streamKey).toHaveAttribute('type', 'password');
    expect(streamKey).toHaveValue('');
    fireEvent.change(streamKey, { target: { value: 'updated-manual-key' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ streamKey: 'updated-manual-key' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show stream key' }));
    expect(within(dialog).getByLabelText('Stream Key')).toHaveAttribute('type', 'text');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Go live' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    expect(onGoLive).toHaveBeenCalledTimes(1);
    expect(api.connectYouTubeAccount).not.toHaveBeenCalled();
  });

  it('connects the YouTube account only after confirmation in settings', async () => {
    const { api } = renderDock({ api: { getYouTubeAccount: vi.fn().mockResolvedValue(null) } });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect YouTube' }));
    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });

    expect(api.connectYouTubeAccount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect YouTube' }));
    expect(await within(dialog).findByText('Creator channel')).toBeInTheDocument();
    expect(api.connectYouTubeAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
  });

  it('keeps manual Go live unavailable after Settings closes while OAuth is pending', async () => {
    const connectRequest = deferred<YouTubeAccount>();
    const { api } = renderDock({
      settings: { streamKey: 'manual-key' },
      api: {
        getYouTubeAccount: vi.fn().mockResolvedValue(null),
        connectYouTubeAccount: vi.fn(() => connectRequest.promise),
      },
    });

    expect(await screen.findByRole('button', { name: 'Go live' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect YouTube' }));
    expect(within(dialog).getByRole('button', { name: 'Connecting…' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'YouTube settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(api.connectYouTubeAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      connectRequest.reject(new Error('OAuth was cancelled.'));
      await connectRequest.promise.catch(() => undefined);
    });
    expect(await screen.findByRole('button', { name: 'Go live' })).toBeEnabled();
  });

  it('keeps an empty schedule in the chooser and exposes New stream there', async () => {
    renderDock({ api: { listYouTubeBroadcasts: vi.fn().mockResolvedValue([]) } });
    expect(await screen.findByText('No stream selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select stream' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New stream' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select stream' }));
    expect(await screen.findByText('No scheduled streams')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    const chooser = screen.getByLabelText('Choose a scheduled YouTube stream');
    fireEvent.click(within(chooser).getAllByRole('button', { name: 'New stream' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Create stream' })).toBeInTheDocument();
  });

  it('uses a fresh future start time when creating from an expired saved schedule', async () => {
    const api = createApi({
      listYouTubeBroadcasts: vi.fn().mockResolvedValue([]),
    });
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, scheduledStartTime: '2020-01-01T00:00:00.000Z' } },
      api,
    });
    expect(await screen.findByText('No stream selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select stream' }));

    const chooser = screen.getByLabelText('Choose a scheduled YouTube stream');
    const openWindowStart = Date.now();
    fireEvent.click(within(chooser).getByRole('button', { name: 'New stream' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create stream' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Fresh stream' } });

    const startTime = within(dialog).getByLabelText('Start time');
    const displayedTimestamp = Date.parse((startTime as HTMLInputElement).value);
    expect(displayedTimestamp).toBeGreaterThan(Date.now());
    expect(displayedTimestamp).toBeLessThan(openWindowStart + 6 * 60 * 1000);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create stream' }));
    await waitFor(() => expect(api.createYouTubeBroadcast).toHaveBeenCalledTimes(1));
    const [draft] = vi.mocked(api.createYouTubeBroadcast).mock.calls[0];
    const submittedTimestamp = Date.parse(draft.scheduledStartTime);
    expect(submittedTimestamp).toBeGreaterThan(Date.now());
    expect(submittedTimestamp).toBeLessThan(openWindowStart + 6 * 60 * 1000);
  });

  it('selects a scheduled stream with its thumbnail and enables offline Go live', async () => {
    const { api, onChange, onGoLive } = renderDock();
    expect(await screen.findByText('No stream selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select stream' }));

    const streamRow = await screen.findByRole('button', { name: /Launch stream/ });
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(within(streamRow).getByText('Launch stream')).toBeInTheDocument();
    expect(streamRow.querySelector('img')).toHaveAttribute('src', BROADCAST.thumbnailUrl);
    fireEvent.click(streamRow);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      youtube: expect.objectContaining({ broadcastId: BROADCAST.id }),
    }));
    expect(await screen.findByLabelText('Current stream details')).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Stream health: Excellent' })).toBeInTheDocument();
    expect(api.getYouTubeLiveDetails).toHaveBeenCalledWith(BROADCAST.id);
    const goLive = screen.getByRole('button', { name: 'Go live' });
    expect(goLive).toBeEnabled();
    fireEvent.click(goLive);
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('keeps scheduled stream details visible while connecting and cancels only the YouTube output', async () => {
    const onStopStreaming = vi.fn();
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'connecting' },
      activeOutputs: [{ id: 'youtube', status: { state: 'connecting', outputId: 'youtube' } }],
      onStopStreaming,
    });

    expect(await screen.findByText('Launch stream')).toBeInTheDocument();
    expect(await screen.findByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onStopStreaming).toHaveBeenCalledWith('youtube');
    expect(screen.getByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows live metrics and asks before ending the YouTube stream', async () => {
    const now = 1_000_000;
    const onStopStreaming = vi.fn();
    const { setRuntimeState } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'live', bitrateKbps: 4200, outputId: 'youtube' },
      activeOutputs: [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }],
      streamingStartedAt: now - 65_000,
      now,
      onStopStreaming,
    });

    expect(await screen.findByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('01:05')).toBeInTheDocument();
    expect(screen.getByText('4200 kb/s')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End stream' }));

    const confirmation = await screen.findByRole('dialog', { name: 'End stream?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep streaming' }));
    expect(onStopStreaming).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End stream' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End stream' }));
    const pendingConfirmation = await screen.findByRole('dialog', { name: 'End stream?' });
    fireEvent.click(within(pendingConfirmation).getByRole('button', { name: 'End stream' }));
    expect(onStopStreaming).toHaveBeenCalledTimes(1);
    expect(onStopStreaming).toHaveBeenCalledWith('youtube');
    expect(within(pendingConfirmation).getByRole('button', { name: 'Ending…' })).toBeDisabled();
    expect(within(pendingConfirmation).getByRole('button', { name: 'Keep streaming' })).toBeDisabled();
    fireEvent.click(within(pendingConfirmation).getByRole('button', { name: 'Ending…' }));
    expect(onStopStreaming).toHaveBeenCalledTimes(1);

    act(() => setRuntimeState(
      OFFLINE_STATUS,
      [{ id: 'youtube', status: { state: 'stopped', outputId: 'youtube' } }],
    ));
    expect(screen.getByRole('dialog', { name: 'End stream?' })).toBeInTheDocument();

    act(() => setRuntimeState(
      OFFLINE_STATUS,
      [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
    ));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End stream?' })).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Go live' })).toBeEnabled();
  });

  it('shows provider viewer, health, and copyright data while another output has independent controls', async () => {
    const onStopStreaming = vi.fn();
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      activeOutputs: [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
      api: {
        getYouTubeLiveDetails: vi.fn().mockResolvedValue({
          ...LIVE_DETAILS,
          currentViewers: 37,
          viewCount: 82,
          health: 'warning',
          notices: [{
            severity: 'error',
            title: 'Video rejected',
            description: 'YouTube rejected this video for copyright.',
            type: 'rejected:copyright',
          }],
        }),
      },
      onStopStreaming,
    });

    expect(await screen.findByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Stream health: Warning' })).toBeInTheDocument();
    expect(screen.getByText('Video rejected')).toBeInTheDocument();
    expect(screen.getByText('YouTube rejected this video for copyright.')).toBeInTheDocument();
    expect(screen.getByLabelText('YouTube output stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go live' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'End twitch output' }));
    expect(onStopStreaming).toHaveBeenCalledWith('twitch');
    expect(screen.getByRole('button', { name: 'Go live' })).toBeEnabled();
  });

  it('waits for YouTube output cleanup before offering runtime retry', async () => {
    const onGoLive = vi.fn();
    const { setRuntimeState } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'error', outputId: 'youtube', message: 'Encoder stopped unexpectedly.' },
      activeOutputs: [
        { id: 'youtube', status: { state: 'error', outputId: 'youtube' } },
        { id: 'twitch', status: { state: 'live', outputId: 'twitch' } },
      ],
      onGoLive,
    });

    expect(await screen.findByText('Launch stream')).toBeInTheDocument();
    expect(screen.getByText('Encoder stopped unexpectedly.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    act(() => setRuntimeState(
      { state: 'error', outputId: 'youtube', message: 'Encoder stopped unexpectedly.' },
      [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
    ));

    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    expect(tryAgain).toBeEnabled();
    expect(screen.getByRole('button', { name: 'End twitch output' })).toBeInTheDocument();
    fireEvent.click(tryAgain);
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('retries a recoverable live-details error and replaces it with current provider details', async () => {
    const getLiveDetails = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary YouTube details failure.'))
      .mockResolvedValue(LIVE_DETAILS);
    const { api } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      api: { getYouTubeLiveDetails: getLiveDetails },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary YouTube details failure.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));

    expect(await screen.findByRole('status', { name: 'Stream health: Excellent' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.getYouTubeLiveDetails).toHaveBeenCalledTimes(2);
  });

  it('shows a provider account failure and recovers when streams can be loaded again', async () => {
    const listBroadcasts = vi.fn()
      .mockRejectedValueOnce(new Error(PROVIDER_FAILURE))
      .mockResolvedValue([BROADCAST]);
    const { api } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: '' } },
      api: { listYouTubeBroadcasts: listBroadcasts },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(PROVIDER_FAILURE);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No stream selected')).toBeInTheDocument();
    expect(api.listYouTubeBroadcasts).toHaveBeenCalledTimes(2);
  });

  it('preserves selected details during a failed stream refresh and recovers from its compact warning', async () => {
    const listBroadcasts = vi.fn()
      .mockResolvedValueOnce([BROADCAST])
      .mockRejectedValueOnce(new Error('YouTube stream list is temporarily unavailable.'))
      .mockResolvedValue([BROADCAST]);
    const { api } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      api: { listYouTubeBroadcasts: listBroadcasts },
    });

    expect(await screen.findByText('37')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh streams' }));
    expect(await screen.findByText('Streams could not be refreshed: YouTube stream list is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.listYouTubeBroadcasts).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText(/Streams could not be refreshed:/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
  });

  it('does not schedule another details poll when an in-flight request resolves after unmount', async () => {
    const detailsRequest = deferred<YouTubeLiveDetails>();
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      api: { getYouTubeLiveDetails: vi.fn(() => detailsRequest.promise) },
    });

    await screen.findByLabelText('Current stream details');
    await waitFor(() => expect(screen.getByLabelText('Current stream details')).toHaveAttribute('aria-busy', 'true'));
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    cleanup();

    await act(async () => {
      detailsRequest.resolve(LIVE_DETAILS);
      await detailsRequest.promise;
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('keeps Studio, hide, and other-output controls working independently', async () => {
    const onOpenDashboard = vi.fn();
    const onHide = vi.fn();
    const onStopStreaming = vi.fn();
    renderDock({
      activeOutputs: [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
      onOpenDashboard,
      onHide,
      onStopStreaming,
    });
    await screen.findByText('No stream selected');

    fireEvent.click(screen.getByRole('button', { name: 'Open YouTube Studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide YouTube Live' }));
    fireEvent.click(screen.getByRole('button', { name: 'End twitch output' }));

    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onStopStreaming).toHaveBeenCalledWith('twitch');
  });
});
