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
  | 'readClipboardText'
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
  selectionLocked?: boolean;
  onOperationStart?: () => () => void;
};

function createApi(overrides: Partial<YouTubeAPI> = {}): StreamAPI {
  const api: YouTubeAPI = {
    readClipboardText: vi.fn().mockResolvedValue(''),
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
        selectionLocked={overrides.selectionLocked}
        onOperationStart={overrides.onOperationStart}
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
  it.each([
    ['primary', 'Manual RTMPS'],
    ['legacy', 'Manual RTMP'],
  ])('identifies the selected manual %s protocol', async (serverId, label) => {
    renderDock({
      api: { getYouTubeAccount: vi.fn().mockResolvedValue(null) },
      settings: { serverId, streamKey: 'fixture-stream-key' },
    });

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('shows manual output as Streaming without inventing provider health', async () => {
    renderDock({
      api: { getYouTubeAccount: vi.fn().mockResolvedValue(null) },
      settings: { serverId: 'legacy', streamKey: 'fixture-stream-key' },
      status: { state: 'live', outputId: 'youtube' },
      activeOutputs: [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }],
    });

    expect(await screen.findByRole('status', { name: 'Output status: Streaming' })).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Provider health:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for stream')).not.toBeInTheDocument();
    expect(screen.getByText('Viewer counts require a connected YouTube account and a selected stream.')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it.each([
    ['live', 'Streaming'],
    ['error', 'Error'],
  ] as const)('shows manual %s details when an account is connected but no stream is selected', async (state, statusLabel) => {
    renderDock({
      api: { listYouTubeBroadcasts: vi.fn().mockResolvedValue([]) },
      settings: { serverId: 'legacy', streamKey: 'fixture-stream-key' },
      status: { state, outputId: 'youtube' },
      activeOutputs: state === 'live' ? [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }] : [],
    });

    expect(await screen.findByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByText('Manual RTMP')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: `Output status: ${statusLabel}` })).toBeInTheDocument();
    expect(screen.getByText('Viewer counts require a connected YouTube account and a selected stream.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Scheduled YouTube streams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Provider health:/ })).not.toBeInTheDocument();
  });

  it('loads account and broadcasts before showing the scheduled stream list', async () => {
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
    expect(await screen.findByRole('button', { name: /Launch stream/ })).toBeEnabled();
    expect(screen.getByRole('list', { name: 'Scheduled YouTube streams' })).toBeInTheDocument();
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
    expect(within(dialog).getByRole('heading', { name: 'Manual streaming' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'YouTube ingest server' })).toBeInTheDocument();

    const streamKey = within(dialog).getByLabelText('Stream Key');
    expect(streamKey).toHaveAttribute('type', 'password');
    expect(streamKey).toHaveValue('');
    fireEvent.change(streamKey, { target: { value: 'updated-manual-key' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ streamKey: 'updated-manual-key' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show stream key' }));
    expect(within(dialog).getByLabelText('Stream Key')).toHaveAttribute('type', 'text');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(onGoLive).not.toHaveBeenCalled();
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

  it('keeps stream start out of the dock while OAuth is pending', async () => {
    const connectRequest = deferred<YouTubeAccount>();
    const { api } = renderDock({
      settings: { streamKey: 'manual-key' },
      api: {
        getYouTubeAccount: vi.fn().mockResolvedValue(null),
        connectYouTubeAccount: vi.fn(() => connectRequest.promise),
      },
    });

    await screen.findByLabelText('Current stream details');
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'YouTube settings' }));
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
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
  });

  it('shows a New stream action for an empty schedule', async () => {
    renderDock({ api: { listYouTubeBroadcasts: vi.fn().mockResolvedValue([]) } });
    expect(await screen.findByText('No scheduled stream')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New stream' }));
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
    expect(await screen.findByText('No scheduled stream')).toBeInTheDocument();
    const openWindowStart = Date.now();
    fireEvent.click(screen.getByRole('button', { name: 'New stream' }));
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

  it('selects a scheduled stream and returns to the list to disarm it', async () => {
    const { api, onChange, onGoLive } = renderDock();
    const streamRow = await screen.findByRole('button', { name: /Launch stream/ });
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(within(streamRow).getByText('Launch stream')).toBeInTheDocument();
    expect(streamRow.querySelector('img')).toHaveAttribute('src', BROADCAST.thumbnailUrl);
    fireEvent.click(streamRow);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      youtube: expect.objectContaining({ broadcastId: BROADCAST.id }),
    }));
    expect(await screen.findByLabelText('Current stream details')).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Output status: Waiting for stream' })).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Provider health: Excellent' })).toBeInTheDocument();
    expect(api.getYouTubeLiveDetails).toHaveBeenCalledWith(BROADCAST.id);
    expect(screen.getByRole('button', { name: 'Return' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(onGoLive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(await screen.findByRole('list', { name: 'Scheduled YouTube streams' })).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      youtube: expect.objectContaining({ broadcastId: '' }),
    }));
  });

  it('keeps selected broadcast metadata and live details through a missing refresh result and stale account', async () => {
    const getAccount = vi.fn()
      .mockResolvedValueOnce(ACCOUNT)
      .mockResolvedValueOnce(ACCOUNT)
      .mockResolvedValueOnce(null);
    const listBroadcasts = vi.fn()
      .mockResolvedValueOnce([BROADCAST])
      .mockResolvedValueOnce([]);
    const { api, onChange, setRuntimeState } = renderDock({
      api: {
        getYouTubeAccount: getAccount,
        listYouTubeBroadcasts: listBroadcasts,
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Launch stream/ }));
    expect(await screen.findByText('37')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      youtube: expect.objectContaining({
        broadcastId: BROADCAST.id,
        title: BROADCAST.title,
        description: BROADCAST.description,
        scheduledStartTime: BROADCAST.scheduledStartTime,
      }),
    }));

    act(() => setRuntimeState(
      { state: 'live', outputId: 'youtube' },
      [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }],
    ));
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh streams' }));
    await waitFor(() => expect(api.listYouTubeBroadcasts).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Launch stream')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh streams' }));
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Launch stream')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('keeps scheduled stream details visible while connecting without Return or lifecycle actions', async () => {
    const onStopStreaming = vi.fn();
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'connecting' },
      activeOutputs: [{ id: 'youtube', status: { state: 'connecting', outputId: 'youtube' } }],
      onStopStreaming,
    });

    expect(await screen.findByText('Launch stream')).toBeInTheDocument();
    expect(await screen.findByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Output status: Connecting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End stream' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(onStopStreaming).not.toHaveBeenCalled();
  });

  it('labels YouTube waiting health separately while local output is live', async () => {
    renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'live', outputId: 'youtube' },
      activeOutputs: [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }],
      api: { getYouTubeLiveDetails: vi.fn().mockResolvedValue({ ...LIVE_DETAILS, health: 'waiting' }) },
    });

    expect(await screen.findByRole('status', { name: 'Output status: Streaming' })).toBeInTheDocument();
    expect(await screen.findByText('YouTube health: Waiting for stream')).toBeInTheDocument();
    expect(screen.queryByText('YouTube health: Excellent')).not.toBeInTheDocument();
  });

  it('shows live metrics without Return or stop actions, then restores Return after cleanup', async () => {
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
    expect(screen.getByRole('status', { name: 'Output status: Streaming' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Provider health: Excellent' })).toBeInTheDocument();
    expect(screen.queryByText('01:05')).not.toBeInTheDocument();
    expect(screen.queryByText('4200 kb/s')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End stream' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
    expect(onStopStreaming).not.toHaveBeenCalled();

    act(() => setRuntimeState(
      OFFLINE_STATUS,
      [{ id: 'youtube', status: { state: 'stopped', outputId: 'youtube' } }],
    ));
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    act(() => setRuntimeState(OFFLINE_STATUS, []));
    expect(await screen.findByRole('button', { name: 'Return' })).toBeEnabled();
    expect(onStopStreaming).not.toHaveBeenCalled();
  });

  it('hides stale provider health after output stops until YouTube confirms the new health', async () => {
    const stoppedDetailsRequest = deferred<YouTubeLiveDetails>();
    const getLiveDetails = vi.fn()
      .mockResolvedValueOnce(LIVE_DETAILS)
      .mockReturnValueOnce(stoppedDetailsRequest.promise);
    const { setRuntimeState } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'live', outputId: 'youtube' },
      activeOutputs: [{ id: 'youtube', status: { state: 'live', outputId: 'youtube' } }],
      api: { getYouTubeLiveDetails: getLiveDetails },
    });

    expect(await screen.findByRole('status', { name: 'Provider health: Excellent' })).toBeInTheDocument();
    act(() => setRuntimeState(
      OFFLINE_STATUS,
      [{ id: 'youtube', status: { state: 'stopped', outputId: 'youtube' } }],
    ));

    expect(screen.getByRole('status', { name: 'Output status: Waiting for stream' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Provider health: Excellent' })).not.toBeInTheDocument();
    await waitFor(() => expect(getLiveDetails).toHaveBeenCalledTimes(2));

    await act(async () => {
      stoppedDetailsRequest.resolve({ ...LIVE_DETAILS, health: 'warning' });
      await stoppedDetailsRequest.promise;
    });
    expect(screen.getByRole('status', { name: 'Provider health: Warning' })).toBeInTheDocument();
  });

  it('keeps the stream list and account actions locked while another output is active', async () => {
    renderDock({
      activeOutputs: [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
    });

    const streamRow = await screen.findByRole('button', { name: /Launch stream/ });
    expect(streamRow).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    expect(screen.getByRole('menuitem', { name: 'New stream' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'YouTube settings' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'Go live' })).not.toBeInTheDocument();
  });

  it('makes YouTube settings read-only when a global output becomes active', async () => {
    const { setRuntimeState } = renderDock();
    await screen.findByRole('list', { name: 'Scheduled YouTube streams' });

    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'YouTube settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });

    act(() => setRuntimeState(
      { state: 'live', outputId: 'primary' },
      [{ id: 'primary', status: { state: 'live', outputId: 'primary' } }],
    ));

    expect(within(dialog).getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: 'YouTube ingest server' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Stream Key')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Show stream key' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Paste stream key' })).toBeDisabled();
  });

  it('uses the native clipboard API for the settings dialog paste button', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('native-clipboard-key');
    const { onChange } = renderDock({ api: { readClipboardText } });
    await screen.findByRole('list', { name: 'Scheduled YouTube streams' });

    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'YouTube settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste stream key' }));

    await waitFor(() => expect(readClipboardText).toHaveBeenCalledOnce());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ service: 'youtube', streamKey: 'native-clipboard-key' }));
  });

  it('waits for YouTube output cleanup before enabling Return', async () => {
    const { setRuntimeState } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      status: { state: 'error', outputId: 'youtube', message: 'HTTP 403 access_token=private-provider-detail' },
      activeOutputs: [
        { id: 'youtube', status: { state: 'error', outputId: 'youtube' } },
        { id: 'twitch', status: { state: 'live', outputId: 'twitch' } },
      ],
    });

    expect(await screen.findByText('Launch stream')).toBeInTheDocument();
    expect(screen.getByText('YouTube streaming failed.')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Output status: Error' })).toBeInTheDocument();
    expect(screen.queryByText(/private-provider-detail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    act(() => setRuntimeState(
      { state: 'error', outputId: 'youtube', message: 'HTTP 403 access_token=private-provider-detail' },
      [{ id: 'twitch', status: { state: 'live', outputId: 'twitch' } }],
    ));

    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();

    act(() => setRuntimeState(
      { state: 'error', outputId: 'youtube', message: 'HTTP 403 access_token=private-provider-detail' },
      [],
    ));
    expect(await screen.findByRole('button', { name: 'Return' })).toBeEnabled();
  });

  it('retries a recoverable live-details error and replaces it with current provider details', async () => {
    const getLiveDetails = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary YouTube details failure.'))
      .mockResolvedValue(LIVE_DETAILS);
    const { api } = renderDock({
      settings: { youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: BROADCAST.id } },
      api: { getYouTubeLiveDetails: getLiveDetails },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load YouTube live details.');
    expect(screen.queryByText('Temporary YouTube details failure.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));

    expect(await screen.findByRole('status', { name: 'Provider health: Excellent' })).toBeInTheDocument();
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

    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube denied access. Reconnect your account or check that the channel is eligible for live streaming.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Launch stream/ })).toBeInTheDocument();
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
    expect(await screen.findByText('Streams could not be refreshed: Could not load YouTube streams.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.listYouTubeBroadcasts).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText(/Streams could not be refreshed:/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Current stream details')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
  });

  it('shows a safe fallback when YouTube account connection fails', async () => {
    const finishOperation = vi.fn();
    const onOperationStart = vi.fn(() => finishOperation);
    renderDock({
      onOperationStart,
      api: {
        getYouTubeAccount: vi.fn().mockResolvedValue(null),
        connectYouTubeAccount: vi.fn().mockRejectedValue(new Error('OAuth token endpoint returned access_token=private-provider-detail')),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Connect YouTube' }));
    const dialog = await screen.findByRole('dialog', { name: 'YouTube settings' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect YouTube' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not connect YouTube account.');
    expect(within(dialog).queryByText(/private-provider-detail/)).not.toBeInTheDocument();
    expect(onOperationStart).toHaveBeenCalledOnce();
    expect(finishOperation).toHaveBeenCalledOnce();
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

  it('keeps YouTube Studio and hide actions in the dock menu', async () => {
    const onOpenDashboard = vi.fn();
    const onHide = vi.fn();
    const onStopStreaming = vi.fn();
    renderDock({
      onOpenDashboard,
      onHide,
      onStopStreaming,
    });
    await screen.findByRole('list', { name: 'Scheduled YouTube streams' });

    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open YouTube Studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'YouTube Live actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide YouTube Live' }));

    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onStopStreaming).not.toHaveBeenCalled();
  });
});
