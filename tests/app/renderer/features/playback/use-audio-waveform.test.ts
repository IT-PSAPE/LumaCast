import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleWaveform, useAudioWaveform } from '../../../../../app/renderer/features/playback/use-audio-waveform';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function WaveformProbe({ src }: { src: string }) {
  const waveform = useAudioWaveform(src);
  return createElement('div', { 'data-status': waveform.status }, waveform.peaks.join(','));
}

describe('sampleWaveform', () => {
  it('normalizes real audio peaks across both channels', () => {
    expect(sampleWaveform([new Float32Array([0, .5, 0, .25]), new Float32Array([0, 0, -1, 0])], 2)).toEqual([.5, 1]);
  });
  it('handles silence and empty audio without invalid SVG coordinates', () => {
    expect(sampleWaveform([], 10)).toEqual([]);
    expect(sampleWaveform([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(sampleWaveform([new Float32Array([1])], 600)).toEqual([1]);
  });
});

describe('useAudioWaveform', () => {
  it('keeps one offline analysis running across an unmount and reuses its result', async () => {
    let resolveFetch!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    let fetchSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_src: string, options?: { signal?: AbortSignal }) => {
      fetchSignal = options?.signal;
      return new Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const liveContext = vi.fn();
    const offlineContext = vi.fn(function OfflineContext() {
      return {
        decodeAudioData: vi.fn(async () => ({
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, 0.5, 1, 0.25]),
        })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('AudioContext', liveContext);
    vi.stubGlobal('OfflineAudioContext', offlineContext);

    const first = render(createElement(WaveformProbe, { src: 'cast-media://continuous-audio' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    expect(fetchSignal?.aborted).toBe(false);
    resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

    const second = render(createElement(WaveformProbe, { src: 'cast-media://continuous-audio' }));
    await waitFor(() => expect(second.container.textContent).toBe('0,0.5,1,0.25'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(offlineContext).toHaveBeenCalledTimes(1);
    expect(liveContext).not.toHaveBeenCalled();
  });
});
