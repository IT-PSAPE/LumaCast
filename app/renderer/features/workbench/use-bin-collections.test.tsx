import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCast } from '@renderer/contexts/app-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useBinCollections } from './use-bin-collections';

vi.mock('@renderer/contexts/app-context', () => ({ useCast: vi.fn() }));
vi.mock('@renderer/contexts/use-project-content', () => ({ useProjectContent: vi.fn() }));

const useCastMock = vi.mocked(useCast);
const useProjectContentMock = vi.mocked(useProjectContent);

function makeCollection(id: string, name: string, isDefault = false) {
  return {
    id,
    binKind: 'image' as const,
    name,
    order: isDefault ? 0 : 1,
    isDefault,
    createdAt: '',
    updatedAt: '',
  };
}

describe('useBinCollections', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCastMock.mockReturnValue({
      mutatePatch: vi.fn(),
      setStatusText: vi.fn(),
    } as never);
  });

  it('persists and restores an explicit all-collections selection', async () => {
    useProjectContentMock.mockReturnValue({
      collectionsByBinKind: new Map([[
        'image',
        [
          makeCollection('default-image', 'Default Collection', true),
          makeCollection('collection-2', 'Events'),
        ],
      ]]),
    } as never);

    const { result } = renderHook(() => useBinCollections('image'));

    await waitFor(() => {
      expect(result.current.activeCollection?.id).toBe('default-image');
    });

    act(() => {
      result.current.setActiveCollectionId(null);
    });

    expect(result.current.activeCollection).toBeNull();
    expect(window.localStorage.getItem('lumacast.bin.activeCollection.image')).toBe('__all__');

    const { result: restored } = renderHook(() => useBinCollections('image'));
    expect(restored.current.activeCollection).toBeNull();
  });

  it('falls back to all collections when the persisted selection disappears', async () => {
    window.localStorage.setItem('lumacast.bin.activeCollection.image', 'collection-2');

    let collectionsByBinKind = new Map([[
      'image',
      [
        makeCollection('default-image', 'Default Collection', true),
        makeCollection('collection-2', 'Events'),
      ],
    ]]);

    useProjectContentMock.mockImplementation(() => ({ collectionsByBinKind } as never));

    const { result, rerender } = renderHook(() => useBinCollections('image'));

    await waitFor(() => {
      expect(result.current.activeCollection?.id).toBe('collection-2');
    });

    collectionsByBinKind = new Map([[
      'image',
      [makeCollection('default-image', 'Default Collection', true)],
    ]]);
    rerender();

    await waitFor(() => {
      expect(result.current.activeCollection).toBeNull();
    });
    expect(window.localStorage.getItem('lumacast.bin.activeCollection.image')).toBe('__all__');
  });
});
