import type { Id } from '@lumacast/kernel';

// Renderer view models that used to live in the now-retired `@core/types`
// compatibility facade (#116/#153/#154, closed out by #219 W4). Unlike the
// domain/automation/contract families that facade re-exported, these two
// were declared directly in it — they are app-shell view state, not shared
// domain or wire types, so they land here rather than in any package.
//
// Note: `SlideBrowserMode` here (which deck item kind a slide browser view
// is showing) is a different concept from the same-named type in
// `app/renderer/types/ui.ts` (grid vs. list display mode) — kept in a
// separate module specifically to avoid that name collision.

export interface PlaybackState {
  playlistId: Id | null;
  deckItemId: Id | null;
  slideIndex: number;
}

export type SlideBrowserMode = 'library' | 'playlist' | 'deck' | 'deck-editor';
