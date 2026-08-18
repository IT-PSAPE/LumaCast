// Domain primitives (#153, split from app/core/types.ts): the slide entity,
// its background model, and the talk-script blocks a slide owns.
import type { Id } from '@lumacast/kernel';

export type SlideKind = 'presentation' | 'lyric' | 'talk' | 'theme' | 'overlay' | 'stage';

export type SlideBackgroundFit = 'cover' | 'contain' | 'fill';

export interface GradientStop {
  color: string;
  position: number; // 0–100
}

export interface SlideGradient {
  kind: 'linear' | 'radial';
  angle?: number; // degrees, linear only (measured from +x axis)
  stops: GradientStop[]; // at least 2, ordered by position
}

export type SlideBackground =
  | { type: 'color'; color: string }
  | { type: 'gradient'; gradient: SlideGradient }
  | { type: 'image'; mediaAssetId: Id | null; src: string; fit: SlideBackgroundFit }
  | { type: 'video'; mediaAssetId: Id | null; src: string; fit: SlideBackgroundFit };

export type SlideBackgroundSource = 'theme' | 'local';

export interface Slide {
  id: Id;
  background?: SlideBackground | null;
  backgroundSource: SlideBackgroundSource;
  // Exactly one of the parent FKs is set; the rest are null.
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  themeId: Id | null;
  overlayId: Id | null;
  stageId: Id | null;
  kind: SlideKind;
  width: number;
  height: number;
  notes: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TalkScriptBlock {
  id: Id;
  slideId: Id;
  text: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}
