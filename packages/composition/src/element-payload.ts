import type {
  SlideElement,
  SlideElementPayload,
  ShapeElementPayload,
  TextElementPayload,
  ImageElementPayload,
  VideoElementPayload,
  TextCaseTransform,
  TextHorizontalAlign,
  TextVerticalAlign,
  StrokePosition,
} from './domain/slide-elements';
import type { SlideBackgroundFit } from './domain/slides';

export interface VisualPayloadState {
  visible: boolean;
  locked: boolean;
  flipX: boolean;
  flipY: boolean;
  fillEnabled: boolean;
  fillColor: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokePosition: StrokePosition;
  borderRadius: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface TextFormattingState {
  fontFamily: string;
  fontSize: number;
  weight: string;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  alignment: TextHorizontalAlign;
  verticalAlign: TextVerticalAlign;
  caseTransform: TextCaseTransform;
  lineHeight: number;
  letterSpacing: number;
  autoFit: boolean;
  autoFitMaxFontSize: number;
}

export interface TextVisualState {
  color: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokePosition: StrokePosition;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

const DEFAULT_SHAPE_FILL_COLOR = '#FFFFFF';
const DEFAULT_SHAPE_STROKE_COLOR = '#111111';
const DEFAULT_SHAPE_STROKE_WIDTH = 1;
const DEFAULT_TEXT_BOX_FILL_COLOR = '#00000000';
const DEFAULT_BOX_SHADOW_COLOR = '#00000099';
const DEFAULT_BOX_SHADOW_BLUR = 12;
const DEFAULT_BOX_SHADOW_OFFSET_X = 0;
const DEFAULT_BOX_SHADOW_OFFSET_Y = 6;

/** Per-type default object-fit when an image/video element has no explicit `fit`. */
export const DEFAULT_IMAGE_FIT: SlideBackgroundFit = 'cover';
export const DEFAULT_VIDEO_FIT: SlideBackgroundFit = 'contain';

/** Resolves an image/video element's effective fit, defaulting per type when absent. */
export function readMediaFit(type: 'image' | 'video', payload: ImageElementPayload | VideoElementPayload): SlideBackgroundFit {
  return payload.fit ?? (type === 'image' ? DEFAULT_IMAGE_FIT : DEFAULT_VIDEO_FIT);
}

export function supportsVisualStyling(type: SlideElement['type']): boolean {
  return type === 'shape' || type === 'text';
}

export function readVisualPayload(type: SlideElement['type'], payload: SlideElementPayload): VisualPayloadState {
  const shapePayload = payload as Partial<ShapeElementPayload>;
  const textPayload = payload as Partial<TextElementPayload>;
  const fillColor = type === 'shape' ? shapePayload.fillColor ?? DEFAULT_SHAPE_FILL_COLOR : payload.fillColor ?? DEFAULT_TEXT_BOX_FILL_COLOR;
  const strokeColor = type === 'shape' ? shapePayload.borderColor ?? DEFAULT_SHAPE_STROKE_COLOR : payload.strokeColor ?? DEFAULT_SHAPE_STROKE_COLOR;
  const strokeWidth = type === 'shape' ? shapePayload.borderWidth ?? DEFAULT_SHAPE_STROKE_WIDTH : payload.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH;
  const borderRadius = type === 'shape' ? shapePayload.borderRadius ?? 0 : textPayload.borderRadius ?? 0;
  return {
    visible: payload.visible ?? true,
    locked: payload.locked ?? false,
    flipX: payload.flipX ?? false,
    flipY: payload.flipY ?? false,
    fillEnabled: type === 'shape' ? payload.fillEnabled ?? true : payload.fillEnabled ?? false,
    fillColor,
    strokeEnabled: type === 'shape' ? payload.strokeEnabled ?? strokeWidth > 0 : payload.strokeEnabled ?? false,
    strokeColor,
    strokeWidth,
    strokePosition: payload.strokePosition ?? 'inside',
    borderRadius,
    shadowEnabled: payload.shadowEnabled ?? false,
    shadowColor: payload.shadowColor ?? DEFAULT_BOX_SHADOW_COLOR,
    shadowBlur: payload.shadowBlur ?? DEFAULT_BOX_SHADOW_BLUR,
    shadowOffsetX: payload.shadowOffsetX ?? DEFAULT_BOX_SHADOW_OFFSET_X,
    shadowOffsetY: payload.shadowOffsetY ?? DEFAULT_BOX_SHADOW_OFFSET_Y,
  };
}

export function applyVisualPayload(type: SlideElement['type'], payload: SlideElementPayload, next: VisualPayloadState): SlideElementPayload {
  // Shared by every element type (including image/video, which have no
  // dedicated branch below): fill/stroke/shadow and the corner-radius clip
  // are visual-payload fields regardless of what draws inside the box.
  const basePatch = {
    visible: next.visible,
    locked: next.locked,
    flipX: next.flipX,
    flipY: next.flipY,
    fillEnabled: next.fillEnabled,
    fillColor: next.fillColor,
    strokeEnabled: next.strokeEnabled,
    strokeColor: next.strokeColor,
    strokeWidth: next.strokeWidth,
    strokePosition: next.strokePosition,
    borderRadius: Math.max(0, next.borderRadius),
    shadowEnabled: next.shadowEnabled,
    shadowColor: next.shadowColor,
    shadowBlur: next.shadowBlur,
    shadowOffsetX: next.shadowOffsetX,
    shadowOffsetY: next.shadowOffsetY,
  };

  if (type === 'shape') {
    const shapePayload = payload as ShapeElementPayload;
    return {
      ...shapePayload,
      ...basePatch,
      // Legacy shape-only mirrors of the shared stroke fields, still read by
      // scene-node-shape.tsx's `?? ` fallbacks.
      borderColor: next.strokeColor,
      borderWidth: next.strokeEnabled ? next.strokeWidth : 0,
    };
  }
  return { ...payload, ...basePatch };
}

export function readTextFormatting(payload: TextElementPayload): TextFormattingState {
  return {
    fontFamily: payload.fontFamily,
    fontSize: payload.fontSize,
    weight: payload.weight ?? '400',
    italic: payload.italic ?? false,
    underline: payload.underline ?? false,
    strikethrough: payload.strikethrough ?? false,
    alignment: payload.alignment ?? 'left',
    verticalAlign: payload.verticalAlign ?? 'middle',
    caseTransform: payload.caseTransform ?? 'none',
    lineHeight: payload.lineHeight ?? 1.25,
    letterSpacing: payload.letterSpacing ?? 0,
    autoFit: payload.autoFit ?? false,
    autoFitMaxFontSize: payload.autoFitMaxFontSize ?? payload.fontSize,
  };
}

export function readTextVisualPayload(payload: TextElementPayload): TextVisualState {
  return {
    color: payload.color,
    strokeEnabled: payload.textStrokeEnabled ?? false,
    strokeColor: payload.textStrokeColor ?? '#111111',
    strokeWidth: payload.textStrokeWidth ?? 1,
    strokePosition: payload.textStrokePosition ?? 'outside',
    shadowEnabled: payload.textShadowEnabled ?? false,
    shadowColor: payload.textShadowColor ?? '#00000099',
    shadowBlur: payload.textShadowBlur ?? 12,
    shadowOffsetX: payload.textShadowOffsetX ?? 0,
    shadowOffsetY: payload.textShadowOffsetY ?? 6,
  };
}

export function applyTextVisualPayload(payload: TextElementPayload, next: TextVisualState): TextElementPayload {
  return {
    ...payload,
    color: next.color,
    textStrokeEnabled: next.strokeEnabled,
    textStrokeColor: next.strokeColor,
    textStrokeWidth: next.strokeWidth,
    textStrokePosition: next.strokePosition,
    textShadowEnabled: next.shadowEnabled,
    textShadowColor: next.shadowColor,
    textShadowBlur: next.shadowBlur,
    textShadowOffsetX: next.shadowOffsetX,
    textShadowOffsetY: next.shadowOffsetY,
  };
}
