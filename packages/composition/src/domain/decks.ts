// Domain primitives (#153, split from app/core/types.ts): deck item family
// (presentation / lyric / talk) and its shared kind discriminant.
import type { Id } from '@lumacast/kernel';

export type DeckItemType = 'presentation' | 'lyric' | 'talk';

// #219 decision 2: the set of owner kinds a theme can be applied to, synced
// to, reset against, or detached from. Deck items (presentation/lyric/talk)
// plus overlays, which own a theme outside the deck-item model. This lives
// here (not in ./theme.ts) because it exists purely to answer a project rule
// — which DeckItemType accepts which theme kind — not a composition concern.
export type ThemeOwnerKind = DeckItemType | 'overlay';

interface DeckItemBase {
  id: Id;
  title: string;
  themeId?: Id | null;
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Presentation extends DeckItemBase {
  type: 'presentation';
}

export interface Lyric extends DeckItemBase {
  type: 'lyric';
}

export interface Talk extends DeckItemBase {
  type: 'talk';
}

export type DeckItem = Presentation | Lyric | Talk;
