import { describe, expect, it } from 'vitest';
import {
  buildPlaylistItemOwnerColumns,
  makePlaylistItemReference,
  parsePlaylistItemReference,
  PlaylistItemReferenceError,
  toPlaylistItemOwnerColumns,
  tryParsePlaylistItemReference,
  type PlaylistItemOwnerColumns,
  type PlaylistItemReferenceType,
} from '../../../../packages/composition/src/playlist-item-reference';

const TYPES: PlaylistItemReferenceType[] = ['presentation', 'lyric'];

describe('makePlaylistItemReference', () => {
  it.each(TYPES)('constructs a reference for type "%s"', (type) => {
    expect(makePlaylistItemReference(type, 'item-1')).toEqual({ type, itemId: 'item-1' });
  });

  it('throws for an empty itemId', () => {
    expect(() => makePlaylistItemReference('presentation', '')).toThrow(PlaylistItemReferenceError);
    expect(() => makePlaylistItemReference('presentation', '')).toThrow(/non-empty itemId/);
  });

  it('includes the provided context in the error message', () => {
    expect(() => makePlaylistItemReference('lyric', '', 'entry-9')).toThrow(/for entry-9/);
  });
});

describe('toPlaylistItemOwnerColumns', () => {
  it('sets only presentationId for a presentation reference', () => {
    expect(toPlaylistItemOwnerColumns({ type: 'presentation', itemId: 'p1' })).toEqual({
      presentationId: 'p1',
      lyricId: null,
    });
  });

  it('sets only lyricId for a lyric reference', () => {
    expect(toPlaylistItemOwnerColumns({ type: 'lyric', itemId: 'l1' })).toEqual({
      presentationId: null,
      lyricId: 'l1',
    });
  });
});

describe('parsePlaylistItemReference', () => {
  it.each(TYPES)('parses a single populated owner for type "%s"', (type) => {
    const owner = buildPlaylistItemOwnerColumns(type, 'item-42');
    expect(parsePlaylistItemReference(owner)).toEqual({ type, itemId: 'item-42' });
  });

  it('throws when no owner column is populated', () => {
    const owner: PlaylistItemOwnerColumns = { presentationId: null, lyricId: null };
    expect(() => parsePlaylistItemReference(owner)).toThrow(PlaylistItemReferenceError);
    expect(() => parsePlaylistItemReference(owner)).toThrow(/missing an owner/);
  });

  it('throws when two owner columns are populated', () => {
    const owner: PlaylistItemOwnerColumns = { presentationId: 'p1', lyricId: 'l1' };
    expect(() => parsePlaylistItemReference(owner)).toThrow(/multiple owners/);
  });

  it('includes the provided context in the error message', () => {
    const owner: PlaylistItemOwnerColumns = { presentationId: null, lyricId: null };
    expect(() => parsePlaylistItemReference(owner, 'playlist entry abc')).toThrow(/for playlist entry abc/);
  });
});

describe('tryParsePlaylistItemReference', () => {
  it('returns the parsed reference for a valid owner', () => {
    expect(tryParsePlaylistItemReference({ presentationId: null, lyricId: 'l1' })).toEqual({
      type: 'lyric',
      itemId: 'l1',
    });
  });

  it('returns null instead of throwing for an invalid owner', () => {
    expect(tryParsePlaylistItemReference({ presentationId: null, lyricId: null })).toBeNull();
    expect(tryParsePlaylistItemReference({ presentationId: 'p1', lyricId: 'l1' })).toBeNull();
  });
});

describe('buildPlaylistItemOwnerColumns', () => {
  it.each(TYPES)('round-trips through owner columns for type "%s"', (type) => {
    const owner = buildPlaylistItemOwnerColumns(type, 'round-trip-id');
    expect(parsePlaylistItemReference(owner)).toEqual({ type, itemId: 'round-trip-id' });
  });
});
