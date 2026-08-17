// Domain primitives (#153, split from app/core/types.ts): the slide-element
// family — every visual object a slide, theme, overlay, or stage can own —
// plus the payload variants and text-binding shapes it carries.
import type { RichBody } from '../rich-text/types';
import type { Id } from './ids';

export type SlideElementType = 'text' | 'image' | 'video' | 'shape' | 'group';

export interface SlideElementBase {
  id: Id;
  slideId: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  layer: 'background' | 'media' | 'content';
  createdAt: string;
  updatedAt: string;
}

export type TextHorizontalAlign = CanvasTextAlign | 'justify';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';
export type TextCaseTransform = 'none' | 'uppercase' | 'sentence';
export type StrokePosition = 'inside' | 'center' | 'outside';

export type TextBindingKind =
  | 'timer'
  | 'clock'
  | 'current-slide-text'
  | 'next-slide-text'
  | 'slide-notes'
  | 'talk-script-current'
  | 'talk-script-progress';

export type ClockFormat = '12h' | '12h-seconds' | '24h' | '24h-seconds';
export type TimerFormat = 'mm:ss' | 'hh:mm:ss';

export interface TextBinding {
  kind: TextBindingKind;
  timerDurationSeconds?: number;
  timerFormat?: TimerFormat;
  clockFormat?: ClockFormat;
}

export interface ElementVisualPayload {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  fillEnabled?: boolean;
  fillColor?: string;
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  strokePosition?: StrokePosition;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface TextElementPayload extends ElementVisualPayload {
  text: string;
  borderRadius?: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  alignment: TextHorizontalAlign;
  verticalAlign?: TextVerticalAlign;
  autoFit?: boolean;
  autoFitMaxFontSize?: number;
  caseTransform?: TextCaseTransform;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  lineHeight?: number;
  weight?: string;
  textStrokeEnabled?: boolean;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  textStrokePosition?: StrokePosition;
  textShadowEnabled?: boolean;
  textShadowColor?: string;
  textShadowBlur?: number;
  textShadowOffsetX?: number;
  textShadowOffsetY?: number;
  binding?: TextBinding;
  // Rich Text (see app/core/rich-text). Additive & optional: absent ⇒ 'plain'.
  // When format === 'rich', richBody is the authored content; `text` stays the
  // newline-joined plain-text projection (fallback + the resolved value for bindings).
  format?: 'plain' | 'rich';
  richBody?: RichBody;
}

export interface ImageElementPayload extends ElementVisualPayload {
  src: string;
}

export interface VideoElementPayload extends ElementVisualPayload {
  src: string;
  autoplay: boolean;
  loop: boolean;
  muted?: boolean;
  playbackRate?: number;
}

export interface ShapeElementPayload extends ElementVisualPayload {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
}

export interface GroupElementPayload extends ElementVisualPayload {
  children: SlideElement[];
}

export type SlideElementPayload =
  | TextElementPayload
  | ImageElementPayload
  | VideoElementPayload
  | ShapeElementPayload
  | GroupElementPayload;

export interface SlideElement extends SlideElementBase {
  payload: SlideElementPayload;
  /** ID of the theme element this was derived from, if any. Null for user-created elements. */
  sourceThemeElementId?: Id | null;
}
