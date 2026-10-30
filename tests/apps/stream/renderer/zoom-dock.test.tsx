import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultStreamServiceSettings, type StreamAPI, type StreamRuntimeStatus, type StreamServiceSettings, type ZoomAccount } from '../../../../apps/stream/shared/desktop-api';
import { ZoomDock } from '../../../../apps/stream/renderer/docks/zoom-dock';

afterEach(cleanup);
const account = { userId: 'zoom-user', displayName: 'Host', email: 'host@example.com' };
const meeting = { id: 'meeting-1', topic: 'Town hall', startTime: '2030-10-20T14:00:00Z', durationMinutes: 60, status: 'waiting' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderDock({ settings: patch, getZoomAccount = () => Promise.resolve(account), listZoomMeetings = () => Promise.resolve([meeting]), status = { state: 'stopped' } }: {
  settings?: Partial<StreamServiceSettings>;
  getZoomAccount?: () => Promise<ZoomAccount | null>;
  listZoomMeetings?: () => Promise<typeof meeting[]>;
  status?: StreamRuntimeStatus;
} = {}) {
  const settings: StreamServiceSettings = { ...createDefaultStreamServiceSettings(), ...patch };
  const onChange = vi.fn(); const onGoLive = vi.fn(); const onStopStreaming = vi.fn();
  const api = {
    getZoomAccount: vi.fn(getZoomAccount), connectZoomAccount: vi.fn().mockResolvedValue(account), disconnectZoomAccount: vi.fn().mockResolvedValue(undefined),
    listZoomMeetings: vi.fn(listZoomMeetings), createZoomMeeting: vi.fn().mockResolvedValue({ ...meeting, id: 'meeting-2', topic: 'Product launch' }),
  } as unknown as StreamAPI;
  render(<ZoomDock api={api} settings={settings} onChange={onChange} status={status} onGoLive={onGoLive} onStopStreaming={onStopStreaming} onHide={vi.fn()} />);
  return { api, settings, onChange, onGoLive, onStopStreaming };
}

describe('ZoomDock', () => {
  it('opens settings before connecting and loads meetings after explicit connect', async () => {
    const { api } = renderDock({ getZoomAccount: () => Promise.resolve(null) });
    const connectButtons = await screen.findAllByRole('button', { name: 'Connect Zoom' });
    fireEvent.click(connectButtons[0]);
    const dialogConnectButtons = await screen.findAllByRole('button', { name: 'Connect Zoom' });
    fireEvent.click(dialogConnectButtons[dialogConnectButtons.length - 1]);
    await waitFor(() => expect(api.connectZoomAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('combobox', { name: 'Scheduled meeting' })).toBeInTheDocument();
  }, 15_000);

  it('creates from a local modal draft and selects the meeting on success', async () => {
    const settings = { zoom: { ...createDefaultStreamServiceSettings().zoom, topic: 'Product launch' } };
    const { api, onChange } = renderDock({ settings });
    await screen.findByRole('combobox', { name: 'Scheduled meeting' });
    fireEvent.click(screen.getByRole('button', { name: 'New meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    await waitFor(() => expect(api.createZoomMeeting).toHaveBeenCalledTimes(1));
    expect(api.createZoomMeeting).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Product launch', durationMinutes: 60, startTime: expect.any(String) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.objectContaining({ selectedMeetingId: 'meeting-2', topic: 'Product launch' }) }));
  });

  it('validates required topic and keeps the creation error in the dialog', async () => {
    const { api } = renderDock();
    await screen.findByRole('combobox', { name: 'Scheduled meeting' });
    vi.mocked(api.createZoomMeeting).mockRejectedValueOnce(new Error('Zoom rejected the meeting'));
    fireEvent.click(screen.getByRole('button', { name: 'New meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    expect(await screen.findByText('Enter a meeting topic.')).toBeInTheDocument();
    expect(api.createZoomMeeting).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Topic' }), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2020-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    expect(await screen.findByText('Choose a future start time.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2030-10-20T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
    expect(await screen.findByText('Could not create the Zoom meeting. Check the details and try again.')).toBeInTheDocument();
  });

  it('keeps output stop and cancel available while disconnected or meetings fail', async () => {
    const { onStopStreaming } = renderDock({ getZoomAccount: () => Promise.resolve(null), status: { state: 'live' } });
    expect(await screen.findByRole('button', { name: 'Stop Zoom output' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Zoom output' }));
    expect(onStopStreaming).toHaveBeenCalledTimes(1);
  });

  it('keeps cancel available during a meeting-list failure while connecting', async () => {
    const { onStopStreaming } = renderDock({ listZoomMeetings: () => Promise.reject(new Error('Network unavailable')), status: { state: 'connecting' } });
    expect(await screen.findByText(/Could not load meetings:/)).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel Zoom output' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onStopStreaming).toHaveBeenCalledTimes(1);
  });

  it('keeps the joined meeting summary fixed while output is active', async () => {
    const settings = { ...createDefaultStreamServiceSettings(), zoom: { ...createDefaultStreamServiceSettings().zoom, selectedMeetingId: meeting.id } };
    const props = { api: {
      getZoomAccount: vi.fn().mockResolvedValue(account), connectZoomAccount: vi.fn(), disconnectZoomAccount: vi.fn(),
      listZoomMeetings: vi.fn().mockResolvedValue([meeting, { ...meeting, id: 'meeting-2', topic: 'Another meeting' }]), createZoomMeeting: vi.fn(),
    } as unknown as StreamAPI, settings, onChange: vi.fn(), status: { state: 'live' as const }, onGoLive: vi.fn(), onStopStreaming: vi.fn(), onHide: vi.fn() };
    const view = render(<ZoomDock {...props} />);
    await screen.findByText('Output meeting');
    view.rerender(<ZoomDock {...props} settings={{ ...settings, zoom: { ...settings.zoom, selectedMeetingId: 'meeting-2' } }} />);
    const outputMeeting = screen.getByText('Output meeting').parentElement;
    expect(outputMeeting).toHaveTextContent('Town hall');
    expect(outputMeeting).not.toHaveTextContent('Another meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom settings' }));
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
  });

  it('shows a retry path on meeting-list failure and recovers', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce([meeting]);
    const { api } = renderDock({ listZoomMeetings: list });
    expect(await screen.findByText(/Could not load meetings:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('combobox', { name: 'Scheduled meeting' });
    expect(api.listZoomMeetings).toHaveBeenCalledTimes(2);
  });

  it('releases loading after reconnect supersedes a pending list and ignores its stale result', async () => {
    const pending = deferred<typeof meeting[]>();
    const fresh = { ...meeting, id: 'fresh-meeting', topic: 'Fresh meeting' };
    const list = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([fresh]);
    const { api } = renderDock({ listZoomMeetings: list });
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await screen.findByText('Not connected');
    const connectButtons = await screen.findAllByRole('button', { name: 'Connect Zoom' });
    fireEvent.click(connectButtons[connectButtons.length - 1]);
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const selector = await screen.findByRole('combobox', { name: 'Scheduled meeting' });
    expect(selector).toBeEnabled();
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: /fresh meeting/i })).toBeInTheDocument();
    await act(async () => { pending.resolve([{ ...meeting, id: 'stale-meeting', topic: 'Stale meeting' }]); await pending.promise; });
    expect(screen.queryByRole('option', { name: /stale meeting/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh meetings' })).toBeEnabled();
  });

  it('replaces raw Zoom IPC setup errors with concise account guidance', async () => {
    renderDock({ getZoomAccount: () => Promise.reject(new Error("Error invoking remote method 'stream:connect-zoom-account': Error: Zoom account connection is not configured. Set LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID and rebuild LumaStream.")) });

    expect(await screen.findByText('Zoom sign-in is not available in this version of LumaStream. Contact your administrator to enable it.')).toBeInTheDocument();
    expect(screen.queryByText(/Error invoking|LUMASTREAM|rebuild LumaStream/)).not.toBeInTheDocument();
  });

  it('shows sanitized output failures and uses an ellipsis for Zoom settings', async () => {
    renderDock({ status: { state: 'error', outputId: 'zoom', message: 'Zoom Meeting SDK reported an error (code 100). /private/path' } });

    expect(await screen.findByText('Zoom output could not start on this device. Check the selected meeting and permissions, then try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom settings' }).querySelector('.lucide-ellipsis')).toBeInTheDocument();
    expect(screen.queryByText(/SDK reported|private\/path/)).not.toBeInTheDocument();
  });
});
