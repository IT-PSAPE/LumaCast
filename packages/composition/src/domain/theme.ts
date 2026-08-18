// Domain primitive (#153, split from app/core/types.ts; #219 item-model
// refactor decision D2): the four per-owner theme entities. Presentation,
// lyric, talk, and overlay themes each have their own table and their own
// domain type — there is no `kind` discriminant and no union used as an
// entity. Which table/map a theme came from says what it can theme, by
// construction, so there is nothing left for a capability matrix to check
// (compare the old app/core/theme-capabilities.ts, now deleted). The four
// types share a structural shape (that's fine — see #219 decision D2) via an
// unexported base; this module imports no project domain module other than
// the slide/element shapes theme content is built from.
import type { Id } from '@lumacast/kernel';
import type { SlideBackground } from './slides';
import type { SlideElement } from './slide-elements';

interface ThemeBase {
  id: Id;
  slideId: Id;
  name: string;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type PresentationTheme = ThemeBase;
export type LyricTheme = ThemeBase;
export type TalkTheme = ThemeBase;
export type OverlayTheme = ThemeBase;
