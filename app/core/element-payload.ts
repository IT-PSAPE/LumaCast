import type {
  SlideElement,
  SlideElementPayload,
  ShapeElementPayload,
  TextElementPayload,
  TextCaseTransform,
  TextHorizontalAlign,
  TextVerticalAlign,
  StrokePosition,
} from './types';

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
  const basePatch = {
    visible: next.visible,
    locked: next.locked,
    flipX: next.flipX,
    flipY: next.flipY,
    shadowEnabled: next.shadowEnabled,
    shadowColor: next.shadowColor,
    shadowBlur: next.shadowBlur,
    shadowOffsetX: next.shadowOffsetX,
    shadowOffsetY: next.shadowOffsetY,
    strokeEnabled: next.strokeEnabled,
    strokeColor: next.strokeColor,
    strokeWidth: next.strokeWidth,
    strokePosition: next.strokePosition,
    fillEnabled: next.fillEnabled,
  };

  if (type === 'shape') {
    const shapePayload = payload as ShapeElementPayload;
    return {
      ...shapePayload,
      ...basePatch,
      fillColor: next.fillColor,
      borderColor: next.strokeColor,
      borderWidth: next.strokeEnabled ? next.strokeWidth : 0,
      borderRadius: Math.max(0, next.borderRadius),
    };
  }
  if (type === 'text') {
    const textPayload = payload as TextElementPayload;
    return {
      ...textPayload,
      ...basePatch,
      fillColor: next.fillColor,
      borderRadius: Math.max(0, next.borderRadius),
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
