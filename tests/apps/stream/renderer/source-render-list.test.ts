import { describe, expect, it } from 'vitest';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { getRenderableSources } from '../../../../apps/stream/renderer/source-render-list';

function source(id: string, kind: StreamSource['kind'] = 'image', overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind,
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

describe('getRenderableSources', () => {
  it('preserves stacking order while expanding visible groups', () => {
    const sources = [
      source('back'),
      source('group', 'group', { children: [source('group-back'), source('group-front')] }),
      source('front'),
    ];

    expect(getRenderableSources(sources).map((item) => item.id)).toEqual(['back', 'group-back', 'group-front', 'front']);
  });

  it('omits hidden and audio-only sources from video composition', () => {
    const sources = [
      source('group', 'group', { children: [source('image')] }),
      source('hidden', 'group', { visible: false, children: [source('hidden-image')] }),
      source('microphone', 'microphone'),
    ];

    expect(getRenderableSources(sources)).toEqual([sources[0]?.children?.[0]]);
  });
});
