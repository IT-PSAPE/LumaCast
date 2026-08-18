// Project-side capability matrix (#219 decision 2, split from
// app/core/themes.ts): which owner kinds a given theme kind can be applied
// to, synced to, reset against, or detached from. This answers a project
// rule (which DeckItemType — or overlay — accepts which theme), not a
// composition concern, so it lives outside the Theme/ThemeKind composition
// module and imports the project-domain DeckItemType/ThemeOwnerKind types.
//
// Single source of truth (#113/#11): no surface may maintain its own type
// list — every apply, sync, reset, detach, target-picker, menu, and
// command-availability check must derive from this function instead. There
// must be exactly one implementation.
import type { DeckItemType, ThemeOwnerKind } from './domain/decks';
import type { Theme, ThemeKind } from './domain/theme';

const OWNER_KINDS_BY_THEME_KIND: Readonly<Record<ThemeKind, readonly ThemeOwnerKind[]>> = {
  slides: ['presentation', 'talk'],
  lyrics: ['lyric'],
  overlays: ['overlay'],
};

export function isThemeCompatibleWithOwnerKind(theme: Theme, ownerKind: ThemeOwnerKind): boolean {
  return OWNER_KINDS_BY_THEME_KIND[theme.kind].includes(ownerKind);
}

// Thin, signature-stable convenience wrapper for the many existing
// deck-item-only call sites. It has no compatibility logic of its own —
// it delegates entirely to isThemeCompatibleWithOwnerKind so the capability
// matrix has exactly one implementation.
export function isThemeCompatibleWithDeckItem(theme: Theme, deckItemType: DeckItemType): boolean {
  return isThemeCompatibleWithOwnerKind(theme, deckItemType);
}
