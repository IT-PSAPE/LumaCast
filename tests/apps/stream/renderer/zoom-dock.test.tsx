import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultStreamServiceSettings, type StreamAPI, type StreamServiceSettings } from '../../../../apps/stream/shared/desktop-api';
import { ZoomDock } from '../../../../apps/stream/renderer/docks/zoom-dock';

afterEach(cleanup);

function renderDock(overrides: { settings?: Partial<StreamServiceSettings>; getZoomAccount?: () => Promise<any> } = {}) {
  const settings: StreamServiceSettings = { ...createDefaultStreamServiceSettings(), ...overrides.settings };
  const onChange = vi.fn();
  const api = {
    getZoomAccount: vi.fn(overrides.getZoomAccount ?? (() => Promise.resolve(null))),
    connectZoomAccount: vi.fn().mockResolvedValue({ userId: 'zoom-user', displayName: 'Host', email: 'host@example.com' }),
    disconnectZoomAccount: vi.fn().mockResolvedValue(undefined),
    listZoomMeetings: vi.fn().mockResolvedValue([{ id: 'meeting-1', topic: 'Town hall', startTime: '2026-10-20T14:00:00Z', durationMinutes: 60, status: 'waiting' }]),
    createZoomMeeting: vi.fn().mockResolvedValue({ id: 'meeting-2', topic: 'Product launch', startTime: '2026-10-21T14:00:00Z', durationMinutes: 45, status: 'waiting' }),
  } as unknown as StreamAPI;
  render(<ZoomDock api={api} settings={settings} onChange={onChange} status={{ state: 'stopped' }} onHide={vi.fn()} />);
  return { api, settings, onChange };
}

describe('ZoomDock', () => {
  it('connects the account and loads scheduled meetings', async () => {
    const { api } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: /connect zoom/i }));
    expect(await screen.findByText('Host · host@example.com')).toBeInTheDocument();
    // Meetings live in the package Select's popup; open the trigger to reach the options.
    const trigger = await screen.findByRole('combobox', { name: 'Scheduled meeting' });
    await waitFor(() => expect(api.listZoomMeetings).toHaveBeenCalledTimes(1));
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: /town hall/i })).toBeInTheDocument();
    expect(api.connectZoomAccount).toHaveBeenCalledTimes(1);
    expect(api.listZoomMeetings).toHaveBeenCalledTimes(1);
  });

  it('creates a scheduled meeting and selects it for the Zoom destination', async () => {
    const { api, settings, onChange } = renderDock({
      settings: { zoom: { ...createDefaultStreamServiceSettings().zoom, topic: 'Product launch' } },
      getZoomAccount: () => Promise.resolve({ userId: 'zoom-user', displayName: 'Host', email: 'host@example.com' }),
    });
    await screen.findByText('Host · host@example.com');
    fireEvent.click(screen.getByRole('button', { name: /create meeting/i }));

    await waitFor(() => expect(api.createZoomMeeting).toHaveBeenCalledTimes(1));
    expect(api.createZoomMeeting).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Product launch', durationMinutes: 60, startTime: expect.any(String) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.objectContaining({ selectedMeetingId: 'meeting-2' }) }));
    expect(settings.zoom.selectedMeetingId).toBe('');
  });
});
