import { describe, expect, it } from 'vitest';
import { mergeSourceStatuses } from '../../../../apps/stream/renderer/source-availability';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

function source(id: string, kind: StreamSource['kind']): StreamSource {
  return {
    id,
    name: id,
    kind,
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 10, height: 10 },
    ...(kind === 'image' ? { assetId: 'asset-1' } : {}),
  };
}

describe('mergeSourceStatuses', () => {
  it('keeps a missing or undecodable image unavailable when its capture graph is ready', () => {
    const image = source('image-runtime', 'image');
    expect(mergeSourceStatuses([image], { [image.id]: { state: 'ready' } }, {
      [image.id]: { state: 'unavailable', message: 'The image asset could not be loaded.' },
    })).toEqual({ [image.id]: { state: 'unavailable', message: 'The image asset could not be loaded.' } });
  });

  it('keeps a capture failure unavailable even when its media resource loaded', () => {
    const microphone = source('mic-runtime', 'microphone');
    expect(mergeSourceStatuses([microphone], {
      [microphone.id]: { state: 'unavailable', message: 'Device disconnected.' },
    }, { [microphone.id]: { state: 'ready' } })).toEqual({
      [microphone.id]: { state: 'unavailable', message: 'Device disconnected.' },
    });
  });

  it('reports ready only when every reported readiness component is ready', () => {
    const clip = source('clip-runtime', 'media');
    expect(mergeSourceStatuses([clip], { [clip.id]: { state: 'ready' } }, { [clip.id]: { state: 'ready' } })).toEqual({
      [clip.id]: { state: 'ready' },
    });
  });

  it('keeps a pending asset decode in the starting state', () => {
    const image = source('pending-image', 'image');
    expect(mergeSourceStatuses([image], {}, { [image.id]: { state: 'starting' } })).toEqual({
      [image.id]: { state: 'starting' },
    });
  });
});
