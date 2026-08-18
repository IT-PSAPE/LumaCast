// Domain primitives (#153, split from app/core/types.ts; #219 item-model
// refactor decision D1): the three independent item entities — Presentation,
// Lyric, Talk — plus the discriminant types code uses to talk about "one of
// the three" without resurrecting a union. There is no shared exported base
// interface and no union entity: the three are separate tables in practice
// and separate, independent interfaces here. Presentation and Talk happen to
// share every field with Lyric today; that is a coincidence of their current
// shape, not a reason to unify them structurally.
import type { Id } from '@lumacast/kernel';

export type ItemType = 'presentation' | 'lyric' | 'talk';

// #219 decision D2: the set of owner types a theme can belong to. Items
// (presentation/lyric/talk) plus overlays, which own a theme outside the
// item model. This lives here (not in ./theme.ts) because it exists purely
// to answer a project rule — which owner type each theme family belongs to
// — not a composition concern.
export type ThemeOwnerType = ItemType | 'overlay';

/**
 * A typed pointer to one of the three items: `type` says which table/map to
 * resolve `id` against. Used wherever code structurally needs "one of
 * presentation | lyric | talk" — selection, playback arming, macro scope
 * contexts, drag payloads — without merging the three id spaces into one.
 */
export interface ItemRef {
  type: ItemType;
  id: Id;
}

export interface Presentation {
  id: Id;
  title: string;
  themeId?: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Lyric {
  id: Id;
  title: string;
  themeId?: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Talk {
  id: Id;
  title: string;
  themeId?: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}
