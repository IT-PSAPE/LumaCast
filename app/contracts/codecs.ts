import type { CueClearLayer, CuePayload, LifecycleAction } from '@lumacast/automation';
import type { SlideBackground, SlideElement, SlideElementPayload, SlideElementType, OverlayAnimation } from '@lumacast/composition';
import type {
  CollectionAssignmentInput,
  CollectionCreateInput,
  CollectionDeleteInput,
  CollectionReorderInput,
  CollectionRenameInput,
  CueCreateInput,
  CueUpdateInput,
  DeckBundleExportOptions,
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
import type { AppSnapshot, DeckBundleBrokenReferenceDecision } from './rpc-results';
import type { NdiOutputConfig, NdiOutputConfigMap, NdiOutputName } from './ndi-observability';
import type {
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleMediaReference,
  DeckBundleOverlay,
  DeckBundlePlaylist,
  DeckBundleSlide,
  DeckBundleStage,
  DeckBundleTheme,
} from './deck-bundle-manifest';
import type { DeckItemCreateWithThemeInput, InlineWindowMenuBounds } from '@core/ipc';

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
  /** Calling operation, e.g. 'listCues' or 'readDeckBundleArchive'. */
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

export const DECK_BUNDLE_FORMAT = 'cast-deck-bundle' as const;
export const DECK_BUNDLE_VERSION = 1 as const;

const DECK_ITEM_TYPES = ['presentation', 'lyric', 'talk'] as const;
const THEME_KINDS = ['slides', 'lyrics', 'overlays'] as const;
const OVERLAY_TYPES = ['image', 'shape', 'text', 'video'] as const;
const BACKGROUND_SOURCES = ['theme', 'local'] as const;
const MEDIA_ELEMENT_TYPES = ['image', 'video'] as const;

function decodeMediaReferences(value: unknown, context: CodecContext): DeckBundleMediaReference[] {
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
  return references as DeckBundleMediaReference[];
}

function decodeDeckBundleSlide(value: unknown, context: CodecContext): DeckBundleSlide {
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
  return value as unknown as DeckBundleSlide;
}

function decodeDeckBundleItem(value: unknown, context: CodecContext): DeckBundleItem {
  if (!isRecord(value)) fail(context, 'item must be an object');
  expectString(value.id, context, 'id');
  expectEnum(value.type, context, 'type', DECK_ITEM_TYPES);
  expectString(value.title, context, 'title');
  expectNullableString(value.themeId, context, 'themeId');
  expectFiniteNumber(value.order, context, 'order');
  const slides = expectArray(value.slides, context, 'slides');
  slides.forEach((slide, index) => decodeDeckBundleSlide(slide, child(context, `slides[${index}]`)));
  return value as unknown as DeckBundleItem;
}

function decodeDeckBundleTheme(value: unknown, context: CodecContext): DeckBundleTheme {
  if (!isRecord(value)) fail(context, 'theme must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectEnum(value.kind, context, 'kind', THEME_KINDS);
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.order, context, 'order');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  return value as unknown as DeckBundleTheme;
}

function decodeDeckBundleOverlay(value: unknown, context: CodecContext): DeckBundleOverlay {
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
  return value as unknown as DeckBundleOverlay;
}

function decodeDeckBundleStage(value: unknown, context: CodecContext): DeckBundleStage {
  if (!isRecord(value)) fail(context, 'stage must be an object');
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectFiniteNumber(value.width, context, 'width');
  expectFiniteNumber(value.height, context, 'height');
  expectFiniteNumber(value.order, context, 'order');
  const elements = expectArray(value.elements, context, 'elements');
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `elements[${index}]`)));
  return value as unknown as DeckBundleStage;
}

function decodeDeckBundlePlaylist(value: unknown, context: CodecContext): DeckBundlePlaylist {
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
      // talkId is optional in the wire shape: omitted stays omitted, null
      // stays null; the owner-exclusivity rule is applied by the single
      // interpretation point (@core/deck-bundles), not re-derived here.
      expectNullableString(entry.presentationId, entryContext, 'presentationId');
      expectNullableString(entry.lyricId, entryContext, 'lyricId');
      if (entry.talkId !== undefined) expectNullableString(entry.talkId, entryContext, 'talkId');
      expectFiniteNumber(entry.order, entryContext, 'order');
    });
  });
  return value as unknown as DeckBundlePlaylist;
}

/**
 * Decodes an untrusted deck-bundle manifest. Rejects unknown formats and
 * future versions explicitly, then validates the full structural shape of
 * items, themes, overlays, stages, playlists, and every nested slide element,
 * background, and animation.
 */
export function decodeDeckBundleManifest(value: unknown, context: CodecContext): DeckBundleManifest {
  if (!isRecord(value)) fail(context, 'manifest must be an object');

  if (value.format !== DECK_BUNDLE_FORMAT) {
    if (typeof value.format === 'string') {
      fail(context, `unsupported bundle format ${JSON.stringify(value.format)}`);
    }
    fail(context, 'bundle format must be a string');
  }
  if (value.version !== DECK_BUNDLE_VERSION) {
    if (typeof value.version === 'number' && value.version > DECK_BUNDLE_VERSION) {
      fail(context, `future bundle version ${value.version} is not supported; this build supports version ${DECK_BUNDLE_VERSION}`);
    }
    fail(context, `unsupported bundle version ${describe(value.version)}; this build supports version ${DECK_BUNDLE_VERSION}`);
  }

  expectString(value.exportedAt, context, 'exportedAt');

  const items = expectArray(value.items, context, 'items');
  items.forEach((item, index) => decodeDeckBundleItem(item, child(context, `items[${index}]`)));

  const themes = expectArray(value.themes, context, 'themes');
  themes.forEach((theme, index) => decodeDeckBundleTheme(theme, child(context, `themes[${index}]`)));

  decodeMediaReferences(value.mediaReferences, context);

  if (value.overlays !== undefined) {
    const overlays = expectArray(value.overlays, context, 'overlays');
    overlays.forEach((overlay, index) => decodeDeckBundleOverlay(overlay, child(context, `overlays[${index}]`)));
  }

  if (value.stages !== undefined) {
    const stages = expectArray(value.stages, context, 'stages');
    stages.forEach((stage, index) => decodeDeckBundleStage(stage, child(context, `stages[${index}]`)));
  }

  if (value.playlists !== undefined) {
    const playlists = expectArray(value.playlists, context, 'playlists');
    playlists.forEach((playlist, index) => decodeDeckBundlePlaylist(playlist, child(context, `playlists[${index}]`)));
  }

  return value as unknown as DeckBundleManifest;
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
const RPC_SCOPE_LEVELS = ['global', 'deckItem', 'slide'] as const;
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
  rejectUnknownKeys(value, context, ['name', 'description', 'collectionId', 'scopeLevel', 'onScopeExit', 'loopEnabled', 'loopCount', 'cues']);
  expectString(value.name, context, 'name');
  checkOptionalFields(value, context, { description: 'string', collectionId: 'string', loopEnabled: 'boolean' });
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
  rejectUnknownKeys(value, context, ['name', 'type', 'src', 'collectionId']);
  expectString(value.name, context, 'name');
  expectEnum(value.type, context, 'type', RPC_MEDIA_ASSET_TYPES);
  expectString(value.src, context, 'src');
  if (value.collectionId !== undefined) expectString(value.collectionId, context, 'collectionId');
  return value as unknown as MediaAssetCreateInput;
}

function decodeSlideElementArray(value: unknown, context: CodecContext, field: string): void {
  const elements = expectArray(value, context, field);
  elements.forEach((element, index) => decodeSlideElement(element, child(context, `${field}[${index}]`)));
}

export function decodeOverlayCreateInput(value: unknown, context: CodecContext): OverlayCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'elements', 'animation', 'collectionId']);
  expectString(value.name, context, 'name');
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  if (value.animation !== undefined) decodeOverlayAnimation(value.animation, child(context, 'animation'));
  if (value.collectionId !== undefined) expectString(value.collectionId, context, 'collectionId');
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
  rejectUnknownKeys(value, context, ['name', 'kind', 'width', 'height', 'background', 'elements', 'collectionId']);
  expectString(value.name, context, 'name');
  expectEnum(value.kind, context, 'kind', THEME_KINDS);
  checkOptionalFields(value, context, { width: 'number', height: 'number', collectionId: 'string' });
  if (value.background !== undefined && value.background !== null) decodeSlideBackground(value.background, child(context, 'background'));
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as ThemeCreateInput;
}

export function decodeThemeUpdateInput(value: unknown, context: CodecContext): ThemeUpdateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['id', 'name', 'kind', 'width', 'height', 'background', 'elements']);
  expectString(value.id, context, 'id');
  checkOptionalFields(value, context, { name: 'string', width: 'number', height: 'number' });
  if (value.kind !== undefined) expectEnum(value.kind, context, 'kind', THEME_KINDS);
  if (value.background !== undefined && value.background !== null) decodeSlideBackground(value.background, child(context, 'background'));
  if (value.elements !== undefined) decodeSlideElementArray(value.elements, context, 'elements');
  return value as unknown as ThemeUpdateInput;
}

export function decodeStageCreateInput(value: unknown, context: CodecContext): StageCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['name', 'width', 'height', 'elements', 'collectionId']);
  expectString(value.name, context, 'name');
  checkOptionalFields(value, context, { width: 'number', height: 'number', collectionId: 'string' });
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

const RPC_DECK_ITEM_CREATE_TYPES = ['presentation', 'lyric', 'talk'] as const;

export function decodeDeckItemCreateWithThemeInput(value: unknown, context: CodecContext): DeckItemCreateWithThemeInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['type', 'title', 'collectionId', 'themeId', 'groupId']);
  expectEnum(value.type, context, 'type', RPC_DECK_ITEM_CREATE_TYPES);
  expectString(value.title, context, 'title');
  if (value.collectionId !== undefined) expectNullableString(value.collectionId, context, 'collectionId');
  if (value.themeId !== undefined) expectNullableString(value.themeId, context, 'themeId');
  if (value.groupId !== undefined) expectNullableString(value.groupId, context, 'groupId');
  return value as unknown as DeckItemCreateWithThemeInput;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const RPC_COLLECTION_BIN_KINDS = ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage', 'macro'] as const;
const RPC_COLLECTION_ITEM_TYPES = ['presentation', 'lyric', 'talk', 'media_asset', 'theme', 'overlay', 'stage', 'macro'] as const;

export function decodeCollectionCreateInput(value: unknown, context: CodecContext): CollectionCreateInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['binKind', 'name']);
  expectEnum(value.binKind, context, 'binKind', RPC_COLLECTION_BIN_KINDS);
  expectString(value.name, context, 'name');
  return value as unknown as CollectionCreateInput;
}

export function decodeCollectionRenameInput(value: unknown, context: CodecContext): CollectionRenameInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['binKind', 'id', 'name']);
  expectEnum(value.binKind, context, 'binKind', RPC_COLLECTION_BIN_KINDS);
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  return value as unknown as CollectionRenameInput;
}

export function decodeCollectionDeleteInput(value: unknown, context: CodecContext): CollectionDeleteInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['binKind', 'id']);
  expectEnum(value.binKind, context, 'binKind', RPC_COLLECTION_BIN_KINDS);
  expectString(value.id, context, 'id');
  return value as unknown as CollectionDeleteInput;
}

export function decodeCollectionReorderInput(value: unknown, context: CodecContext): CollectionReorderInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['binKind', 'ids']);
  expectEnum(value.binKind, context, 'binKind', RPC_COLLECTION_BIN_KINDS);
  expectStringArray(value.ids, context, 'ids');
  return value as unknown as CollectionReorderInput;
}

export function decodeCollectionAssignmentInput(value: unknown, context: CodecContext): CollectionAssignmentInput {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['itemType', 'itemId', 'collectionId']);
  expectEnum(value.itemType, context, 'itemType', RPC_COLLECTION_ITEM_TYPES);
  expectString(value.itemId, context, 'itemId');
  expectString(value.collectionId, context, 'collectionId');
  return value as unknown as CollectionAssignmentInput;
}

// ---------------------------------------------------------------------------
// Deck bundle export/import RPC arguments (the manifest content itself is
// validated separately by decodeDeckBundleManifest via app/core/deck-bundles
// once read off disk; these cover the surrounding renderer-supplied args).
// ---------------------------------------------------------------------------

export function decodeDeckBundleExportOptions(value: unknown, context: CodecContext): DeckBundleExportOptions {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['includeAllThemes', 'includeOverlays', 'includeStages', 'playlistIds']);
  checkOptionalFields(value, context, { includeAllThemes: 'boolean', includeOverlays: 'boolean', includeStages: 'boolean' });
  if (value.playlistIds !== undefined) expectStringArray(value.playlistIds, context, 'playlistIds');
  return value as unknown as DeckBundleExportOptions;
}

const RPC_BROKEN_REFERENCE_ACTIONS = ['replace', 'remove', 'leave'] as const;

/** `replacementPath` is a filesystem path the renderer chose via a native file dialog. */
export function decodeDeckBundleBrokenReferenceDecision(value: unknown, context: CodecContext): DeckBundleBrokenReferenceDecision {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['source', 'action', 'replacementPath']);
  expectString(value.source, context, 'source');
  expectEnum(value.action, context, 'action', RPC_BROKEN_REFERENCE_ACTIONS);
  if (value.replacementPath !== undefined) expectString(value.replacementPath, context, 'replacementPath');
  return value as unknown as DeckBundleBrokenReferenceDecision;
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

const APP_SNAPSHOT_ARRAY_FIELDS = [
  'libraries',
  'libraryBundles',
  'presentations',
  'lyrics',
  'talks',
  'slides',
  'talkScriptBlocks',
  'slideElements',
  'mediaAssets',
  'overlays',
  'themes',
  'stages',
  'collections',
  'cues',
  'macros',
  'triggerBindings',
] as const;

/**
 * `libraryBundles` is the one entry in `APP_SNAPSHOT_ARRAY_FIELDS` that is not
 * a flat row list. Its elements are read-composed trees
 * (`{ library, playlists: [{ playlist, groups: [{ group, entries: [{ entry, item }] }] }] }`)
 * and carry no `id` of their own — and `restoreFromSnapshot` reads playlists,
 * groups, and entries from nowhere else, so the tree has to be walked rather
 * than skipped.
 */
const APP_SNAPSHOT_TREE_FIELD = 'libraryBundles';

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
 * `*Id` are strings, `enabled` and `isDefault` are booleans. It is checked
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
  colorKey: 'string',
  createdAt: 'string',
  updatedAt: 'string',
  // Discriminants and enum-valued columns. Checked as strings only: the
  // *allowed values* are each family's own business, and several are already
  // enforced by the structured decoders below or by the database schema.
  type: 'string',
  kind: 'string',
  binKind: 'string',
  layer: 'string',
  backgroundSource: 'string',
  scopeLevel: 'string',
  onScopeExit: 'string',
  failurePolicy: 'string',
  triggerType: 'string',
  targetType: 'string',
  // Foreign keys and owner pointers
  collectionId: 'string',
  slideId: 'string',
  libraryId: 'string',
  playlistId: 'string',
  groupId: 'string',
  macroId: 'string',
  cueId: 'string',
  themeId: 'string',
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
  rotation: 'number',
  opacity: 'number',
  zIndex: 'number',
  delayBeforeMs: 'number',
  delayAfterMs: 'number',
  durationMs: 'number',
  autoClearDurationMs: 'number',
  loopCount: 'number',
  // Flags
  isDefault: 'boolean',
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
 *   optional varies per family (`themeId` is optional on deck items, the six
 *   owner FKs on `Slide` are null for all but one, `loopCount: number | null`
 *   means "loop forever"), and encoding that here would be the per-family
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
    case 'themes':
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

/** Walks one `libraryBundles` tree: library → playlists → groups → entries. */
function checkLibraryBundle(value: unknown, context: CodecContext): void {
  if (!isRecord(value)) fail(context, 'must be an object');

  if (!isRecord(value.library)) fail(child(context, 'library'), 'must be an object');
  const libraryContext = child(context, 'library');
  expectString(value.library.id, libraryContext, 'id');
  checkSnapshotRowFields(value.library, libraryContext);

  const playlists = expectArray(value.playlists, context, 'playlists');
  playlists.forEach((tree, treeIndex) => {
    const treeContext = child(context, `playlists[${treeIndex}]`);
    if (!isRecord(tree)) fail(treeContext, 'must be an object');

    if (!isRecord(tree.playlist)) fail(child(treeContext, 'playlist'), 'must be an object');
    const playlistContext = child(treeContext, 'playlist');
    expectString(tree.playlist.id, playlistContext, 'id');
    checkSnapshotRowFields(tree.playlist, playlistContext);

    const groups = expectArray(tree.groups, treeContext, 'groups');
    groups.forEach((groupNode, groupIndex) => {
      const groupNodeContext = child(treeContext, `groups[${groupIndex}]`);
      if (!isRecord(groupNode)) fail(groupNodeContext, 'must be an object');

      if (!isRecord(groupNode.group)) fail(child(groupNodeContext, 'group'), 'must be an object');
      const groupContext = child(groupNodeContext, 'group');
      expectString(groupNode.group.id, groupContext, 'id');
      checkSnapshotRowFields(groupNode.group, groupContext);

      const entries = expectArray(groupNode.entries, groupNodeContext, 'entries');
      entries.forEach((entryNode, entryIndex) => {
        const entryNodeContext = child(groupNodeContext, `entries[${entryIndex}]`);
        if (!isRecord(entryNode)) fail(entryNodeContext, 'must be an object');

        if (!isRecord(entryNode.entry)) fail(child(entryNodeContext, 'entry'), 'must be an object');
        const entryContext = child(entryNodeContext, 'entry');
        expectString(entryNode.entry.id, entryContext, 'id');
        checkSnapshotRowFields(entryNode.entry, entryContext);
        // `entry.reference` is validated by the repository's
        // `resolvePlaylistEntryReference`, which is the authority on which
        // owner column a reference resolves to; duplicating that discrimination
        // here would mirror it. `item` is a read-composed deck item the restore
        // never inserts from, so it is walked for field types only.
        if (isRecord(entryNode.item)) {
          checkSnapshotRowFields(entryNode.item, child(entryNodeContext, 'item'));
        }
      });
    });
  });
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

      if (field === APP_SNAPSHOT_TREE_FIELD) {
        checkLibraryBundle(item, itemContext);
        return;
      }

      if (!isRecord(item)) fail(itemContext, 'must be an object');
      expectString(item.id, itemContext, 'id');
      checkSnapshotRowFields(item, itemContext);
      checkSnapshotRowStructure(field, item, itemContext);
    });
  }

  return value as unknown as AppSnapshot;
}