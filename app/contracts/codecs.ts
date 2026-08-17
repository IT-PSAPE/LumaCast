import type {
  CueClearLayer,
  CuePayload,
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleMediaReference,
  DeckBundleOverlay,
  DeckBundlePlaylist,
  DeckBundleSlide,
  DeckBundleStage,
  DeckBundleTheme,
  LifecycleAction,
  OverlayAnimation,
  SlideBackground,
  SlideElement,
  SlideElementPayload,
  SlideElementType,
} from '@core/types';

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