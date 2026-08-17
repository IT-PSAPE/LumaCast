// Domain primitive (#153, split from app/core/types.ts): the theme entity.
// #219 decision 2: ThemeOwnerKind and the owner-kind capability matrix answer
// a project rule (which DeckItemType accepts which theme), not a composition
// concern, so they live in ./decks.ts and ./ (see app/core/theme-capabilities.ts)
// instead of here. This module imports no project domain module.
import type { Id } from './ids';
import type { SlideBackground } from './slides';
import type { SlideElement } from './slide-elements';

export type ThemeKind = 'slides' | 'lyrics' | 'overlays';

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
