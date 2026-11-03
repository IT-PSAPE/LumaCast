import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultStreamServiceSettings, type StreamAPI, type StreamRuntimeStatus, type StreamServiceSettings, type ZoomAccount, type ZoomMeeting } from '../../../../apps/stream/shared/desktop-api';
import { ZoomDock } from '../../../../apps/stream/renderer/docks/zoom-dock';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const account: ZoomAccount = { userId: 'zoom-user', displayName: 'Host', email: 'host@example.com' };
const meeting: ZoomMeeting = { id: 'meeting-1', topic: 'Town hall', startTime: '2030-10-20T14:00:00Z', durationMinutes: 60, status: 'waiting' };
const nextMeeting: ZoomMeeting = { id: 'meeting-2', topic: 'Product launch', startTime: '2030-10-21T15:00:00Z', durationMinutes: 45, status: 'waiting' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderDock({
  settings: patch,
  getZoomAccount = () => Promise.resolve(account),
  connectZoomAccount = () => Promise.resolve(account),
  disconnectZoomAccount = () => Promise.resolve(undefined),
  listZoomMeetings = () => Promise.resolve([meeting]),
  createZoomMeeting = () => Promise.resolve(nextMeeting),
  status = { state: 'stopped' },
  selectionLocked = false,
  streamingStartedAt = null,
  now = Date.now(),
  onOperationStart,
}: {
  settings?: Partial<StreamServiceSettings>;
  getZoomAccount?: () => Promise<ZoomAccount | null>;
  connectZoomAccount?: () => Promise<ZoomAccount>;
  disconnectZoomAccount?: () => Promise<void>;
  listZoomMeetings?: () => Promise<ZoomMeeting[]>;
  createZoomMeeting?: (draft: StreamServiceSettings['zoom']) => Promise<ZoomMeeting>;
  status?: StreamRuntimeStatus;
  selectionLocked?: boolean;
  streamingStartedAt?: number | null;
  now?: number;
  onOperationStart?: () => () => void;
} = {}) {
  const defaults = createDefaultStreamServiceSettings();
  const settings: StreamServiceSettings = {
    ...defaults,
    ...patch,
    zoom: { ...defaults.zoom, ...patch?.zoom },
  };
  const onChange = vi.fn();
  const onGoLive = vi.fn();
  const onStopStreaming = vi.fn();
  const onHide = vi.fn();
  const api = {
    getZoomAccount: vi.fn(getZoomAccount),
    connectZoomAccount: vi.fn(connectZoomAccount),
    disconnectZoomAccount: vi.fn(disconnectZoomAccount),
    listZoomMeetings: vi.fn(listZoomMeetings),
    createZoomMeeting: vi.fn(createZoomMeeting),
  } as unknown as StreamAPI;
  let currentStatus = status;
  let currentSelectionLocked = selectionLocked;

  function DockHarness() {
    const [currentSettings, setCurrentSettings] = useState(settings);
    return <ZoomDock
      api={api}
      settings={currentSettings}
      onChange={(next) => { onChange(next); setCurrentSettings(next); }}
      status={currentStatus}
      selectionLocked={currentSelectionLocked}
      onOperationStart={onOperationStart}
      streamingStartedAt={streamingStartedAt}
      now={now}
      onGoLive={onGoLive}
      onStopStreaming={onStopStreaming}
      onHide={onHide}
    />;
  }

  const view = render(<DockHarness />);
  function setRuntimeState(nextStatus: StreamRuntimeStatus, nextSelectionLocked = currentSelectionLocked) {
    currentStatus = nextStatus;
    currentSelectionLocked = nextSelectionLocked;
    view.rerender(<DockHarness />);
  }
  return { ...view, api, settings, onChange, onGoLive, onStopStreaming, onHide, setRuntimeState };
}

async function selectMenuItem(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Zoom actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

describe('ZoomDock', () => {
  it('opens settings before connecting and loads meetings only after explicit connect', async () => {
    const { api } = renderDock({ getZoomAccount: () => Promise.resolve(null) });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Zoom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zoom settings' });
    expect(api.connectZoomAccount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect Zoom' }));
    await waitFor(() => expect(api.connectZoomAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /Town hall/ })).toBeInTheDocument();
  });

  it('shows the loading and connected-empty states with a create action', async () => {
    const meetingsRequest = deferred<ZoomMeeting[]>();
    renderDock({ listZoomMeetings: () => meetingsRequest.promise });
    expect(screen.getByText('Loading meetings…')).toBeInTheDocument();
    expect(screen.getByText('Fetching scheduled Zoom meetings.')).toBeInTheDocument();

    await act(async () => { meetingsRequest.resolve([]); await meetingsRequest.promise; });
    expect(await screen.findByText('No scheduled meetings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New meeting' })).toBeEnabled();
  });

  it('lets the user select a meeting in the dock without starting output', async () => {
    const { onChange, onGoLive } = renderDock();
    const row = await screen.findByRole('button', { name: /Town hall/ });
    fireEvent.click(row);

    expect(await screen.findByText('Waiting for meeting output')).toBeInTheDocument();
    expect(screen.getByText('Meeting ID')).toBeInTheDocument();
    expect(screen.getByText('meeting-1')).toBeInTheDocument();
    expect(screen.getByText('Scheduled duration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeEnabled();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: expect.objectContaining({
      selectedMeetingId: meeting.id,
      topic: meeting.topic,
      startTime: meeting.startTime,
      durationMinutes: meeting.durationMinutes,
    }) }));
    expect(screen.queryByRole('button', { name: /Start output|Go live/i })).not.toBeInTheDocument();
    expect(onGoLive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    const returnedRow = screen.getByRole('button', { name: /Town hall/ });
    expect(returnedRow).toHaveAttribute('aria-pressed', 'false');
    expect(returnedRow).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: expect.objectContaining({ selectedMeetingId: '' }) }));
    expect(screen.queryByText('Meeting ID')).not.toBeInTheDocument();
  });

  it('creates a meeting from the header actions and selects the returned metadata', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const { api, onChange, onGoLive } = renderDock({ settings: { zoom: { ...defaults.zoom, topic: 'Product launch' } } });
    await screen.findByText('Town hall');
    await selectMenuItem('New meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));

    await waitFor(() => expect(api.createZoomMeeting).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.objectContaining({
      selectedMeetingId: nextMeeting.id,
      topic: nextMeeting.topic,
      startTime: nextMeeting.startTime,
      durationMinutes: nextMeeting.durationMinutes,
    }) }));
    expect(await screen.findByText('Waiting for meeting output')).toBeInTheDocument();
    expect(screen.getByText('Product launch')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start output|Go live/i })).not.toBeInTheDocument();
    expect(onGoLive).not.toHaveBeenCalled();
  });

  it('holds a global operation token for a pending meeting creation and releases it on completion', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const request = deferred<ZoomMeeting>();
    const finish = vi.fn();
    const onOperationStart = vi.fn(() => finish);
    renderDock({
      settings: { zoom: { ...defaults.zoom, topic: 'Product launch' } },
      createZoomMeeting: () => request.promise,
      onOperationStart,
    });
    await screen.findByText('Town hall');
    await selectMenuItem('New meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));

    expect(onOperationStart).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    await act(async () => { request.resolve(nextMeeting); await request.promise; });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('validates a new meeting draft and keeps errors in its dialog', async () => {
    const { api } = renderDock();
    await screen.findByRole('button', { name: /Town hall/ });
    await selectMenuItem('New meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    expect(await screen.findByText('Enter a meeting topic.')).toBeInTheDocument();
    expect(api.createZoomMeeting).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Topic' }), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2020-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    expect(await screen.findByText('Choose a future start time.')).toBeInTheDocument();
  });

  it('shows the joining phase and locks selection and Return until output stops', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const { onStopStreaming } = renderDock({
      settings: { zoom: { ...defaults.zoom, ...meeting, selectedMeetingId: meeting.id } },
      status: { state: 'connecting', connectionPhase: 'joining' },
    });
    expect(await screen.findByText('Joining meeting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start output|Cancel|Stop output/i })).not.toBeInTheDocument();
    expect(onStopStreaming).not.toHaveBeenCalled();
    await selectMenuItem('Settings');
    const dialog = await screen.findByRole('dialog', { name: 'Zoom settings' });
    expect(within(dialog).getByRole('button', { name: 'Disconnect' })).toBeDisabled();
  });

  it('retains the actual selected meeting if a refresh omits it while joining', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const list = vi.fn().mockResolvedValueOnce([meeting]).mockResolvedValueOnce([]);
    const { setRuntimeState } = renderDock({
      settings: { zoom: { ...defaults.zoom, selectedMeetingId: meeting.id, topic: 'Saved fallback', startTime: meeting.startTime, durationMinutes: 60 } },
      listZoomMeetings: list,
    });
    await screen.findByText('Town hall');
    setRuntimeState({ state: 'connecting', connectionPhase: 'starting-output' }, true);
    expect(await screen.findByText('Starting output')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh meetings' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Town hall')).toBeInTheDocument();
    expect(screen.getByText('meeting-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
  });

  it('keeps the cached selected meeting visible when a refresh omits it before output starts', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const list = vi.fn().mockResolvedValueOnce([meeting]).mockResolvedValueOnce([]);
    const { onChange } = renderDock({
      settings: { zoom: { ...defaults.zoom, selectedMeetingId: meeting.id, topic: meeting.topic, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes } },
      listZoomMeetings: list,
    });
    expect(await screen.findByText('Town hall')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh meetings' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Town hall')).toBeInTheDocument();
    expect(screen.getByText(/selected meeting is unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(await screen.findByText('No scheduled meetings')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: expect.objectContaining({ selectedMeetingId: '' }) }));
  });

  it('locks selection and account changes when another output is active', async () => {
    const defaults = createDefaultStreamServiceSettings();
    renderDock({
      settings: { zoom: { ...defaults.zoom, selectedMeetingId: meeting.id, topic: meeting.topic, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes } },
      selectionLocked: true,
    });
    expect(await screen.findByText('Waiting for meeting output')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    await selectMenuItem('Settings');
    const dialog = await screen.findByRole('dialog', { name: 'Zoom settings' });
    expect(within(dialog).getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom actions' }));
    expect(screen.queryByRole('menuitem', { name: 'New meeting' })).not.toBeInTheDocument();
  });

  it('keeps saved meeting metadata and selection when an account recheck returns disconnected', async () => {
    const defaults = createDefaultStreamServiceSettings();
    const getZoomAccount = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(null);
    const { onChange } = renderDock({
      settings: { zoom: { ...defaults.zoom, selectedMeetingId: meeting.id, topic: meeting.topic, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes } },
      getZoomAccount,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Waiting for meeting output')).toBeInTheDocument();
    expect(screen.getByText('Town hall')).toBeInTheDocument();
    expect(screen.getByText('meeting-1')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows only the real Zoom meeting information and elapsed time while live', async () => {
    const defaults = createDefaultStreamServiceSettings();
    renderDock({
      settings: { zoom: { ...defaults.zoom, selectedMeetingId: meeting.id, topic: meeting.topic, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes } },
      status: { state: 'live' },
      streamingStartedAt: 100_000,
      now: 120_000,
    });
    expect(await screen.findByText('Live · 00:20')).toBeInTheDocument();
    expect(screen.getByText('Town hall')).toBeInTheDocument();
    expect(screen.getByText('meeting-1')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
    expect(screen.queryByText(/Current viewers|participants/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start output|Cancel|Stop output/i })).not.toBeInTheDocument();
  });

  it('shows a retry path after meeting load failure and recovers', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce([meeting]);
    renderDock({ listZoomMeetings: list });
    expect(await screen.findByText(/Could not load meetings:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Town hall/ })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale meeting list after reconnect supersedes it', async () => {
    const pending = deferred<ZoomMeeting[]>();
    const fresh = { ...meeting, id: 'fresh-meeting', topic: 'Fresh meeting' };
    const list = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([fresh]);
    const { api } = renderDock({ listZoomMeetings: list });
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(1));
    await selectMenuItem('Settings');
    const firstDialog = await screen.findByRole('dialog', { name: 'Zoom settings' });
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Disconnect' }));
    await screen.findByText('Not connected');
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Connect Zoom' }));
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(firstDialog).getByRole('button', { name: 'Done' })).toBeEnabled());
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /Fresh meeting/ })).toBeInTheDocument();

    await act(async () => { pending.resolve([{ ...meeting, id: 'stale-meeting', topic: 'Stale meeting' }]); await pending.promise; });
    expect(screen.queryByRole('button', { name: /Stale meeting/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh meetings' })).toBeEnabled();
  });

  it('uses concise account and output failure messages', async () => {
    renderDock({
      getZoomAccount: () => Promise.reject(new Error("Error invoking remote method 'stream:connect-zoom-account': Error: Zoom account connection is not configured. Set LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID and rebuild LumaStream.")),
      status: { state: 'error', outputId: 'zoom', message: 'Zoom Meeting SDK reported an error (code 100). /private/path' },
    });
    expect(await screen.findByText('Zoom sign-in is not available in this version of LumaStream. Contact your administrator to enable it.')).toBeInTheDocument();
    expect(screen.getByText('Zoom output could not start on this device. Check the selected meeting and permissions, then try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Error invoking|LUMASTREAM|SDK reported|private\/path/)).not.toBeInTheDocument();
  });
});
