import { describe, expect, it, vi } from 'vitest';
import { routeMonitorToDevice, supportsAudioOutputSelection } from '../../../../apps/stream/renderer/monitor-device-routing';

describe('monitor output device routing', () => {
  it('routes only through the AudioContext sink selection API', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    const context = { setSinkId };
    await routeMonitorToDevice(context, 'usb-output');
    expect(setSinkId).toHaveBeenCalledExactlyOnceWith('usb-output');
  });

  it('falls back to the system device if a selected output cannot be opened', async () => {
    const failure = new DOMException('Device disconnected.', 'NotFoundError');
    const setSinkId = vi.fn().mockImplementation((deviceId: string) => deviceId ? Promise.reject(failure) : Promise.resolve());
    await expect(routeMonitorToDevice({ setSinkId }, 'usb-output')).rejects.toBe(failure);
    expect(setSinkId.mock.calls).toEqual([['usb-output'], ['']]);
  });

  it('keeps system default available when custom sink selection is unsupported', async () => {
    const context = {};
    expect(supportsAudioOutputSelection(context)).toBe(false);
    await expect(routeMonitorToDevice(context, '')).resolves.toBeUndefined();
    await expect(routeMonitorToDevice(context, 'usb-output')).rejects.toThrow('selection is unavailable');
  });
});
