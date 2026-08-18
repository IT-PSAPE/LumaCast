import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ItemRef } from '@lumacast/composition';
import { useDuplicateItem } from './features/items/deck-bin-panel';

// Covers #219 item-model refactor decision D1: duplication is per-type
// (presentation|lyric only — there is no `duplicateTalk`), so
// `useDuplicateItem` returns `null` for a talk `ItemRef` structurally rather
// than throwing at call time. This exercises the real hook, not a
// reimplementation of its gating.

const mocks = vi.hoisted(() => ({
  cast: { mutatePatch: null as unknown, setStatusText: null as unknown },
  navigation: { browseItem: null as unknown },
}));

vi.mock('./contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.cast.mutatePatch,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('./contexts/navigation-context', () => ({
  useNavigation: () => ({
    browseItem: mocks.navigation.browseItem,
  }),
}));

function setup() {
  const mutatePatch = vi.fn(async (action: () => Promise<unknown>) => action());
  const setStatusText = vi.fn();
  const browseItem = vi.fn();
  mocks.cast.mutatePatch = mutatePatch;
  mocks.cast.setStatusText = setStatusText;
  mocks.navigation.browseItem = browseItem;
  return { mutatePatch, setStatusText, browseItem };
}

afterEach(() => {
  cleanup();
});

describe('useDuplicateItem', () => {
  it('returns null for a talk, hiding duplication entirely rather than exposing a callback that would fail', () => {
    setup();
    const talkRef: ItemRef = { type: 'talk', id: 'TALK-1' };

    const { result } = renderHook(() => useDuplicateItem(talkRef, 'My Talk'));

    expect(result.current).toBeNull();
  });

  it('duplicates a presentation with one IPC call carrying its typed ref, and browses to the returned itemId', async () => {
    const { browseItem, setStatusText } = setup();
    const duplicateItem = vi.fn().mockResolvedValue({
      itemId: 'DUP-1',
      // Deliberately an empty-ish patch: the selected id must come from the
      // result's itemId, never inferred by diffing entity arrays.
      patch: { version: 2, upserts: {}, deletes: {} },
    });
    (window as unknown as { castApi: Record<string, unknown> }).castApi = { duplicateItem };
    const presentationRef: ItemRef = { type: 'presentation', id: 'SRC-1' };

    const { result } = renderHook(() => useDuplicateItem(presentationRef, 'Deck'));
    await act(async () => {
      await result.current!();
    });

    expect(duplicateItem).toHaveBeenCalledTimes(1);
    expect(duplicateItem).toHaveBeenCalledWith({ type: 'presentation', id: 'SRC-1' });
    expect(browseItem).toHaveBeenCalledWith({ type: 'presentation', id: 'DUP-1' });
    expect(setStatusText).toHaveBeenCalledWith('Duplicated "Deck"');
  });

  it('duplicates a lyric, applying the returned patch before browsing to the duplicate', async () => {
    const { browseItem } = setup();
    const patch = { version: 2, upserts: { lyrics: [{ id: 'DUP-2', title: 'Song Copy' }] }, deletes: {} };
    const duplicateItem = vi.fn().mockResolvedValue({ itemId: 'DUP-2', patch });
    (window as unknown as { castApi: Record<string, unknown> }).castApi = { duplicateItem };
    const lyricRef: ItemRef = { type: 'lyric', id: 'SRC-2' };

    let appliedPatch: unknown;
    mocks.cast.mutatePatch = vi.fn(async (action: () => Promise<unknown>) => {
      appliedPatch = await action();
      return appliedPatch;
    });

    const { result } = renderHook(() => useDuplicateItem(lyricRef, 'Song'));

    await act(async () => {
      await result.current!();
    });

    expect(duplicateItem).toHaveBeenCalledWith({ type: 'lyric', id: 'SRC-2' });
    expect(appliedPatch).toEqual(patch);
    expect(browseItem).toHaveBeenCalledWith({ type: 'lyric', id: 'DUP-2' });
  });

  it('reports the failure and never browses when the IPC call rejects', async () => {
    const { browseItem, setStatusText } = setup();
    const duplicateItem = vi.fn().mockRejectedValue(new Error('boom'));
    (window as unknown as { castApi: Record<string, unknown> }).castApi = { duplicateItem };
    const presentationRef: ItemRef = { type: 'presentation', id: 'SRC-3' };

    const { result } = renderHook(() => useDuplicateItem(presentationRef, 'Deck'));
    await act(async () => {
      await result.current!();
    });

    expect(browseItem).not.toHaveBeenCalled();
    expect(setStatusText).toHaveBeenCalledWith('Failed to duplicate: boom');
  });
});
