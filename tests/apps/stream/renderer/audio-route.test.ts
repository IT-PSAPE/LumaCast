import { describe, expect, it, vi } from 'vitest';
import { audioRouteOutputGains, connectAudioInput, gainFromDecibels, replaceAudioInputConnection } from '../../../../apps/stream/renderer/audio-route';

function audioNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioNode;
}

describe('audio input routing', () => {
  it('connects directly to gain when neural suppression is off', () => {
    const input = audioNode();
    const gain = audioNode();

    connectAudioInput(input, gain, null);

    expect(input.connect).toHaveBeenCalledOnce();
    expect(input.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).not.toHaveBeenCalled();
  });

  it('inserts the suppression node before gain when enabled', () => {
    const input = audioNode();
    const gain = audioNode();
    const suppression = audioNode();

    connectAudioInput(input, gain, suppression);

    expect(input.connect).toHaveBeenCalledOnce();
    expect(input.connect).toHaveBeenCalledWith(suppression);
    expect(suppression.connect).toHaveBeenCalledOnce();
    expect(suppression.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).not.toHaveBeenCalled();
  });

  it('removes the suppression node and restores the direct connection when disabled', () => {
    const input = audioNode();
    const gain = audioNode();
    const suppression = audioNode();

    replaceAudioInputConnection(input, gain, suppression, null);

    expect(input.disconnect).toHaveBeenCalledOnce();
    expect(input.disconnect).toHaveBeenCalledWith(suppression);
    expect(suppression.disconnect).toHaveBeenCalledOnce();
    expect(suppression.disconnect).toHaveBeenCalledWith(gain);
    expect(input.connect).toHaveBeenCalledOnce();
    expect(input.connect).toHaveBeenCalledWith(gain);
  });
});

describe('audio gain conversion', () => {
  it('keeps unity gain at 0 dB', () => {
    expect(gainFromDecibels(0)).toBe(1);
  });

  it('converts positive and negative decibels to linear gain', () => {
    expect(gainFromDecibels(6)).toBeCloseTo(1.995, 2);
    expect(gainFromDecibels(-6)).toBeCloseTo(0.501, 2);
  });
});

describe('Program audio output policy', () => {
  it('keeps both Program and monitor outputs closed unless the source is explicitly in Program', () => {
    expect(audioRouteOutputGains(false, 'both')).toEqual({ program: 0, monitor: 0 });
    expect(audioRouteOutputGains(false, 'monitor-only')).toEqual({ program: 0, monitor: 0 });
  });

  it('routes only the configured output for an active Program source', () => {
    expect(audioRouteOutputGains(true, 'off')).toEqual({ program: 1, monitor: 0 });
    expect(audioRouteOutputGains(true, 'both')).toEqual({ program: 1, monitor: 1 });
    expect(audioRouteOutputGains(true, 'monitor-only')).toEqual({ program: 0, monitor: 1 });
  });
});
