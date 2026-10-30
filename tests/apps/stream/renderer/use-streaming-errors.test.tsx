import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createDefaultStreamServiceSettings, type StreamAPI, type StreamRuntimeStatus } from '../../../../apps/stream/shared/desktop-api';
import { useStreaming } from '../../../../apps/stream/renderer/features/streaming/use-streaming';

afterEach(cleanup);

describe('useStreaming provider errors', () => {
  it('sanitizes Zoom provider status and action errors while preserving RTMP status copy', async () => {
    let onStatus: ((status: StreamRuntimeStatus) => void) | undefined;
    const setActionError = vi.fn();
    const api = {
      loadStreamServiceSettings: vi.fn().mockResolvedValue(createDefaultStreamServiceSettings()),
      saveStreamServiceSettings: vi.fn().mockResolvedValue(undefined),
      onStreamStatus: vi.fn((listener: (status: StreamRuntimeStatus) => void) => {
        onStatus = listener;
        return () => { onStatus = undefined; };
      }),
    } as unknown as StreamAPI;
    const params = {
      api,
      project: null,
      programCanvasRef: { current: null },
      ensureMixer: vi.fn(),
      setActionError,
    };

    const { result, unmount } = renderHook(() => useStreaming(params));
    await waitFor(() => expect(onStatus).toBeTypeOf('function'));

    const rawZoomMessage = "Error invoking remote method 'stream:start-zoom-streaming': Error: Zoom Meeting SDK reported an error (code 100). /private/build/path";
    act(() => onStatus?.({ state: 'error', outputId: 'zoom', message: rawZoomMessage }));

    expect(result.current.outputStatuses.zoom?.message)
      .toBe('Zoom output could not start on this device. Check the selected meeting and permissions, then try again.');
    expect(setActionError).toHaveBeenLastCalledWith('Zoom output could not start on this device. Check the selected meeting and permissions, then try again.');
    expect(setActionError.mock.calls.flat().join(' ')).not.toMatch(/Error invoking|private\/build|SDK reported/);

    const rtmpMessage = 'The RTMP server rejected the stream key.';
    act(() => onStatus?.({ state: 'error', outputId: 'primary', message: rtmpMessage }));

    expect(result.current.outputStatuses.primary?.message).toBe(rtmpMessage);
    expect(setActionError).toHaveBeenLastCalledWith(rtmpMessage);
    unmount();
  });
});
