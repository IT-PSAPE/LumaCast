import { describe, expect, it } from 'vitest';
import {
  UnknownMediaAssetError,
  resolveAssetIdReferences,
} from '../../../../../app/renderer/features/agent/asset-id-resolution';

const SOURCES: Record<string, string> = {
  'asset-1': 'cast-media://token-1',
  'asset-2': 'cast-media://token-2',
};

function lookup(assetId: string): string | null {
  return SOURCES[assetId] ?? null;
}

function resolve<T>(value: T): T {
  return resolveAssetIdReferences(value, lookup);
}

describe('resolveAssetIdReferences', () => {
  it('swaps assetId for src on an image reference', () => {
    expect(resolve({ type: 'image', assetId: 'asset-1' })).toEqual({ type: 'image', src: 'cast-media://token-1' });
  });

  it('swaps assetId for src on a video reference', () => {
    expect(resolve({ type: 'video', assetId: 'asset-2', loop: true })).toEqual({
      type: 'video',
      src: 'cast-media://token-2',
      loop: true,
    });
  });

  it('leaves a reference that already carries a src untouched', () => {
    const value = { type: 'image', assetId: 'asset-1', src: 'cast-media://explicit' };
    expect(resolve(value)).toEqual(value);
  });

  it('ignores assetId on a non-media type', () => {
    const value = { type: 'color', assetId: 'asset-1' };
    expect(resolve(value)).toEqual(value);
  });

  it('ignores a media type with no assetId', () => {
    const value = { type: 'image', width: 100 };
    expect(resolve(value)).toEqual(value);
  });

  it('swaps a payload-nested assetId for src, keeping type as a sibling of payload', () => {
    const input = { type: 'image', payload: { assetId: 'asset-1', fit: 'cover' } };
    expect(resolve(input)).toEqual({ type: 'image', payload: { src: 'cast-media://token-1', fit: 'cover' } });
  });

  it('swaps a payload-nested assetId for src on a video element', () => {
    const input = { type: 'video', payload: { assetId: 'asset-2', loop: true } };
    expect(resolve(input)).toEqual({ type: 'video', payload: { src: 'cast-media://token-2', loop: true } });
  });

  it('leaves a payload that already carries a src untouched', () => {
    const value = { type: 'image', payload: { assetId: 'asset-1', src: 'cast-media://explicit' } };
    expect(resolve(value)).toEqual(value);
  });

  it('ignores a payload assetId on a non-media type', () => {
    const value = { type: 'text', payload: { assetId: 'asset-1' } };
    expect(resolve(value)).toEqual(value);
  });

  it('throws naming the unknown asset id nested under payload', () => {
    expect(() => resolve({ type: 'image', payload: { assetId: 'missing' } })).toThrow(UnknownMediaAssetError);
  });

  it('resolves references nested in objects and arrays', () => {
    const input = {
      name: 'Theme',
      background: { type: 'image', assetId: 'asset-1' },
      elements: [
        { type: 'text', payload: { text: 'hi' } },
        { type: 'video', assetId: 'asset-2', zIndex: 3 },
      ],
    };
    expect(resolve(input)).toEqual({
      name: 'Theme',
      background: { type: 'image', src: 'cast-media://token-1' },
      elements: [
        { type: 'text', payload: { text: 'hi' } },
        { type: 'video', src: 'cast-media://token-2', zIndex: 3 },
      ],
    });
  });

  it('throws naming the unknown asset id', () => {
    expect(() => resolve({ type: 'image', assetId: 'missing' })).toThrow(UnknownMediaAssetError);
    expect(() => resolve({ elements: [{ type: 'video', assetId: 'missing' }] })).toThrow(/missing/);
  });

  it('does not mutate its input', () => {
    const input = { type: 'image', assetId: 'asset-1' };
    resolve(input);
    expect(input).toEqual({ type: 'image', assetId: 'asset-1' });
  });

  it('passes primitives and null through unchanged', () => {
    expect(resolve(null)).toBeNull();
    expect(resolve('text')).toBe('text');
    expect(resolve(7)).toBe(7);
    expect(resolve([1, 'two', null])).toEqual([1, 'two', null]);
  });
});
