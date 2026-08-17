// Domain primitive (#153, split from app/core/types.ts): the theme entity and
// the set of owner kinds a theme can be applied to, synced to, reset against,
// or detached from.
import type { Id } from './ids';
import type { DeckItemType } from './decks';
import type { SlideBackground } from './slides';
import type { SlideElement } from './slide-elements';

export type ThemeKind = 'slides' | 'lyrics' | 'overlays';

// Deck items (presentation/lyric/talk) plus overlays, which own a theme
// outside the deck-item model.
export type ThemeOwnerKind = DeckItemType | 'overlay';

export interface Theme {
  id: Id;
  slideId: Id;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}
