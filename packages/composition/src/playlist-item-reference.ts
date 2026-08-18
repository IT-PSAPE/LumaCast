import type { Id } from '@lumacast/kernel';

/**
 * Canonical playlist-item reference kinds for this issue's scope (#109).
 * Playlist entries support only these three kinds; extending this union to
 * cover another kind requires updating every exhaustive switch in this file,
 * which fails to compile until it does.
 */
export type PlaylistItemReferenceType = 'presentation' | 'lyric' | 'talk';

/**
 * The canonical runtime type for "what a playlist entry points at." An
 * entry's own `id` is its identity; `reference.itemId` is the identity of the
 * referenced content and is independent of it.
 */
export interface PlaylistItemReference {
  type: PlaylistItemReferenceType;
  itemId: Id;
}

/**
 * The legacy nullable owner columns persisted by `playlist_entries` (and
 * mirrored by the deck-bundle export format's `DeckBundlePlaylistEntry`).
 * Persistence may retain these three columns internally, but exactly one must
 * be populated — mapping to/from `PlaylistItemReference` is the only place
 * allowed to interpret them.
 */
export interface PlaylistItemOwnerColumns {
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
}

export class PlaylistItemReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylistItemReferenceError';
  }
}

function assertNeverPlaylistItemReferenceType(value: never, context?: string): never {
  throw new PlaylistItemReferenceError(
    `Unsupported playlist item reference type${context ? ` for ${context}` : ''}: ${String(value)}`,
  );
}

/** Exhaustively validates and constructs a canonical reference. */
export function makePlaylistItemReference(
  type: PlaylistItemReferenceType,
  itemId: Id,
  context?: string,
): PlaylistItemReference {
  const suffix = context ? ` for ${context}` : '';
  if (!itemId) {
    throw new PlaylistItemReferenceError(`Playlist item reference${suffix} requires a non-empty itemId.`);
  }
  switch (type) {
    case 'presentation':
    case 'lyric':
    case 'talk':
      return { type, itemId };
    default:
      return assertNeverPlaylistItemReferenceType(type, context);
  }
}

/** Exhaustively lowers a canonical reference to the legacy owner columns. */
export function toPlaylistItemOwnerColumns(reference: PlaylistItemReference): PlaylistItemOwnerColumns {
  switch (reference.type) {
    case 'presentation':
      return { presentationId: reference.itemId, lyricId: null, talkId: null };
    case 'lyric':
      return { presentationId: null, lyricId: reference.itemId, talkId: null };
    case 'talk':
      return { presentationId: null, lyricId: null, talkId: reference.itemId };
    default:
      return assertNeverPlaylistItemReferenceType(reference.type);
  }
}

interface PopulatedOwner {
  type: PlaylistItemReferenceType;
  itemId: Id;
}

function collectPopulatedOwners(owner: PlaylistItemOwnerColumns): PopulatedOwner[] {
  const populated: PopulatedOwner[] = [];
  if (owner.presentationId) populated.push({ type: 'presentation', itemId: owner.presentationId });
  if (owner.lyricId) populated.push({ type: 'lyric', itemId: owner.lyricId });
  if (owner.talkId) populated.push({ type: 'talk', itemId: owner.talkId });
  return populated;
}

/**
 * Parses the legacy owner columns into a canonical reference, rejecting zero
 * or multiple populated owners instead of silently picking one via a `??`
 * chain — the exact pattern that previously dropped Talk entries whenever a
 * chain stopped at `presentationId ?? lyricId` without considering `talkId`.
 */
export function parsePlaylistItemReference(owner: PlaylistItemOwnerColumns, context?: string): PlaylistItemReference {
  const populated = collectPopulatedOwners(owner);
  const suffix = context ? ` for ${context}` : '';

  if (populated.length === 0) {
    throw new PlaylistItemReferenceError(
      `Playlist item reference${suffix} is missing an owner: exactly one of presentationId, lyricId, or talkId must be set.`,
    );
  }
  if (populated.length > 1) {
    throw new PlaylistItemReferenceError(
      `Playlist item reference${suffix} has multiple owners set (${populated
        .map((entry) => entry.type)
        .join(', ')}); exactly one is required.`,
    );
  }
  return populated[0];
}

/** Non-throwing variant of {@link parsePlaylistItemReference}. */
export function tryParsePlaylistItemReference(owner: PlaylistItemOwnerColumns): PlaylistItemReference | null {
  try {
    return parsePlaylistItemReference(owner);
  } catch {
    return null;
  }
}

/** Builds legacy owner columns directly from a discriminator and item id. */
export function buildPlaylistItemOwnerColumns(
  type: PlaylistItemReferenceType,
  itemId: Id,
  context?: string,
): PlaylistItemOwnerColumns {
  return toPlaylistItemOwnerColumns(makePlaylistItemReference(type, itemId, context));
}
