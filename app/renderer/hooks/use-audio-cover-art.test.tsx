import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useAudioCoverArt } from './use-audio-cover-art';

describe('useAudioCoverArt', () => {
  const getAudioCoverArt = vi.fn<(src: string) => Promise<string | null>>();

  async function flushCoverArtWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    getAudioCoverArt.mockReset();
    getAudioCoverArt.mockImplementation(async (src) => `cover:${src}`);
    (window as unknown as { castApi: Record<string, unknown> }).castApi = { getAudioCoverArt };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not request cover art until the row is enabled', () => {
    renderHook(({ enabled }) => useAudioCoverArt('audio-disabled', enabled), {
      initialProps: { enabled: false },
    });

    expect(getAudioCoverArt).not.toHaveBeenCalled();
  });

  it('requests cover art once a row becomes enabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAudioCoverArt('audio-enabled', enabled), {
      initialProps: { enabled: false },
    });

    rerender({ enabled: true });

    await waitFor(() => expect(result.current).toBe('cover:audio-enabled'));
    expect(getAudioCoverArt).toHaveBeenCalledTimes(1);
    expect(getAudioCoverArt).toHaveBeenCalledWith('audio-enabled');
  });

  it('evicts older cached entries once the cache reaches its cap', async () => {
    for (let index = 0; index < 80; index += 1) {
      const src = `audio-${index}`;
      const hook = renderHook(() => useAudioCoverArt(src, true));
      await flushCoverArtWork();
      expect(hook.result.current).toBe(`cover:${src}`);
      hook.unmount();
    }

    expect(getAudioCoverArt).toHaveBeenCalledTimes(80);

    const replay = renderHook(() => useAudioCoverArt('audio-0', true));
    await flushCoverArtWork();
    expect(replay.result.current).toBe('cover:audio-0');

    expect(getAudioCoverArt).toHaveBeenCalledTimes(81);
  });

  it('does not cache transient request failures permanently', async () => {
    getAudioCoverArt
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('cover:audio-retry');

    const first = renderHook(() => useAudioCoverArt('audio-retry', true));
    await act(async () => {
      await getAudioCoverArt.mock.results[0]?.value?.catch(() => undefined);
      await Promise.resolve();
    });
    expect(first.result.current).toBeNull();
    first.unmount();

    const second = renderHook(() => useAudioCoverArt('audio-retry', true));
    await waitFor(() => expect(second.result.current).toBe('cover:audio-retry'));

    expect(getAudioCoverArt).toHaveBeenCalledTimes(2);
  });
});
