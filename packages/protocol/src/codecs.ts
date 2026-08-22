import type { CueClearLayer, CuePayload, LifecycleAction } from '@lumacast/automation';
import type { SlideBackground, SlideElement, SlideElementPayload, SlideElementType, OverlayAnimation, ItemType, ThemeOwnerType } from '@lumacast/composition';
import type {
  CueCreateInput,
  CueUpdateInput,
  BundleExportOptions,
  ElementCreateInput,
  ElementUpdateInput,
  MacroCreateInput,
  MacroUpdateInput,
  MediaAssetCreateInput,
  OverlayCreateInput,
  OverlayUpdateInput,
  SlideBackgroundUpdateInput,
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  TalkScriptBlockCreateInput,
  TalkScriptBlockOrderUpdateInput,
  TalkScriptBlockUpdateInput,
  ThemeCreateInput,
  ThemeUpdateInput,
  TriggerBindingCreateInput,
} from './rpc-inputs';
import type { AppSnapshot, BundleBrokenReferenceDecision } from './rpc-results';
import type { NdiFrameDropReasonCounts, NdiFrameTelemetry, NdiOutputConfig, NdiOutputConfigMap, NdiOutputName } from './ndi-observability';
import {
  NDI_RENDERER_FRAME_DROP_REASONS,
  NDI_TAKE_KINDS,
  NDI_TAKE_REASONS,
} from './ndi-observability';
import type {
  BundleItem,
  BundleManifest,
  BundleManifestV1,
  BundleMediaReference,
  BundleOverlay,
  BundlePlaylist,
  BundlePlaylistRow,
  BundlePlaylistV1,
  BundleSlide,
  BundleStage,
  BundleTheme,
  BundleThemeV1,
} from './deck-bundle-manifest';
import type { InlineWindowMenuBounds, ItemCreateInput, ItemDuplicateInput } from './ipc';
import { createId, type Id } from '@lumacast/kernel';

/**
 * Runtime codecs for values that cross a trust boundary (issue #149, parent
 * #114): persisted JSON columns read from SQLite and the deck-bundle
 * import/export wire format. TypeScript types disappear at runtime, so these
 * small local validators are the authoritative boundary that malformed data
 * must not pass. Keep this module dependency-free; the codec cast is the only
 * place unsafe input is promoted to a typed value.
 */

export interface CodecContext {
  /** Trust boundary, e.g. 'persisted' or 'bundle-archive'. */
  boundary: string;
  /** Calling operation, e.g. 'listCues' or 'readBundleArchive'. */
  operation: string;
  /** Field path within the decoded value ('' for the root). */
  path: string;
}

export class CodecError extends Error {
  readonly boundary: string;
  readonly operation: string;
  readonly fieldPath: string;

  constructor(context: CodecContext, message: string) {
    const location = context.path ? `${context.path}: ` : '';
    super(`[${context.boundary}/${context.operation}] ${location}${message}`);
    this.name = 'CodecError';
    this.boundary = context.boundary;
    this.operation = context.operation;
    this.fieldPath = context.path;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function fail(context: CodecContext, message: string): never {
  throw new CodecError(context, message);
}

function child(context: CodecContext, segment: string | number): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${segment}` : String(segment) };
}

function expectString(value: unknown, context: CodecContext, field: string): string {
  if (typeof value !== 'string') fail(child(context, field), `must be a string, got ${describe(value)}`);
  return value;
}

function expectFiniteNumber(value: unknown, context: CodecContext, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(child(context, field), `must be a finite number, got ${describe(value)}`);
  }
  return value;
}

function expectBoolean(value: unknown, context: CodecContext, field: string): boolean {
  if (typeof value !== 'boolean') fail(child(context, field), `must be a boolean, got ${describe(value)}`);
  return value;
}

function expectArray(value: unknown, context: CodecContext, field: string): unknown[] {
  if (!Array.isArray(value)) fail(child(context, field), `must be an array, got ${describe(value)}`);
  return value;
}

function expectEnum<T extends string>(value: unknown, context: CodecContext, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(child(context, field), `must be one of [${allowed.join(', ')}], got ${describe(value)}`);
  }
  return value as T;
}

function expectNullableString(value: unknown, context: CodecContext, field: string): void {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    fail(child(context, field), `must be a string or null, got ${describe(value)}`);
  }
}

function checkOptionalFields(
  record: Record<string, unknown>,
  context: CodecContext,
  spec: Record<string, 'string' | 'number' | 'boolean' | 'record'>,
): void {
  for (const [field, kind] of Object.entries(spec)) {
    const value = record[field];
    if (value === undefined) continue;
    const ok =
      kind === 'string'
        ? typeof value === 'string'
        : kind === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : kind === 'boolean'
            ? typeof value === 'boolean'
            : isRecord(value);
    if (!ok) fail(child(context, field), `must be a ${kind}, got ${describe(value)}`);
  }
}

/** Parses a persisted JSON column and decodes it; malformed JSON fails with the codec's boundary context. */
export function decodePersisted<T>(
  json: string,
  decodeValue: (value: unknown, context: CodecContext) => T,
  context: CodecContext,
): T {
  if (typeof json !== 'string') fail(context, 'persisted value must be a JSON string');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    fail(context, `invalid JSON (${(error as Error).message})`);
  }
  return decodeValue(value, context);
}

// ---------------------------------------------------------------------------
// Slide element payloads and elements
// ---------------------------------------------------------------------------

const SLIDE_ELEMENT_TYPES: readonly SlideElementType[] = ['text', 'image', 'video', 'shape', 'group'];
const ELEMENT_LAYERS = ['background', 'media', 'content'] as const;
const TEXT_FORMATS = ['plain', 'rich'] as const;

const VISUAL_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  name: 'string',
  visible: 'boolean',
  locked: 'boolean',
  flipX: 'boolean',
  flipY: 'boolean',
  fillEnabled: 'boolean',
  fillColor: 'string',
  strokeEnabled: 'boolean',
  strokeColor: 'string',
  strokeWidth: 'number',
  strokePosition: 'string',
  shadowEnabled: 'boolean',
  shadowColor: 'string',
  shadowBlur: 'number',
  shadowOffsetX: 'number',
  shadowOffsetY: 'number',
};

const TEXT_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  ...VISUAL_OPTIONAL_FIELDS,
  borderRadius: 'number',
  verticalAlign: 'string',
  autoFit: 'boolean',
  autoFitMaxFontSize: 'number',
  caseTransform: 'string',
  italic: 'boolean',
  underline: 'boolean',
  strikethrough: 'boolean',
  lineHeight: 'number',
  weight: 'string',
  textStrokeEnabled: 'boolean',
  textStrokeColor: 'string',
  textStrokeWidth: 'number',
  textStrokePosition: 'string',
  textShadowEnabled: 'boolean',
  textShadowColor: 'string',
  textShadowBlur: 'number',
  textShadowOffsetX: 'number',
  textShadowOffsetY: 'number',
  format: 'string',
  binding: 'record',
};

const VIDEO_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  muted: 'boolean',
  playbackRate: 'number',
};

// `ShapeElementPayload` declares borderColor/borderWidth/borderRadius as
// required, but persisted and legacy data (and the renderer's own `??`
// fallbacks in scene-node-shape.tsx) already tolerate a fill-only shape.
// Only `fillColor` is enforced as required here to match that real leniency.
const SHAPE_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  borderColor: 'string',
  borderWidth: 'number',
  borderRadius: 'number',
};

const RICH_LIST_TYPES = ['bullet', 'number'] as const;

const RICH_RUN_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  color: 'string',
  weight: 'number',
  italic: 'boolean',
  underline: 'boolean',
  strikethrough: 'boolean',
};

/**
 * Decodes a `RichBody` (see app/core/rich-text/types.ts): an ordered array of
 * blocks, each an array of runs. This is an array, not a record — do not
 * route it through `checkOptionalFields`'s `'record'` kind.
 */
function decodeRichBody(value: unknown, context: CodecContext): void {
  if (!Array.isArray(value)) fail(context, `must be an array, got ${describe(value)}`);
  value.forEach((block, index) => {
    const blockContext = child(context, index);
    if (!isRecord(block)) fail(blockContext, 'must be an object');
    expectFiniteNumber(block.indent, blockContext, 'indent');
    if (block.listType !== undefined) expectEnum(block.listType, blockContext, 'listType', RICH_LIST_TYPES);
    const runs = expectArray(block.runs, blockContext, 'runs');
    runs.forEach((run, runIndex) => {
      const runContext = child(blockContext, `runs[${runIndex}]`);
      if (!isRecord(run)) fail(runContext, 'must be an object');
      expectString(run.text, runContext, 'text');
      checkOptionalFields(run, runContext, RICH_RUN_OPTIONAL_FIELDS);
    });
  });
}

/**
 * Decodes a slide element payload. The element `type` is supplied by the
 * caller (payload objects do not carry it); group children are decoded
 * recursively as full elements.
 */
export function decodeSlideElementPayload(
  value: unknown,
  type: SlideElementType,
  context: CodecContext,
): SlideElementPayload {
  if (!isRecord(value)) fail(context, 'payload must be an object');

  switch (type) {
    case 'text': {
      expectString(value.text, context, 'text');
      expectString(value.fontFamily, context, 'fontFamily');
      expectFiniteNumber(value.fontSize, context, 'fontSize');
      expectString(value.color, context, 'color');
      expectString(value.alignment, context, 'alignment');
      checkOptionalFields(value, context, TEXT_OPTIONAL_FIELDS);
      if (value.format !== undefined) expectEnum(value.format, context, 'format', TEXT_FORMATS);
      if (value.binding !== undefined) {
        const binding = value.binding as Record<string, unknown>;
        expectString(binding.kind, context, 'binding.kind');
      }
      if (value.richBody !== undefined) {
        decodeRichBody(value.richBody, child(context, 'richBody'));
      }
      break;
    }
    case 'image':
      expectString(value.src, context, 'src');
      checkOptionalFields(value, context, VISUAL_OPTIONAL_FIELDS);
      break;
    case 'video':
      expectString(value.src, context, 'src');
      expectBoolean(value.autoplay, context, 'autoplay');
      expectBoolean(value.loop, context, 'loop');
      checkOptionalFields(value, context, { ...VISUAL_OPTIONAL_FIELDS, ...VIDEO_OPTIONAL_FIELDS });
      break;
    case 'shape':
      expectString(value.fillColor, context, 'fillColor');
      checkOptionalFields(value, context, { ...VISUAL_OPTIONAL_FIELDS, ...SHAPE_OPTIONAL_FIELDS });
      break;
    case 'group': {
      const children = expectArray(value.children, context, 'children');
      children.forEach((childValue, index) => {
        decodeSlideElement(childValue, child(context, `children[${index}]`));
      });
      break;
    }
    default:
      fail(context, `unknown element type: ${String(type)}`);
  }

  return value as unknown as SlideElementPayload;
}

/** Decodes a full slide element (bundle shape: base fields plus payload). */
export function decodeSlideElement(value: unknown, context: CodecContext): SlideElement {
  if (!isRecord(value)) fail(context, 'element must be an object');
  expectString(value.id, context, 'id');
  expectString(value.slideId, context, 'slideId');
  const type = expectEnum(value.type, context, 'type', SLIDE_ELEMENT_TYPES);
  expectFiniteNumber(value.x, context, 'x');
  expectFiniteNumber(value.y, context, 'y');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.rotation, context, 'rotation');
  expectFiniteNumber(value.opacity, context, 'opacity');
  expectFiniteNumber(value.zIndex, context, 'zIndex');
  expectEnum(value.layer, context, 'layer', ELEMENT_LAYERS);
  expectString(value.createdAt, context, 'createdAt');
  expectString(value.updatedAt, context, 'updatedAt');
  expectNullableString(value.sourceThemeElementId, context, 'sourceThemeElementId');
  decodeSlideElementPayload(value.payload, type, child(context, 'payload'));
  return value as unknown as SlideElement;
}

export function decodeSlideElementPayloadJson(json: string, type: SlideElementType, context: CodecContext): SlideElementPayload {
  return decodePersisted(json, (value, ctx) => decodeSlideElementPayload(value, type, ctx), context);
}

// ---------------------------------------------------------------------------
// Slide backgrounds
// ---------------------------------------------------------------------------

const BACKGROUND_TYPES = ['color', 'gradient', 'image', 'video'] as const;
const BACKGROUND_FITS = ['cover', 'contain', 'fill'] as const;
const GRADIENT_KINDS = ['linear', 'radial'] as const;

export function decodeSlideBackground(value: unknown, context: CodecContext): SlideBackground {
  if (!isRecord(value)) fail(context, 'background must be an object');
  const type = expectEnum(value.type, context, 'type', BACKGROUND_TYPES);

  if (type === 'color') {
    expectString(value.color, context, 'color');
  } else if (type === 'gradient') {
    const gradient = value.gradient;
    if (!isRecord(gradient)) fail(child(context, 'gradient'), 'must be an object');
    expectEnum(gradient.kind, child(context, 'gradient'), 'kind', GRADIENT_KINDS);
    checkOptionalFields(gradient, child(context, 'gradient'), { angle: 'number' });
    const stops = expectArray(gradient.stops, child(context, 'gradient'), 'stops');
    if (stops.length < 2) {
      fail(child(context, 'gradient.stops'), `must have at least 2 stops, got ${stops.length}`);
    }
    stops.forEach((stop, index) => {
      if (!isRecord(stop)) fail(child(context, `gradient.stops[${index}]`), 'must be an object');
      expectString(stop.color, child(context, `gradient.stops[${index}]`), 'color');
      expectFiniteNumber(stop.position, child(context, `gradient.stops[${index}]`), 'position');
    });
  } else {
    expectNullableString(value.mediaAssetId, context, 'mediaAssetId');
    expectString(value.src, context, 'src');
    expectEnum(value.fit, context, 'fit', BACKGROUND_FITS);
  }

  return value as unknown as SlideBackground;
}

export function decodeSlideBackgroundJson(json: string, context: CodecContext): SlideBackground {
  return decodePersisted(json, decodeSlideBackground, context);
}

// ---------------------------------------------------------------------------
// Overlay animations
// ---------------------------------------------------------------------------

const ANIMATION_KINDS = ['none', 'dissolve', 'fade', 'pulse'] as const;

/**
 * Strict animation codec for persisted columns: rejects unknown kinds and
 * non-finite durations instead of coercing them. The omitted/null distinction
 * on `autoClearDurationMs` is preserved.
 */
export function decodeOverlayAnimation(value: unknown, context: CodecContext): OverlayAnimation {
  if (!isRecord(value)) fail(context, 'animation must be an object');
  expectEnum(value.kind, context, 'kind', ANIMATION_KINDS);
  const durationMs = expectFiniteNumber(value.durationMs, context, 'durationMs');
  if (durationMs < 0) fail(child(context, 'durationMs'), `must be >= 0, got ${durationMs}`);
  if (value.autoClearDurationMs !== undefined && value.autoClearDurationMs !== null) {
    const autoClear = expectFiniteNumber(value.autoClearDurationMs, context, 'autoClearDurationMs');
    if (autoClear < 0) fail(child(context, 'autoClearDurationMs'), `must be >= 0, got ${autoClear}`);
  }
  return value as unknown as OverlayAnimation;
}

export function decodeOverlayAnimationJson(json: string, context: CodecContext): OverlayAnimation {
  return decodePersisted(json, decodeOverlayAnimation, context);
}

// ---------------------------------------------------------------------------
// Cue payloads
// ---------------------------------------------------------------------------

const CUE_CLEAR_LAYERS: readonly CueClearLayer[] = ['media', 'video', 'content', 'overlay'];
const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = ['cancel', 'revert'];
const CUE_PAYLOAD_HEAD_KEYS = ['overlayId', 'assetId', 'stageId', 'layer', 'action'] as const;

export function decodeCuePayload(value: unknown, context: CodecContext): CuePayload {
  if (!isRecord(value)) fail(context, 'cue payload must be an object');

  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== 'target' && !(CUE_PAYLOAD_HEAD_KEYS as readonly string[]).includes(key)) {
      fail(child(context, key), 'unknown cue payload key');
    }
  }

  const heads = CUE_PAYLOAD_HEAD_KEYS.filter((key) => key in value);
  if (heads.length > 1) {
    fail(context, `must have exactly one payload discriminator, got [${heads.join(', ')}]`);
  }

  if (heads.length === 0) {
    if (keys.length === 0) return value as unknown as CuePayload;
    fail(context, `unexpected cue payload keys [${keys.join(', ')}]`);
  }

  const head = heads[0];
  switch (head) {
    case 'overlayId':
      expectString(value.overlayId, context, 'overlayId');
      break;
    case 'assetId':
      expectString(value.assetId, context, 'assetId');
      break;
    case 'stageId':
      expectString(value.stageId, context, 'stageId');
      break;
    case 'layer':
      expectEnum(value.layer, context, 'layer', CUE_CLEAR_LAYERS);
      break;
    case 'action':
      expectEnum(value.action, context, 'action', LIFECYCLE_ACTIONS);
      expectString(value.target, context, 'target');
      break;
  }
  return value as unknown as CuePayload;
}

export function decodeCuePayloadJson(json: string, context: CodecContext): CuePayload {
  return decodePersisted(json, decodeCuePayload, context);
}

// ---------------------------------------------------------------------------
// Deck bundle manifests (import/export boundary)
// ---------------------------------------------------------------------------

export const BUNDLE_FORMAT = 'cast-deck-bundle' as const;
export const BUNDLE_VERSION = 2 as const;
// The one prior manifest version, superseded by the #219 item-model
// refactor (decision D8: flat playlist rows, themeType-tagged themes). Read
// via `decodeLegacyBundleManifest` below and converted to the current v2
// shape by `normalizeBundleManifestV1` (wave K) — never folded into the
// generic "unsupported version" branch; a v1 document that fails the v1
// structural decode is still rejected explicitly, never silently misparsed
// against the v2 shape.
const BUNDLE_LEGACY_VERSION = 1 as const;
const BUNDLE_LEGACY_THEME_KINDS = ['slides', 'lyrics', 'overlays'] as const;

const ITEM_TYPES: readonly ItemType[] = ['presentation', 'lyric', 'talk'];
const THEME_OWNER_TYPES: readonly ThemeOwnerType[] = ['presentation', 'lyric', 'talk', 'overlay'];
const OVERLAY_TYPES = ['image', 'shape', 'text', 'video'] as const;
const BACKGROUND_SOURCES = ['theme', 'local'] as const;
const MEDIA_ELEMENT_TYPES = ['image', 'video'] as const;
const PLAYLIST_ROW_KINDS = ['item', 'separator'] as const;

function decodeMediaReferences(value: unknown, context: CodecContext): BundleMediaReference[] {
  const references = expectArray(value, context, 'mediaReferences');
  references.forEach((reference, index) => {
    if (!isRecord(reference)) fail(child(context, `mediaReferences[${index}]`), 'must be an object');
    expectString(reference.source, child(context, `mediaReferences[${index}]`), 'source');
    const elementTypes = expectArray(reference.elementTypes, child(context, `mediaReferences[${index}]`), 'elementTypes');
    elementTypes.forEach((elementType, typeIndex) => {
      expectEnum(elementType, child(context, `mediaReferences[${index}].elementTypes[${typeIndex}]`), '', MEDIA_ELEMENT_TYPES);
    });
    expectFiniteNumber(reference.occurrenceCount, child(context, `mediaReferences[${index}]`), 'occurrenceCount');
  });
  return references as BundleMediaReference[];
}

function decodeBundleSlide(value: unknown, context: CodecContext): BundleSlide {
  if (!isRecord(value)) fail(context, 'slide must be an object');
  expectString(value.id, context, 'id');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectString(value.notes, context, 'notes');
  expectFiniteNumber(value.order, context, 'order');
  if (value.background !== undefined && value.background !== null) {
    decodeSlideBackground(value.background, child(context, 'background'));
  }
  if (value.backgroundSource !== undefined) {
    expectEnum(value.backgroundSource, context, 'backgroundSource', BACKGROUND_SOURCES);
  }
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  if (value.scriptBlocks !== undefined) {
    const blocks = expectArray(value.scriptBlocks, context, 'scriptBlocks');
    blocks.forEach((block, index) => {
      if (!isRecord(block)) fail(child(context, `scriptBlocks[${index}]`), 'must be an object');
      expectString(block.id, child(context, `scriptBlocks[${index}]`), 'id');
      expectString(block.text, child(context, `scriptBlocks[${index}]`), 'text');
      expectFiniteNumber(block.order, child(context, `scriptBlocks[${index}]`), 'order');
    });
  }
  return value as unknown as BundleSlide;
}

function decodeBundleItem(value: unknown, context: CodecContext): BundleItem {
  if (!isRecord(value)) fail(context, 'item must be an object');
  expectString(value.id, context, 'id');
  expectEnum(value.type, context, 'type', ITEM_TYPES);
  expectString(value.title, context, 'title');
  expectNullableString(value.themeId, context, 'themeId');
  expectFiniteNumber(value.order, context, 'order');
  const slides = expectArray(value.slides, context, 'slides');
  slides.forEach((slide, index) => decodeBundleSlide(slide, child(context, `slides[${index}]`)));
  return value as unknown as BundleItem;
}

function decodeBundleTheme(value: unknown, context: CodecContext): BundleTheme {
  if (!isRecord(value)) fail(context, 'theme must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectEnum(value.themeType, context, 'themeType', THEME_OWNER_TYPES);
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.order, context, 'order');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  return value as unknown as BundleTheme;
}

function decodeBundleOverlay(value: unknown, context: CodecContext): BundleOverlay {
  if (!isRecord(value)) fail(context, 'overlay must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectEnum(value.type, context, 'type', OVERLAY_TYPES);
  expectFiniteNumber(value.x, context, 'x');
  expectFiniteNumber(value.y, context, 'y');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.opacity, context, 'opacity');
  expectFiniteNumber(value.zIndex, context, 'zIndex');
  expectBoolean(value.enabled, context, 'enabled');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  decodeOverlayAnimation(value.animation, child(context, 'animation'));
  return value as unknown as BundleOverlay;
}

function decodeBundleStage(value: unknown, context: CodecContext): BundleStage {
  if (!isRecord(value)) fail(context, 'stage must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.order, context, 'order');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  return value as unknown as BundleStage;
}

/**
 * Decodes one flat playlist row, discriminated on `kind`. An `'item'` row's
 * owner-exclusivity rule is applied by the single interpretation point
 * (@core/deck-bundles' `getBundlePlaylistEntryReference`), not
 * re-derived here; a `'separator'` row owns no item and carries a label and
 * color instead.
 */
function decodeBundlePlaylistRow(value: unknown, context: CodecContext): void {
  if (!isRecord(value)) fail(context, 'row must be an object');
  expectString(value.id, context, 'id');
  const kind = expectEnum(value.kind, context, 'kind', PLAYLIST_ROW_KINDS);
  expectFiniteNumber(value.order, context, 'order');
  if (kind === 'item') {
    expectNullableString(value.presentationId, context, 'presentationId');
    expectNullableString(value.lyricId, context, 'lyricId');
    expectNullableString(value.talkId, context, 'talkId');
  } else {
    expectString(value.label, context, 'label');
    expectNullableString(value.colorKey, context, 'colorKey');
  }
}

function decodeBundlePlaylist(value: unknown, context: CodecContext): BundlePlaylist {
  if (!isRecord(value)) fail(context, 'playlist must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectFiniteNumber(value.order, context, 'order');
  const rows = expectArray(value.rows, context, 'rows');
  rows.forEach((row, rowIndex) => decodeBundlePlaylistRow(row, child(context, `rows[${rowIndex}]`)));
  return value as unknown as BundlePlaylist;
}

// ---------------------------------------------------------------------------
// Legacy (v1) bundle manifest decode + normalization (#219 item-model
// refactor, wave K). `decodeBundleManifest`'s legacy branch below decodes an
// untrusted v1 document with the functions in this section, then converts it
// to the current v2 shape with `normalizeBundleManifestV1` before returning
// — every OTHER decoder in this module (and every caller of
// `decodeBundleManifest`) only ever sees v2 data.
// ---------------------------------------------------------------------------

function decodeLegacyBundleTheme(value: unknown, context: CodecContext): BundleThemeV1 {
  if (!isRecord(value)) fail(context, 'theme must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectEnum(value.kind, context, 'kind', BUNDLE_LEGACY_THEME_KINDS);
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.order, context, 'order');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  return value as unknown as BundleThemeV1;
}

function decodeLegacyBundlePlaylist(value: unknown, context: CodecContext): BundlePlaylistV1 {
  if (!isRecord(value)) fail(context, 'playlist must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectString(value.libraryName, context, 'libraryName');
  expectFiniteNumber(value.order, context, 'order');
  const groups = expectArray(value.groups, context, 'groups');
  groups.forEach((group, groupIndex) => {
    const groupContext = child(context, `groups[${groupIndex}]`);
    if (!isRecord(group)) fail(groupContext, 'must be an object');
    expectString(group.id, groupContext, 'id');
    expectString(group.name, groupContext, 'name');
    expectNullableString(group.colorKey, groupContext, 'colorKey');
    expectFiniteNumber(group.order, groupContext, 'order');
    const entries = expectArray(group.entries, groupContext, 'entries');
    entries.forEach((entry, entryIndex) => {
      const entryContext = child(groupContext, `entries[${entryIndex}]`);
      if (!isRecord(entry)) fail(entryContext, 'must be an object');
      expectString(entry.id, entryContext, 'id');
      // talkId is optional in the v1 wire shape: omitted stays omitted, null
      // stays null; owner-exclusivity is a domain rule applied downstream
      // (@lumacast/protocol's `getBundlePlaylistEntryReference`), not
      // re-derived here.
      expectNullableString(entry.presentationId, entryContext, 'presentationId');
      expectNullableString(entry.lyricId, entryContext, 'lyricId');
      if (entry.talkId !== undefined) expectNullableString(entry.talkId, entryContext, 'talkId');
      expectFiniteNumber(entry.order, entryContext, 'order');
    });
  });
  return value as unknown as BundlePlaylistV1;
}

/**
 * Decodes an untrusted v1 (pre-#219) deck-bundle manifest — the
 * nested-group, `kind`-tagged-theme, `libraryName`-carrying shape. Reuses
 * `decodeBundleItem`/`decodeBundleOverlay`/`decodeBundleStage` unchanged
 * (those shapes never changed between v1 and v2).
 */
function decodeLegacyBundleManifest(value: Record<string, unknown>, context: CodecContext): BundleManifestV1 {
  expectString(value.exportedAt, context, 'exportedAt');

  const items = expectArray(value.items, context, 'items');
  items.forEach((item, index) => decodeBundleItem(item, child(context, `items[${index}]`)));

  const themes = expectArray(value.themes, context, 'themes');
  themes.forEach((theme, index) => decodeLegacyBundleTheme(theme, child(context, `themes[${index}]`)));

  decodeMediaReferences(value.mediaReferences, context);

  if (value.overlays !== undefined) {
    const overlays = expectArray(value.overlays, context, 'overlays');
    overlays.forEach((overlay, index) => decodeBundleOverlay(overlay, child(context, `overlays[${index}]`)));
  }

  if (value.stages !== undefined) {
    const stages = expectArray(value.stages, context, 'stages');
    stages.forEach((stage, index) => decodeBundleStage(stage, child(context, `stages[${index}]`)));
  }

  if (value.playlists !== undefined) {
    const playlists = expectArray(value.playlists, context, 'playlists');
    playlists.forEach((playlist, index) => decodeLegacyBundlePlaylist(playlist, child(context, `playlists[${index}]`)));
  }

  return value as unknown as BundleManifestV1;
}

function normalizeLegacyBundlePlaylist(playlist: BundlePlaylistV1): BundlePlaylist {
  const rows: BundlePlaylistRow[] = [];
  // Canonical flattening order (decision D5, matching the SQL migration and
  // the project-backup transform): groups ordered by their own `order`, each
  // yielding one separator row (carrying its name/colorKey) followed by its
  // entries in the group's own order — every group yields a separator,
  // including an empty one. The whole flattened list is renumbered 0..n.
  const orderedGroups = playlist.groups.slice().sort((left, right) => left.order - right.order);
  for (const group of orderedGroups) {
    rows.push({ id: group.id, kind: 'separator', label: group.name, colorKey: group.colorKey, order: rows.length });
    const orderedEntries = group.entries.slice().sort((left, right) => left.order - right.order);
    for (const entry of orderedEntries) {
      rows.push({
        id: entry.id,
        kind: 'item',
        presentationId: entry.presentationId,
        lyricId: entry.lyricId,
        talkId: entry.talkId ?? null,
        order: rows.length,
      });
    }
  }
  // `libraryName` is dropped (decision D4: the library concept is gone).
  return { id: playlist.id, name: playlist.name, order: playlist.order, rows };
}

/**
 * Converts a structurally-decoded v1 (pre-#219) bundle manifest into the
 * current v2 shape (decision D8). Pure and total: never throws on a document
 * that already passed `decodeLegacyBundleManifest`.
 *
 * - `items`/`overlays`/`stages` (and their slides) are unchanged between v1
 *   and v2 — carried through verbatim.
 * - themes: `kind: 'lyrics'` → `themeType: 'lyric'`; `kind: 'overlays'` →
 *   `themeType: 'overlay'`; `kind: 'slides'` → `themeType: 'presentation'`
 *   (the base copy always lands in the presentation family), PLUS a
 *   talk-family clone — a fresh manifest-local id, identical content — for
 *   every `kind: 'slides'` theme referenced by at least one talk item (one
 *   clone per distinct source theme, shared by every talk that referenced
 *   it); every talk item referencing that source theme is repointed to the
 *   clone. `finalizeImportBundle` regenerates real ids on import regardless,
 *   so the clone's id only needs to be unique within this manifest.
 * - playlists: flattened per `normalizeLegacyBundlePlaylist`; `libraryName`
 *   dropped (decision D4).
 * - `mediaReferences` is carried through as decoded: every real consumer
 *   (`inspectImportBundle`, `finalizeImportBundle`) recomputes it itself via
 *   `collectBundleMediaReferences` before using it, so a decode-time value
 *   only needs to be structurally valid, not perfectly accurate against the
 *   post-clone element set.
 */
export function normalizeBundleManifestV1(legacy: BundleManifestV1): BundleManifest {
  const talkThemeIdsReferenced = new Set<Id>();
  for (const item of legacy.items) {
    if (item.type === 'talk' && item.themeId) talkThemeIdsReferenced.add(item.themeId);
  }

  const themes: BundleTheme[] = [];
  const talkCloneIdBySourceThemeId = new Map<Id, Id>();
  for (const theme of legacy.themes) {
    const themeType: ThemeOwnerType = theme.kind === 'lyrics' ? 'lyric' : theme.kind === 'overlays' ? 'overlay' : 'presentation';
    themes.push({ id: theme.id, name: theme.name, themeType, width: theme.width, height: theme.height, order: theme.order, elements: theme.elements });
    if (theme.kind === 'slides' && talkThemeIdsReferenced.has(theme.id)) {
      const cloneId = createId();
      talkCloneIdBySourceThemeId.set(theme.id, cloneId);
      themes.push({ id: cloneId, name: theme.name, themeType: 'talk', width: theme.width, height: theme.height, order: theme.order, elements: theme.elements });
    }
  }

  const items: BundleItem[] = legacy.items.map((item) => {
    if (item.type !== 'talk' || !item.themeId) return item;
    const cloneId = talkCloneIdBySourceThemeId.get(item.themeId);
    return cloneId ? { ...item, themeId: cloneId } : item;
  });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: legacy.exportedAt,
    items,
    themes,
    mediaReferences: legacy.mediaReferences,
    ...(legacy.overlays !== undefined ? { overlays: legacy.overlays } : {}),
    ...(legacy.stages !== undefined ? { stages: legacy.stages } : {}),
    ...(legacy.playlists !== undefined ? { playlists: legacy.playlists.map(normalizeLegacyBundlePlaylist) } : {}),
  };
}

/**
 * Decodes an untrusted deck-bundle manifest. Rejects unknown formats
 * explicitly. Version 1 (the pre-#219 nested-group shape) is decoded via
 * `decodeLegacyBundleManifest` and converted to the current v2 shape via
 * `normalizeBundleManifestV1` — a v1 document that fails that structural
 * decode is still rejected explicitly, never silently misparsed against the
 * v2 shape below. Rejects future versions explicitly, then validates the
 * full structural shape of items, themes, overlays, stages, playlists, and
 * every nested slide element, background, and animation.
 */
export function decodeBundleManifest(value: unknown, context: CodecContext): BundleManifest {
  if (!isRecord(value)) fail(context, 'manifest must be an object');

  if (value.format !== BUNDLE_FORMAT) {
    if (typeof value.format === 'string') {
      fail(context, `unsupported bundle format ${JSON.stringify(value.format)}`);
    }
    fail(context, 'bundle format must be a string');
  }
  if (value.version === BUNDLE_LEGACY_VERSION) {
    const legacy = decodeLegacyBundleManifest(value, context);
    return normalizeBundleManifestV1(legacy);
  }
  if (value.version !== BUNDLE_VERSION) {
    if (typeof value.version === 'number' && value.version > BUNDLE_VERSION) {
      fail(context, `future bundle version ${value.version} is not supported; this build supports version ${BUNDLE_VERSION}`);
    }
    fail(context, `unsupported bundle version ${describe(value.version)}; this build supports version ${BUNDLE_VERSION}`);
  }

  expectString(value.exportedAt, context, 'exportedAt');

  const items = expectArray(value.items, context, 'items');
  items.forEach((item, index) => decodeBundleItem(item, child(context, `items[${index}]`)));

  const themes = expectArray(value.themes, context, 'themes');
  themes.forEach((theme, index) => decodeBundleTheme(theme, child(context, `themes[${index}]`)));

  decodeMediaReferences(value.mediaReferences, context);

  if (value.overlays !== undefined) {
    const overlays = expectArray(value.overlays, context, 'overlays');
    overlays.forEach((overlay, index) => decodeBundleOverlay(overlay, child(context, `overlays[${index}]`)));
  }

  if (value.stages !== undefined) {
    const stages = expectArray(value.stages, context, 'stages');
    stages.forEach((stage, index) => decodeBundleStage(stage, child(context, `stages[${index}]`)));
  }

  if (value.playlists !== undefined) {
    const playlists = expectArray(value.playlists, context, 'playlists');
    playlists.forEach((playlist, index) => decodeBundlePlaylist(playlist, child(context, `playlists[${index}]`)));
  }

  return value as unknown as BundleManifest;
}

// ---------------------------------------------------------------------------
// Renderer-originated RPC inputs (issue #150, parent #114): validated in main
// (app/main/ipc.ts) before any repository call runs — a second trust
// boundary alongside the persisted-column and bundle-archive codecs above.
// Every codec here rejects unknown top-level keys: these are all either
// security-sensitive (filesystem paths, media sources, capability toggles)
// or structured payloads that would otherwise reach the repository
// unchecked, so unlike the persisted/compatibility codecs, extra keys are
// always treated as corruption, never silently ignored.
// ---------------------------------------------------------------------------

function rejectUnknownKeys(value: Record<string, unknown>, context: CodecContext, known: readonly string[]): void {
  const allowed = new Set(known);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(child(context, key), 'unknown field');
  }
}

/**
 * The single shared guard for RPC operations whose entire input is a short
 * list of primitive positional arguments (ids, names, flags, enum strings)
 * rather than a structured object — the ~50 `(id: Id)`-shaped operations the
 * type system already covers at compile time but not at runtime, once an
 * untrusted renderer controls the `ipcMain.handle` call. This is the "one
 * small shared primitive-argument guard" instead of a bespoke codec per
 * operation; anything with an object/array payload gets its own decoder
 * below instead of being forced through this generic shape.
 */
export type PrimitiveArgSpec =
  | { name: string; kind: 'string' }
  | { name: string; kind: 'nullableString' }
  | { name: string; kind: 'number' }
  | { name: string; kind: 'boolean' }
  | { name: string; kind: 'optionalBoolean' }
  | { name: string; kind: 'stringArray' }
  | { name: string; kind: 'enum'; values: readonly string[] };

function expectStringArray(value: unknown, context: CodecContext, field: string): string[] {
  const array = expectArray(value, context, field);
  const arrayContext = child(context, field);
  array.forEach((item, index) => expectString(item, arrayContext, String(index)));
  return array as string[];
}

export function expectRpcPrimitiveArgs(
  args: readonly unknown[],
  specs: readonly PrimitiveArgSpec[],
  context: CodecContext,
): void {
  specs.forEach((spec, index) => {
    const value = args[index];
    switch (spec.kind) {
      case 'string':
        expectString(value, context, spec.name);
        break;
      case 'nullableString':
        expectNullableString(value, context, spec.name);
        break;
      case 'number':
        expectFiniteNumber(value, context, spec.name);
        break;
      case 'boolean':
        expectBoolean(value, context, spec.name);
        break;
      case 'optionalBoolean':
        if (value !== undefined) expectBoolean(value, context, spec.name);
        break;
      case 'stringArray':
        expectStringArray(value, context, spec.name);
        break;
      case 'enum':
        expectEnum(value, context, spec.name, spec.values);
        break;
    }
  });
}

/** Shared 'up'/'down' direction argument used by several reorder operations. */
export const RPC_MOVE_DIRECTIONS = ['up', 'down'] as const;

/** Decodes the `{ x, y }` bounds argument of `popupInlineWindowMenu`. */
export function decodeInlineWindowMenuBounds(value: unknown, context: CodecContext): InlineWindowMenuBounds {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['x', 'y']);
  return {
    x: expectFiniteNumber(value.x, context, 'x'),
    y: expectFiniteNumber(value.y, context, 'y'),
  };
}

// ---------------------------------------------------------------------------
// Automation: cues, macros, trigger bindings. Cue payload decoding reuses
// decodeCuePayload above rather than re-validating the discriminated union.
// ---------------------------------------------------------------------------

const RPC_CUE_KINDS = [
  'overlay.activate',
  'overlay.clear',
  'overlay.clearAll',
  'mediaLayer.set',
  'video.arm',
  'video.clear',
  'audio.arm',
  'audio.clear',
  'stage.set',
  'stage.clear',
  'layer.clear',
  'layer.clearAll',
  'flow.lifecycle',
] as const;
const RPC_CUE_FAILURE_POLICIES = ['continue', 'abort'] as const;
const RPC_SCOPE_LEVELS = ['global', 'item', 'slide'] as const;
const RPC_ON_SCOPE_EXITS = ['cancel', 'revert', 'none'] as const;
const RPC_TRIGGER_TYPES = ['slide.take', 'slide.activate', 'app.startup'] as const;
const RPC_TRIGGER_BINDING_TARGET_TYPES = ['cue', 'macro'] as const;

export function decodeCueCreateInput(value: unknown, context: CodecContext): CueCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['kind', 'payload', 'failurePolicy']);
  expectEnum(value.kind, context, 'kind', RPC_CUE_KINDS);
  decodeCuePayload(value.payload, child(context, 'payload'));
  if (value.failurePolicy !== undefined) expectEnum(value.failurePolicy, context, 'failurePolicy', RPC_CUE_FAILURE_POLICIES);
  return value as unknown as CueCreateInput;
}

export function decodeCueUpdateInput(value: unknown, context: CodecContext): CueUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'kind', 'payload', 'failurePolicy']);
  expectString(value.id, context, 'id');
  if (value.kind !== undefined) expectEnum(value.kind, context, 'kind', RPC_CUE_KINDS);
  if (value.payload !== undefined) decodeCuePayload(value.payload, child(context, 'payload'));
  if (value.failurePolicy !== undefined) expectEnum(value.failurePolicy, context, 'failurePolicy', RPC_CUE_FAILURE_POLICIES);
  return value as unknown as CueUpdateInput;
}

const MACRO_CUE_ENTRY_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  delayBeforeMs: 'number',
  delayAfterMs: 'number',
};

function decodeMacroCueEntry(value: unknown, context: CodecContext, allowId: boolean): void {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, allowId ? ['id', 'cueId', 'orderIndex', 'delayBeforeMs', 'delayAfterMs'] : ['cueId', 'orderIndex', 'delayBeforeMs', 'delayAfterMs']);
  if (allowId && value.id !== undefined) expectString(value.id, context, 'id');
  expectString(value.cueId, context, 'cueId');
  expectFiniteNumber(value.orderIndex, context, 'orderIndex');
  checkOptionalFields(value, context, MACRO_CUE_ENTRY_OPTIONAL_FIELDS);
}

export function decodeMacroCreateInput(value: unknown, context: CodecContext): MacroCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'description', 'scopeLevel', 'onScopeExit', 'loopEnabled', 'loopCount', 'cues']);
  expectString(value.name, context, 'name');
  checkOptionalFields(value, context, { description: 'string', loopEnabled: 'boolean' });
  if (value.scopeLevel !== undefined) expectEnum(value.scopeLevel, context, 'scopeLevel', RPC_SCOPE_LEVELS);
  if (value.onScopeExit !== undefined) expectEnum(value.onScopeExit, context, 'onScopeExit', RPC_ON_SCOPE_EXITS);
  if (value.loopCount !== undefined && value.loopCount !== null) expectFiniteNumber(value.loopCount, context, 'loopCount');
  if (value.cues !== undefined) {
    const cues = expectArray(value.cues, context, 'cues');
    cues.forEach((cue, index) => decodeMacroCueEntry(cue, child(context, `cues[${index}]`), false));
  }
  return value as unknown as MacroCreateInput;
}

export function decodeMacroUpdateInput(value: unknown, context: CodecContext): MacroUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'name', 'description', 'scopeLevel', 'onScopeExit', 'loopEnabled', 'loopCount', 'cues']);
  expectString(value.id, context, 'id');
  checkOptionalFields(value, context, { name: 'string', description: 'string', loopEnabled: 'boolean' });
  if (value.scopeLevel !== undefined) expectEnum(value.scopeLevel, context, 'scopeLevel', RPC_SCOPE_LEVELS);
  if (value.onScopeExit !== undefined) expectEnum(value.onScopeExit, context, 'onScopeExit', RPC_ON_SCOPE_EXITS);
  if (value.loopCount !== undefined && value.loopCount !== null) expectFiniteNumber(value.loopCount, context, 'loopCount');
  if (value.cues !== undefined) {
    const cues = expectArray(value.cues, context, 'cues');
    cues.forEach((cue, index) => decodeMacroCueEntry(cue, child(context, `cues[${index}]`), true));
  }
  return value as unknown as MacroUpdateInput;
}

/**
 * `config` is intentionally free-form (`Record<string, unknown>` in the
 * domain type) — only its own type (an object) is checked, not its keys.
 */
export function decodeTriggerBindingCreateInput(value: unknown, context: CodecContext): TriggerBindingCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['triggerType', 'sourceId', 'targetType', 'targetId', 'config', 'enabled']);
  expectEnum(value.triggerType, context, 'triggerType', RPC_TRIGGER_TYPES);
  expectNullableString(value.sourceId, context, 'sourceId');
  expectEnum(value.targetType, context, 'targetType', RPC_TRIGGER_BINDING_TARGET_TYPES);
  expectString(value.targetId, context, 'targetId');
  if (value.config !== undefined && !isRecord(value.config)) {
    fail(child(context, 'config'), `must be an object, got ${describe(value.config)}`);
  }
  if (value.enabled !== undefined) expectBoolean(value.enabled, context, 'enabled');
  return value as unknown as TriggerBindingCreateInput;
}

// ---------------------------------------------------------------------------
// Slides and talk script blocks
// ---------------------------------------------------------------------------

export function decodeSlideCreateInput(value: unknown, context: CodecContext): SlideCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['presentationId', 'lyricId', 'talkId', 'width', 'height']);
  if (value.presentationId !== undefined) expectNullableString(value.presentationId, context, 'presentationId');
  if (value.lyricId !== undefined) expectNullableString(value.lyricId, context, 'lyricId');
  if (value.talkId !== undefined) expectNullableString(value.talkId, context, 'talkId');
  checkOptionalFields(value, context, { width: 'number', height: 'number' });
  return value as unknown as SlideCreateInput;
}

export function decodeSlideNotesUpdateInput(value: unknown, context: CodecContext): SlideNotesUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['slideId', 'notes']);
  expectString(value.slideId, context, 'slideId');
  expectString(value.notes, context, 'notes');
  return value as unknown as SlideNotesUpdateInput;
}

/** Reuses decodeSlideBackground for the nested `background` shape. */
export function decodeSlideBackgroundUpdateInput(value: unknown, context: CodecContext): SlideBackgroundUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['slideId', 'background']);
  expectString(value.slideId, context, 'slideId');
  if (value.background === undefined) fail(child(context, 'background'), 'must be an object or null');
  if (value.background !== null) decodeSlideBackground(value.background, child(context, 'background'));
  return value as unknown as SlideBackgroundUpdateInput;
}

export function decodeSlideOrderUpdateInput(value: unknown, context: CodecContext): SlideOrderUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['slideId', 'newOrder']);
  expectString(value.slideId, context, 'slideId');
  expectFiniteNumber(value.newOrder, context, 'newOrder');
  return value as unknown as SlideOrderUpdateInput;
}

export function decodeTalkScriptBlockCreateInput(value: unknown, context: CodecContext): TalkScriptBlockCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['slideId', 'text', 'order']);
  expectString(value.slideId, context, 'slideId');
  checkOptionalFields(value, context, { text: 'string', order: 'number' });
  return value as unknown as TalkScriptBlockCreateInput;
}

export function decodeTalkScriptBlockUpdateInput(value: unknown, context: CodecContext): TalkScriptBlockUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'text']);
  expectString(value.id, context, 'id');
  expectString(value.text, context, 'text');
  return value as unknown as TalkScriptBlockUpdateInput;
}

export function decodeTalkScriptBlockOrderUpdateInput(value: unknown, context: CodecContext): TalkScriptBlockOrderUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'newOrder']);
  expectString(value.id, context, 'id');
  expectFiniteNumber(value.newOrder, context, 'newOrder');
  return value as unknown as TalkScriptBlockOrderUpdateInput;
}

// ---------------------------------------------------------------------------
// Slide elements (create/update). Creation reuses decodeSlideElementPayload
// for full per-type payload validation, since the element `type` is known.
// ---------------------------------------------------------------------------

const ELEMENT_CREATE_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  id: 'string',
  rotation: 'number',
  opacity: 'number',
  zIndex: 'number',
};

export function decodeElementCreateInput(value: unknown, context: CodecContext): ElementCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'slideId', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'zIndex', 'layer', 'payload', 'sourceThemeElementId']);
  expectString(value.slideId, context, 'slideId');
  const type = expectEnum(value.type, context, 'type', SLIDE_ELEMENT_TYPES);
  expectFiniteNumber(value.x, context, 'x');
  expectFiniteNumber(value.y, context, 'y');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  checkOptionalFields(value, context, ELEMENT_CREATE_OPTIONAL_FIELDS);
  if (value.layer !== undefined) expectEnum(value.layer, context, 'layer', ELEMENT_LAYERS);
  if (value.sourceThemeElementId !== undefined) expectNullableString(value.sourceThemeElementId, context, 'sourceThemeElementId');
  decodeSlideElementPayload(value.payload, type, child(context, 'payload'));
  return value as unknown as ElementCreateInput;
}

const ELEMENT_UPDATE_OPTIONAL_FIELDS: Record<string, 'string' | 'number' | 'boolean' | 'record'> = {
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  rotation: 'number',
  opacity: 'number',
  zIndex: 'number',
};

/**
 * Validates the common update fields and, if `payload` is present, that it
 * is at least an object. Full per-type payload validation is NOT possible
 * here: unlike creation, an update does not carry the element's `type`, and
 * that discriminant lives only on the existing persisted row — reading it
 * here would mean querying the repository as part of "validation", which is
 * exactly the side effect this boundary exists to run before.
 *
 * A replacement payload mismatched to its variant is therefore validated one
 * layer in, in `app/database/store.ts` (issue #224): `updateElement` and
 * `updateElementsBatch` both hold the existing row's `type` at the point they
 * serialize the payload, and call `decodeSlideElementPayload` against it. That
 * is the first layer that can resolve the variant, so it is where the check
 * belongs — not here, and not duplicated in both places.
 */
export function decodeElementUpdateInput(value: unknown, context: CodecContext): ElementUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'zIndex', 'layer', 'payload']);
  expectString(value.id, context, 'id');
  checkOptionalFields(value, context, ELEMENT_UPDATE_OPTIONAL_FIELDS);
  if (value.layer !== undefined) expectEnum(value.layer, context, 'layer', ELEMENT_LAYERS);
  if (value.payload !== undefined && !isRecord(value.payload)) {
    fail(child(context, 'payload'), `must be an object, got ${describe(value.payload)}`);
  }
  return value as unknown as ElementUpdateInput;
}

// ---------------------------------------------------------------------------
// Media assets, overlays, themes, stages: reuse decodeSlideElement,
// decodeSlideBackground, and decodeOverlayAnimation for nested shapes.
// ---------------------------------------------------------------------------

const RPC_MEDIA_ASSET_TYPES = ['image', 'video', 'audio'] as const;

export function decodeMediaAssetCreateInput(value: unknown, context: CodecContext): MediaAssetCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'type', 'src']);
  expectString(value.name, context, 'name');
  expectEnum(value.type, context, 'type', RPC_MEDIA_ASSET_TYPES);
  expectString(value.src, context, 'src');
  return value as unknown as MediaAssetCreateInput;
}

function decodeSlideElementArray(value: unknown, context: CodecContext, field: string): void {
  const elements = expectArray(value, context, field);
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `${field}[${index}]`)));
}

export function decodeOverlayCreateInput(value: unknown, context: CodecContext): OverlayCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'elements', 'animation']);
  expectString(value.name, context, 'name');
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  if (value.animation !== undefined) decodeOverlayAnimation(value.animation, child(context, 'animation'));
  return value as unknown as OverlayCreateInput;
}

export function decodeOverlayUpdateInput(value: unknown, context: CodecContext): OverlayUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'name', 'elements', 'animation']);
  expectString(value.id, context, 'id');
  if (value.name !== undefined) expectString(value.name, context, 'name');
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  if (value.animation !== undefined) decodeOverlayAnimation(value.animation, child(context, 'animation'));
  return value as unknown as OverlayUpdateInput;
}

export function decodeThemeCreateInput(value: unknown, context: CodecContext): ThemeCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'themeType', 'width', 'height', 'background', 'elements']);
  expectString(value.name, context, 'name');
  expectEnum(value.themeType, context, 'themeType', THEME_OWNER_TYPES);
  checkOptionalFields(value, context, { width: 'number', height: 'number' });
  if (value.background !== undefined && value.background !== null) decodeSlideBackground(value.background, child(context, 'background'));
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as ThemeCreateInput;
}

export function decodeThemeUpdateInput(value: unknown, context: CodecContext): ThemeUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'themeType', 'name', 'width', 'height', 'background', 'elements']);
  expectString(value.id, context, 'id');
  expectEnum(value.themeType, context, 'themeType', THEME_OWNER_TYPES);
  checkOptionalFields(value, context, { name: 'string', width: 'number', height: 'number' });
  if (value.background !== undefined && value.background !== null) decodeSlideBackground(value.background, child(context, 'background'));
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as ThemeUpdateInput;
}

export function decodeStageCreateInput(value: unknown, context: CodecContext): StageCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'width', 'height', 'elements']);
  expectString(value.name, context, 'name');
  checkOptionalFields(value, context, { width: 'number', height: 'number' });
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as StageCreateInput;
}

export function decodeStageUpdateInput(value: unknown, context: CodecContext): StageUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'name', 'width', 'height', 'elements']);
  expectString(value.id, context, 'id');
  checkOptionalFields(value, context, { name: 'string', width: 'number', height: 'number' });
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as StageUpdateInput;
}

const RPC_ITEM_CREATE_TYPES: readonly ItemType[] = ['presentation', 'lyric', 'talk'];
// Talks are deliberately excluded (decision D1: there is simply no
// `duplicateTalk`) — matches `ItemDuplicateInput['type']` exactly.
const RPC_ITEM_DUPLICATE_TYPES = ['presentation', 'lyric'] as const;

/** #219 item-model refactor: replaces `decodeDeckItemCreateWithThemeInput`. */
export function decodeItemCreateInput(value: unknown, context: CodecContext): ItemCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['type', 'title', 'themeId', 'playlistId', 'position']);
  expectEnum(value.type, context, 'type', RPC_ITEM_CREATE_TYPES);
  checkOptionalFields(value, context, { title: 'string', position: 'number' });
  if (value.themeId !== undefined) expectNullableString(value.themeId, context, 'themeId');
  if (value.playlistId !== undefined) expectNullableString(value.playlistId, context, 'playlistId');
  return value as unknown as ItemCreateInput;
}

export function decodeItemDuplicateInput(value: unknown, context: CodecContext): ItemDuplicateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['type', 'id']);
  expectEnum(value.type, context, 'type', RPC_ITEM_DUPLICATE_TYPES);
  expectString(value.id, context, 'id');
  return value as unknown as ItemDuplicateInput;
}

// ---------------------------------------------------------------------------
// Deck bundle export/import RPC arguments (the manifest content itself is
// validated separately by decodeBundleManifest via app/core/deck-bundles
// once read off disk; these cover the surrounding renderer-supplied args).
// ---------------------------------------------------------------------------

export function decodeBundleExportOptions(value: unknown, context: CodecContext): BundleExportOptions {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['includeAllThemes', 'includeOverlays', 'includeStages', 'playlistIds']);
  checkOptionalFields(value, context, { includeAllThemes: 'boolean', includeOverlays: 'boolean', includeStages: 'boolean' });
  if (value.playlistIds !== undefined) expectStringArray(value.playlistIds, context, 'playlistIds');
  return value as unknown as BundleExportOptions;
}

const RPC_BROKEN_REFERENCE_ACTIONS = ['replace', 'remove', 'leave'] as const;

/** `replacementPath` is a filesystem path the renderer chose via a native file dialog. */
export function decodeBundleBrokenReferenceDecision(value: unknown, context: CodecContext): BundleBrokenReferenceDecision {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['source', 'action', 'replacementPath']);
  expectString(value.source, context, 'source');
  expectEnum(value.action, context, 'action', RPC_BROKEN_REFERENCE_ACTIONS);
  if (value.replacementPath !== undefined) expectString(value.replacementPath, context, 'replacementPath');
  return value as unknown as BundleBrokenReferenceDecision;
}

// ---------------------------------------------------------------------------
// NDI output name, RPC config input, and the persisted config file's map.
// The RPC codec and the stored-file codec deliberately have different
// unknown-field policies: `decodeNdiOutputConfigInput` is a capability
// boundary (renderer-controlled) and rejects unknown fields; the persisted
// file is written by the app itself across versions (not attacker-
// controlled) and `decodeStoredNdiOutputConfigMap` ignores unrecognized keys
// so a newer build's config still loads in an older one — the "compatibility-
// tolerant stored preferences" case named in issue #150's fixed decisions.
// ---------------------------------------------------------------------------

const RPC_NDI_OUTPUT_NAMES: readonly NdiOutputName[] = ['audience', 'stage'];
const MAX_NDI_TELEMETRY_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_NDI_TELEMETRY_DURATION_MS = 60_000;
const MAX_NDI_TELEMETRY_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_NDI_TELEMETRY_ID_LENGTH = 128;
const NDI_TELEMETRY_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function readBoundedNonNegativeFiniteNumber(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function readBoundedNonNegativeInteger(value: unknown, max: number): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= max
    ? value
    : null;
}

function readTelemetryId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_NDI_TELEMETRY_ID_LENGTH
    && NDI_TELEMETRY_ID_PATTERN.test(value)
    ? value
    : null;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : null;
}

function sanitizeRendererFrameDropReasons(
  value: unknown,
  canonicalBackpressureCount: number | null,
): Partial<NdiFrameDropReasonCounts> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized: Partial<NdiFrameDropReasonCounts> = {};
  for (const reason of NDI_RENDERER_FRAME_DROP_REASONS) {
    if (reason === 'backpressure' && canonicalBackpressureCount !== null) {
      if (canonicalBackpressureCount > 0) sanitized.backpressure = canonicalBackpressureCount;
      continue;
    }
    const count = readBoundedNonNegativeInteger(value[reason], MAX_NDI_TELEMETRY_COUNT);
    if (count !== null) sanitized[reason] = count;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeRendererTakeTelemetry(value: Record<string, unknown>): Pick<
  NdiFrameTelemetry,
  'takeKind' | 'takeReason' | 'takeSessionId' | 'takeSequenceId' | 'takeIssuedAtMs'
> {
  const takeKind = readEnum(value.takeKind, NDI_TAKE_KINDS);
  if (takeKind !== 'take' && takeKind !== 'activate') return {};

  const takeReason = readEnum(value.takeReason, NDI_TAKE_REASONS);
  const takeSessionId = readTelemetryId(value.takeSessionId);
  const takeSequenceId = readBoundedNonNegativeInteger(value.takeSequenceId, MAX_NDI_TELEMETRY_COUNT);
  const takeIssuedAtMs = readBoundedNonNegativeFiniteNumber(value.takeIssuedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (!takeReason || !takeSessionId || takeSequenceId === null || takeIssuedAtMs === null) return {};
  return {
    takeKind,
    takeReason,
    takeSessionId,
    takeSequenceId,
    takeIssuedAtMs,
  };
}

/**
 * Sanitizes optional renderer-provided frame telemetry at the IPC/engine trust
 * boundary. Telemetry is advisory: malformed fields are dropped or zeroed, and
 * must never make a successfully-sent native frame look like a send failure.
 */
export function sanitizeNdiFrameTelemetry(value: unknown): NdiFrameTelemetry | undefined {
  if (!isRecord(value)) return undefined;

  const canonicalBackpressureCount =
    readBoundedNonNegativeInteger(value.framesDroppedBackpressure, MAX_NDI_TELEMETRY_COUNT)
    ?? (isRecord(value.dropReasons)
      ? readBoundedNonNegativeInteger(value.dropReasons.backpressure, MAX_NDI_TELEMETRY_COUNT)
      : null);

  const telemetry: NdiFrameTelemetry = {
    captureDurationMs: readBoundedNonNegativeFiniteNumber(value.captureDurationMs, MAX_NDI_TELEMETRY_DURATION_MS) ?? 0,
    readbackDurationMs: readBoundedNonNegativeFiniteNumber(value.readbackDurationMs, MAX_NDI_TELEMETRY_DURATION_MS) ?? 0,
    skippedCaptures: readBoundedNonNegativeInteger(value.skippedCaptures, MAX_NDI_TELEMETRY_COUNT) ?? 0,
    framesDroppedBackpressure: canonicalBackpressureCount ?? 0,
    correctiveFrameRetries: readBoundedNonNegativeInteger(value.correctiveFrameRetries, MAX_NDI_TELEMETRY_COUNT) ?? 0,
  };

  const attemptId = readTelemetryId(value.attemptId);
  if (attemptId) telemetry.attemptId = attemptId;

  const dropReasons = sanitizeRendererFrameDropReasons(value.dropReasons, canonicalBackpressureCount);
  if (dropReasons) telemetry.dropReasons = dropReasons;

  const signatureChangedAtMs = readBoundedNonNegativeFiniteNumber(value.signatureChangedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (signatureChangedAtMs !== null) telemetry.signatureChangedAtMs = signatureChangedAtMs;

  Object.assign(telemetry, sanitizeRendererTakeTelemetry(value));

  const captureStartedAtMs = readBoundedNonNegativeFiniteNumber(value.captureStartedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (captureStartedAtMs !== null) telemetry.captureStartedAtMs = captureStartedAtMs;

  const rendererSendAtMs = readBoundedNonNegativeFiniteNumber(value.rendererSendAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (rendererSendAtMs !== null) telemetry.rendererSendAtMs = rendererSendAtMs;

  const mainReceivedAtMs = readBoundedNonNegativeFiniteNumber(value.mainReceivedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (mainReceivedAtMs !== null) telemetry.mainReceivedAtMs = mainReceivedAtMs;

  const proxyForwardedAtMs = readBoundedNonNegativeFiniteNumber(value.proxyForwardedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (proxyForwardedAtMs !== null) telemetry.proxyForwardedAtMs = proxyForwardedAtMs;

  const hostReceivedAtMs = readBoundedNonNegativeFiniteNumber(value.hostReceivedAtMs, MAX_NDI_TELEMETRY_TIMESTAMP_MS);
  if (hostReceivedAtMs !== null) telemetry.hostReceivedAtMs = hostReceivedAtMs;

  return telemetry;
}

export function decodeNdiOutputName(value: unknown, context: CodecContext, field = 'name'): NdiOutputName {
  return expectEnum(value, context, field, RPC_NDI_OUTPUT_NAMES);
}

export function decodeNdiOutputConfigInput(value: unknown, context: CodecContext): Partial<NdiOutputConfig> {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['senderName', 'withAlpha']);
  checkOptionalFields(value, context, { senderName: 'string', withAlpha: 'boolean' });
  return value as unknown as Partial<NdiOutputConfig>;
}

function decodeStoredNdiOutputConfigEntry(value: unknown, context: CodecContext): NdiOutputConfig {
  if (!isRecord(value)) fail(context, 'must be an object');
  const senderName = expectString(value.senderName, context, 'senderName');
  const withAlpha = expectBoolean(value.withAlpha, context, 'withAlpha');
  // Extra keys beyond senderName/withAlpha are ignored, not rejected — see
  // the section comment above.
  return { senderName, withAlpha };
}

/**
 * Decodes the persisted NDI output config file's `outputs` map. Both
 * `audience` and `stage` must be present with a valid `senderName` and
 * `withAlpha`; any other key, at any level of this shape, is tolerated and
 * ignored rather than rejected (see the section comment above).
 */
export function decodeStoredNdiOutputConfigMap(value: unknown, context: CodecContext): NdiOutputConfigMap {
  if (!isRecord(value)) fail(context, 'must be an object');
  return {
    audience: decodeStoredNdiOutputConfigEntry(value.audience, child(context, 'audience')),
    stage: decodeStoredNdiOutputConfigEntry(value.stage, child(context, 'stage')),
  };
}

// ---------------------------------------------------------------------------
// Full-state snapshot restore (restoreFromSnapshot)
// ---------------------------------------------------------------------------

// #219 item-model refactor decision D4/D5: `libraries`/`libraryBundles`/
// `collections` are gone — playlists ship as two ordinary flat-row families
// (`playlists`, `playlistEntries`) like every other table, not a derived
// tree. `themes` splits into four per-owner arrays (decision D2).
const APP_SNAPSHOT_ARRAY_FIELDS = [
  'presentations',
  'lyrics',
  'talks',
  'slides',
  'talkScriptBlocks',
  'slideElements',
  'mediaAssets',
  'overlays',
  'presentationThemes',
  'lyricThemes',
  'talkThemes',
  'overlayThemes',
  'stages',
  'playlists',
  'playlistEntries',
  'cues',
  'macros',
  'triggerBindings',
] as const;

/**
 * Expected primitive kind for a snapshot row field, keyed by **field name
 * across every family** rather than per entity.
 *
 * This is deliberately not a per-family field spec. Issue #150's fixed
 * decisions forbid mirroring internal domain types at this boundary, and
 * sixteen hand-written per-entity decoders would be exactly that mirror — a
 * second copy of `app/core/domain` to keep in sync. What this map encodes
 * instead is the naming convention the domain families already share: `order`
 * and `zIndex` are numbers wherever they appear, `createdAt` and every
 * `*Id` are strings, `enabled` and `loopEnabled` are booleans. It is checked
 * against every family uniformly, so it grows only when a genuinely new field
 * name enters the domain, and no family can drift away from it silently.
 *
 * Fields whose value is structured (`payload`, `background`, `elements`,
 * `animation`, `config`, `cues`, `reference`) are absent here on purpose:
 * those already have owning decoders, and `checkSnapshotRow` routes to them.
 */
const SNAPSHOT_ROW_FIELD_KINDS: Readonly<Record<string, 'string' | 'number' | 'boolean'>> = {
  // Identity and free text
  id: 'string',
  name: 'string',
  title: 'string',
  description: 'string',
  notes: 'string',
  text: 'string',
  src: 'string',
  thumbnailSrc: 'string',
  colorKey: 'string',
  label: 'string',
  createdAt: 'string',
  updatedAt: 'string',
  // Discriminants and enum-valued columns. Checked as strings only: the
  // *allowed values* are each family's own business, and several are already
  // enforced by the structured decoders below or by the database schema.
  type: 'string',
  kind: 'string',
  layer: 'string',
  backgroundSource: 'string',
  scopeLevel: 'string',
  onScopeExit: 'string',
  failurePolicy: 'string',
  triggerType: 'string',
  targetType: 'string',
  // Foreign keys and owner pointers
  slideId: 'string',
  playlistId: 'string',
  macroId: 'string',
  cueId: 'string',
  themeId: 'string',
  presentationThemeId: 'string',
  lyricThemeId: 'string',
  talkThemeId: 'string',
  overlayThemeId: 'string',
  overlayId: 'string',
  stageId: 'string',
  assetId: 'string',
  presentationId: 'string',
  lyricId: 'string',
  talkId: 'string',
  sourceId: 'string',
  targetId: 'string',
  sourceThemeElementId: 'string',
  // Geometry, ordering, and timings
  order: 'number',
  orderIndex: 'number',
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  duration: 'number',
  rotation: 'number',
  opacity: 'number',
  zIndex: 'number',
  delayBeforeMs: 'number',
  delayAfterMs: 'number',
  durationMs: 'number',
  autoClearDurationMs: 'number',
  loopCount: 'number',
  codec: 'string',
  // Flags
  enabled: 'boolean',
  loopEnabled: 'boolean',
};

/**
 * Checks the primitive fields of one snapshot row against
 * `SNAPSHOT_ROW_FIELD_KINDS`.
 *
 * Two deliberate leniencies, both chosen so this pass can only ever *narrow*
 * what is accepted and can never reject a snapshot today's code accepts:
 *
 * - **An unrecognized field name is ignored.** A field this map has not heard
 *   of is not this map's business; failing on it would make adding a domain
 *   field a breaking change to undo/redo.
 * - **`null` and `undefined` always pass.** Which fields are nullable or
 *   optional varies per family (`themeId` is optional on Presentation/Lyric/
 *   Talk, the nine owner FKs on `Slide` are null for all but one,
 *   `loopCount: number | null` means "loop forever"), and encoding that here
 *   would be the per-family
 *   mirror this map exists to avoid. Getting it wrong in the strict direction
 *   would reject legitimate snapshots — the failure mode that took undo/redo
 *   out entirely before this change.
 *
 * What is left is the case that actually corrupts data: a field that is
 * *present with a value of the wrong type*. SQLite column affinity silently
 * coerces many of those rather than rejecting them (a string in an INTEGER
 * column, a number in a TEXT column), so they survive the restore transaction
 * and persist as corrupt rows.
 */
function checkSnapshotRowFields(row: Record<string, unknown>, context: CodecContext): void {
  for (const [field, value] of Object.entries(row)) {
    const kind = SNAPSHOT_ROW_FIELD_KINDS[field];
    if (kind === undefined) continue;
    if (value === null || value === undefined) continue;

    if (kind === 'string') expectString(value, context, field);
    else if (kind === 'number') expectFiniteNumber(value, context, field);
    else expectBoolean(value, context, field);
  }
}

/** A structured field on a row, delegated to the decoder that already owns it. */
function checkSnapshotRowStructure(field: string, row: Record<string, unknown>, context: CodecContext): void {
  switch (field) {
    case 'slideElements':
      // The element decoder already validates base fields plus the payload
      // variant for the element's own `type`, recursing into group children.
      decodeSlideElement(row, context);
      return;
    case 'slides':
      if (row.background !== null && row.background !== undefined) {
        decodeSlideBackground(row.background, child(context, 'background'));
      }
      return;
    case 'presentationThemes':
    case 'lyricThemes':
    case 'talkThemes':
    case 'overlayThemes':
    case 'stages':
    case 'overlays': {
      if (row.background !== null && row.background !== undefined) {
        decodeSlideBackground(row.background, child(context, 'background'));
      }
      const elements = expectArray(row.elements, context, 'elements');
      elements.forEach((element, index) => {
        decodeSlideElement(element, child(context, `elements[${index}]`));
      });
      if (field === 'overlays' && row.animation !== undefined) {
        decodeOverlayAnimation(row.animation, child(context, 'animation'));
      }
      return;
    }
    case 'cues':
      decodeCuePayload(row.payload, child(context, 'payload'));
      return;
    case 'macros': {
      const cues = expectArray(row.cues, context, 'cues');
      cues.forEach((macroCue, index) => {
        const cueContext = child(context, `cues[${index}]`);
        if (!isRecord(macroCue)) fail(cueContext, 'must be an object');
        checkSnapshotRowFields(macroCue, cueContext);
        // A MacroCue embeds the full cue it steps through.
        if (!isRecord(macroCue.cue)) fail(child(cueContext, 'cue'), 'must be an object');
        checkSnapshotRowFields(macroCue.cue, child(cueContext, 'cue'));
        decodeCuePayload(macroCue.cue.payload, child(cueContext, 'cue.payload'));
      });
      return;
    }
    case 'triggerBindings':
      // `config: Record<string, unknown>` is deliberately open — its shape is
      // the trigger's business, not the boundary's. Only the container type is
      // asserted, since a non-object reaches the persistence layer as one.
      if (row.config !== null && row.config !== undefined && !isRecord(row.config)) {
        fail(child(context, 'config'), `must be an object, got ${describe(row.config)}`);
      }
      return;
    default:
      return;
  }
}

/**
 * Validates a full-state snapshot before `restoreFromSnapshot` clears and
 * repopulates every application table — the destructive side effect this
 * boundary exists to run before.
 *
 * Depth (issue #224, deepening #150's shallow pass). Three layers, none of
 * which mirrors a domain type:
 *
 * 1. Every entity array named in `AppSnapshot` must be present and hold
 *    objects; flat-row families must carry a string `id` (as before).
 * 2. Every recognized primitive field on every row is type-checked against
 *    `SNAPSHOT_ROW_FIELD_KINDS`, a convention map shared by all families.
 * 3. Structured fields are delegated to the decoders that already own them —
 *    `decodeSlideElement` (which validates the payload variant against the
 *    element's own `type`), `decodeSlideBackground`, `decodeOverlayAnimation`,
 *    `decodeCuePayload`.
 *
 * On the destructive-transaction framing: `restoreFromSnapshot` wraps its
 * deletes and inserts in a single `db.transaction(...)`, so a row that makes
 * `.run()` throw rolls the deletes back and does not destroy data. The risk
 * this closes is therefore **silent corruption**, not data loss: SQLite column
 * affinity coerces rather than rejects many wrong-typed bindings (a numeric
 * string into an INTEGER column, a number into a TEXT column), and structured
 * fields are `JSON.stringify`-ed, so a malformed payload persists intact and
 * only fails much later on read. Those survive the transaction. Validating
 * here also turns an opaque mid-transaction SQLite `TypeError` into a boundary
 * error naming the exact row and field.
 */
export function decodeAppSnapshotShape(value: unknown, context: CodecContext): AppSnapshot {
  if (!isRecord(value)) fail(context, 'must be an object');

  for (const field of APP_SNAPSHOT_ARRAY_FIELDS) {
    const items = expectArray(value[field], context, field);

    items.forEach((item, index) => {
      const itemContext = child(context, `${field}[${index}]`);

      if (!isRecord(item)) fail(itemContext, 'must be an object');
      expectString(item.id, itemContext, 'id');
      checkSnapshotRowFields(item, itemContext);
      checkSnapshotRowStructure(field, item, itemContext);
    });
  }

  return value as unknown as AppSnapshot;
}

/**
 * Validates a partial snapshot patch before `applySnapshotPatch` mutates only
 * the tables named on the wire payload. Unlike `decodeAppSnapshotShape`, this
 * only walks tables actually present in `upserts`/`deletes`; missing table keys
 * mean "no change".
 */
export function decodeSnapshotPatchShape(
  value: unknown,
  context: CodecContext,
): import('./snapshot-patch').SnapshotPatch {
  if (!isRecord(value)) fail(context, 'must be an object');
  expectFiniteNumber(value.version, context, 'version');

  const upserts = value.upserts;
  if (!isRecord(upserts)) fail(context, 'upserts must be an object');

  const deletes = value.deletes;
  if (!isRecord(deletes)) fail(context, 'deletes must be an object');

  for (const field of APP_SNAPSHOT_ARRAY_FIELDS) {
    const upsertRows = upserts[field];
    if (upsertRows !== undefined) {
      const items = expectArray(upsertRows, child(context, 'upserts'), field);
      items.forEach((item, index) => {
        const itemContext = child(context, `upserts.${field}[${index}]`);
        if (!isRecord(item)) fail(itemContext, 'must be an object');
        expectString(item.id, itemContext, 'id');
        checkSnapshotRowFields(item, itemContext);
        checkSnapshotRowStructure(field, item, itemContext);
      });
    }

    const deletedIds = deletes[field];
    if (deletedIds !== undefined) {
      const ids = expectArray(deletedIds, child(context, 'deletes'), field);
      ids.forEach((id, index) => {
        expectString(id, child(context, `deletes.${field}[${index}]`), 'value');
      });
    }
  }

  return value as unknown as import('./snapshot-patch').SnapshotPatch;
}
