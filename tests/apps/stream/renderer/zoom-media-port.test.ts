import { describe, expect, it, vi } from 'vitest';
import { postZoomMediaMessage } from '../../../../apps/stream/renderer/features/streaming/zoom-media-port';

describe('postZoomMediaMessage', () => {
  it.each([
    ['video', { type: 'video', width: 2, height: 2 }],
    ['PCM audio', { type: 'audio', sampleRate: 48_000, channels: 2 }],
  ] as const)('clones the %s envelope without an ArrayBuffer transfer list', (_label, envelope) => {
    const data = new ArrayBuffer(4);
    const message = { ...envelope, data };
    const postMessage = vi.fn();

    postZoomMediaMessage({ postMessage }, message);

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledWith(message);
    expect(data.byteLength).toBe(4);
  });
});
