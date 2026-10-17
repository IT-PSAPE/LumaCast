// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { duplicateSource } from '../../../../apps/stream/renderer/source-clipboard';

describe('LumaStream source clipboard', () => {
  it('copies source settings and media references into a new editable source', () => {
    const source: StreamSource = {
      id: 'image-source', name: 'Backdrop', kind: 'image', visible: true, muted: false, volume: 1,
      transform: { x: 10, y: 20, width: 1920, height: 1080 },
      crop: { top: 2, right: 3, bottom: 4, left: 5 },
      assetId: 'f53a46ac-0bd4-4cab-8ab1-3d7c5a66f0af', assetExtension: 'png',
    };

    const copy = duplicateSource(source, 'image-source-copy');
    expect(copy.id).toBe('image-source-copy');
    expect(copy.name).toBe('Copy of Backdrop');
    expect(copy.assetId).toBe(source.assetId);
    expect(copy.transform).toEqual({ x: 50, y: 60, width: 1920, height: 1080 });
    copy.crop!.left = 99;
    expect(source.crop?.left).toBe(5);
  });

  it('keeps copied source names within the project validation limit', () => {
    const source: StreamSource = {
      id: 'text-source', name: 'a'.repeat(120), kind: 'text', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 400, height: 100 }, text: 'Title', color: '#ffffff',
    };
    expect(duplicateSource(source, 'text-copy').name).toHaveLength(120);
  });
});
