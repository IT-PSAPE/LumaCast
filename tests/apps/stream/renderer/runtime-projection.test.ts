import { describe, expect, it } from 'vitest';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { getSourceRuntimeId } from '../../../../apps/stream/renderer/source-runtime';
import { projectRuntimeMap, projectRuntimeRecord } from '../../../../apps/stream/renderer/runtime-projection';

const source = { id: 'image', kind: 'slideshow', slideshowImages: [{ assetId: 'slide', assetExtension: 'png' }] } as StreamSource;
describe('runtime editor projection', () => {
  it('maps resources and slideshow image keys to logical IDs without showing a different resource revision', () => {
    const key = getSourceRuntimeId(source);
    const other = { ...source, slideshowImages: [{ assetId: 'replacement', assetExtension: 'png' }] };
    const values = new Map([[key, 'capture'], [`${key}:slide`, 'image'], [getSourceRuntimeId(other), 'replacement']]);
    expect(projectRuntimeMap([source], values)).toEqual(new Map([['image', 'capture'], ['image:slide', 'image']]));
    expect(projectRuntimeRecord([other], { [key]: 0.7, [getSourceRuntimeId(other)]: 0.2 })).toEqual({ image: 0.2 });
  });
});
