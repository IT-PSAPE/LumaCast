// Agent-facing parameter schemas for every `ActionId` (issue: agent/MCP
// action surface). `@lumacast/commands`'s `ACTION_METADATA` says what an
// action does and how risky it is; `./action-bindings` says how a
// `site: 'renderer'` action's params reach its executor and how a
// `site: 'main'` action's params map onto the typed IPC contract. Neither
// says what shape an LLM (or any other caller) must actually send. This
// module is that shape, for all 174 ids at once: a decoder (reusing the
// `s.*` combinator from `./schema`, which gets a JSON Schema for free from
// the same declaration) plus the MCP-style tool definitions built from it.
//
// Type-safety drift guard: wherever a `site: 'main'` action's RPC method
// takes a single input object, that action's `params` schema is declared
// `satisfies Schema<TheRpcInputType>` (imported from `./rpc-inputs` or
// `./ipc`) — so a schema that drifts from the real RPC contract fails to
// compile here, not silently at runtime. Two families of exception are
// called out explicitly where they occur:
//
//   - Agent-facing deviations (`Agent<Original>` types defined in this file):
//     everywhere a domain image/video payload or background would carry a
//     session-scoped `src` token, the agent-facing shape carries a stable
//     `assetId` instead — agents only ever see ids they resolved via
//     `media.list`/`overlay.list`/etc., never the opaque managed-media URL.
//   - Positional legacy RPC methods with no named input type (e.g.
//     `createPlaylist(name: string)`) are typed directly against the method's
//     own parameter types; there is no `TheRpcInputType` to satisfy.
//
// Seven ids that were once reserved with a null RPC binding — `slide.render`,
// `slide.renderContactSheet`, `element.setRichText`, `element.group`,
// `element.ungroup`, `element.align`, `element.distribute` — are now
// `site: 'renderer'` (ADR-0037) and wired to the canvas and render features.
// `./action-bindings`'s `RendererActionParams` mirrors this module's field
// names for those seven exactly; this module remains the field-name source
// of truth for every action's agent-facing shape. `document.extractText`
// stays a `site: 'main'` reserved-looking id with a real RPC binding
// (`agentExtractDocumentText`) behind it.
import type { Id } from '@lumacast/kernel';
import type {
  ItemRef,
  ItemType,
  ThemeOwnerType,
  MediaAssetType,
  SlideElementType,
  SlideElementBase,
  ElementVisualPayload,
  TextElementPayload,
  ImageElementPayload,
  VideoElementPayload,
  ShapeElementPayload,
  TextHorizontalAlign,
  TextVerticalAlign,
  TextCaseTransform,
  StrokePosition,
  TextBindingKind,
  ClockFormat,
  TimerFormat,
  TextBinding,
  RichBody,
  RichBlock,
  RichRun,
  SlideBackgroundFit,
  SlideBackgroundSource,
  SlideGradient,
  GradientStop,
  OverlayAnimation,
  SlideKind,
} from '@lumacast/composition';
import { SLIDE_TAG_COLOR_KEYS } from '@lumacast/composition';
import type {
  CueKind,
  CuePayload,
  CueFailurePolicy,
  CueClearLayer,
  LifecycleAction,
  LifecycleTarget,
  ScopeLevel,
  OnScopeExit,
  TriggerType,
  TriggerBindingTargetType,
  PlaybackSchedule,
  SlideTimingStep,
  AudioSlideMarker,
} from '@lumacast/automation';
import type { ActionId, ActionMetadata } from '@lumacast/commands';
import { ACTION_METADATA, ACTION_IDS } from '@lumacast/commands';
import type {
  ActionWorkbenchMode,
  ActionSlideBrowserMode,
  ActionProgramMode,
  ActionOverlayMode,
  RendererActionParams,
} from './action-bindings';
import { s, type Schema, type JsonSchema } from './schema';
import { fail, type CodecContext } from './codecs';
import type {
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  CueCreateInput,
  CueUpdateInput,
  MacroCreateInput,
  MacroUpdateInput,
  TriggerBindingCreateInput,
  ItemListInput,
  ItemGetInput,
  LyricBlankSlidesUpdateInput,
  MediaAssetListInput,
  ThemeListInput,
  SearchContentInput,
  PlaylistGetInput,
  SlideGetInput,
  SlideTagCreateInput,
  SlideTagUpdateInput,
  SlideTagAssignInput,
  BundleExportOptions,
} from './rpc-inputs';
import type { ItemCreateInput, ItemDuplicateInput } from './ipc';
import type { NdiOutputName, NdiOutputConfig } from './ndi-observability';
import type { BundleBrokenReferenceDecision, BundleBrokenReferenceAction } from './rpc-results';
import type {
  ProjectBackup,
  ProjectBackupTables,
  ProjectBackupItemRow,
  ProjectBackupSlideRow,
  ProjectBackupSlideElementRow,
  ProjectBackupPlaylistRow,
  ProjectBackupPlaylistEntryRow,
  ProjectBackupMediaAssetRow,
  ProjectBackupOverlayRow,
  ProjectBackupThemeRow,
  ProjectBackupStageRow,
  ProjectBackupSlideTagRow,
  ProjectBackupCueRow,
  ProjectBackupMacroRow,
  ProjectBackupMacroStepRow,
  ProjectBackupTriggerBindingRow,
  ProjectBackupPlaybackScheduleRow,
} from './project-backup';

// ---------------------------------------------------------------------------
// `asObjectSchema`: every action's top-level params schema must itself report
// `type: 'object'` (the shape every tool-calling provider — and this
// package's own completeness test — expects at the root), but a handful of
// actions (`element.create`) are naturally a discriminated union at the top
// level (the payload shape depends on the sibling `type` field). Wrapping
// re-presents such a schema's JSON Schema as a plain object schema (merging
// every branch's properties for documentation purposes, keeping the real
// `oneOf`/`anyOf` alongside it for the branch-exact constraint) while
// decoding is untouched — it delegates straight to `inner`.
// ---------------------------------------------------------------------------
function asObjectSchema<T>(inner: Schema<T>, description?: string): Schema<T> {
  return {
    decode: (value, context) => inner.decode(value, context),
    toJsonSchema: (): JsonSchema => {
      const innerJson = inner.toJsonSchema();
      const branches = (innerJson.oneOf ?? innerJson.anyOf) as JsonSchema[] | undefined;
      const properties: Record<string, JsonSchema> = {};
      for (const branch of branches ?? []) {
        const branchProps = (branch.properties as Record<string, JsonSchema> | undefined) ?? {};
        for (const [key, propSchema] of Object.entries(branchProps)) {
          if (!(key in properties)) properties[key] = propSchema;
        }
      }
      const json: JsonSchema = { type: 'object', properties, additionalProperties: false };
      if (branches) json.oneOf = branches;
      if (description !== undefined) json.description = description;
      return json;
    },
    describe: (nextDescription: string) => asObjectSchema(inner, nextDescription),
  };
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const idSchema: Schema<Id> = s.string();
const emptyParamsSchema = s.object({});

const ITEM_TYPE_VALUES = ['presentation', 'lyric'] as const satisfies readonly ItemType[];
const itemTypeSchema = s.enum(ITEM_TYPE_VALUES);

const THEME_OWNER_TYPE_VALUES = ['presentation', 'lyric', 'overlay'] as const satisfies readonly ThemeOwnerType[];
const themeOwnerTypeSchema = s.enum(THEME_OWNER_TYPE_VALUES);

const MEDIA_ASSET_TYPE_VALUES = ['image', 'video', 'audio'] as const satisfies readonly MediaAssetType[];
const mediaAssetTypeSchema = s.enum(MEDIA_ASSET_TYPE_VALUES);

const MOVE_DIRECTION_VALUES = ['up', 'down'] as const;

const itemRefSchema = s.object({
  type: itemTypeSchema,
  id: idSchema.describe("The item's own id, not a slide or theme id"),
}) satisfies Schema<ItemRef>;

// ---------------------------------------------------------------------------
// Slide element payloads (agent-facing: image/video carry `assetId` instead
// of the session-scoped `src` token).
// ---------------------------------------------------------------------------

const ELEMENT_LAYER_VALUES = ['background', 'media', 'content'] as const satisfies readonly SlideElementBase['layer'][];
const elementLayerSchema = s.enum(ELEMENT_LAYER_VALUES);

const STROKE_POSITION_VALUES = ['inside', 'center', 'outside'] as const satisfies readonly StrokePosition[];
const strokePositionSchema = s.enum(STROKE_POSITION_VALUES);

const MEDIA_FIT_VALUES = ['cover', 'contain', 'fill'] as const satisfies readonly SlideBackgroundFit[];
const mediaFitSchema = s.enum(MEDIA_FIT_VALUES);

// Every field shared by text/image/video/shape elements. Individually
// optional here; a variant that needs one required (e.g. shape's
// `fillColor`) overrides it when spreading this object into its own props.
const visualPayloadProps = {
  name: s.optional(s.string().describe('Display name shown in the layers panel')),
  visible: s.optional(s.boolean()),
  locked: s.optional(s.boolean()),
  flipX: s.optional(s.boolean()),
  flipY: s.optional(s.boolean()),
  fillEnabled: s.optional(s.boolean()),
  fillColor: s.optional(s.string().describe('Hex color, e.g. #RRGGBB or #RRGGBBAA')),
  strokeEnabled: s.optional(s.boolean()),
  strokeColor: s.optional(s.string().describe('Hex color')),
  strokeWidth: s.optional(s.number()),
  strokePosition: s.optional(strokePositionSchema),
  borderRadius: s.optional(s.number()),
  shadowEnabled: s.optional(s.boolean()),
  shadowColor: s.optional(s.string().describe('Hex color')),
  shadowBlur: s.optional(s.number()),
  shadowOffsetX: s.optional(s.number()),
  shadowOffsetY: s.optional(s.number()),
};

const TEXT_HORIZONTAL_ALIGN_VALUES = ['start', 'end', 'left', 'right', 'center', 'justify'] as const satisfies readonly TextHorizontalAlign[];
const TEXT_VERTICAL_ALIGN_VALUES = ['top', 'middle', 'bottom'] as const satisfies readonly TextVerticalAlign[];
const TEXT_CASE_TRANSFORM_VALUES = ['none', 'uppercase', 'sentence'] as const satisfies readonly TextCaseTransform[];
const TEXT_BINDING_KIND_VALUES = [
  'timer',
  'clock',
  'current-slide-text',
  'next-slide-text',
  'slide-notes',
] as const satisfies readonly TextBindingKind[];
const CLOCK_FORMAT_VALUES = ['12h', '12h-seconds', '24h', '24h-seconds'] as const satisfies readonly ClockFormat[];
const TIMER_FORMAT_VALUES = ['mm:ss', 'hh:mm:ss'] as const satisfies readonly TimerFormat[];
const TEXT_FORMAT_VALUES = ['plain', 'rich'] as const;

const textBindingSchema = s.object({
  kind: s.enum(TEXT_BINDING_KIND_VALUES),
  timerDurationSeconds: s.optional(s.number()),
  timerFormat: s.optional(s.enum(TIMER_FORMAT_VALUES)),
  clockFormat: s.optional(s.enum(CLOCK_FORMAT_VALUES)),
}) satisfies Schema<TextBinding>;

const richRunSchema = s.object({
  text: s.string(),
  color: s.optional(s.string().describe('Hex color; overrides the box style for this run only')),
  weight: s.optional(s.number().describe('Numeric font weight, e.g. 400 or 700')),
  italic: s.optional(s.boolean()),
  underline: s.optional(s.boolean()),
  strikethrough: s.optional(s.boolean()),
  fontSize: s.optional(s.number().describe('Absolute px override for this run only')),
}) satisfies Schema<RichRun>;

const richBlockSchema = s.object({
  runs: s.array(richRunSchema),
  listType: s.optional(s.enum(['bullet', 'number'] as const)),
  indent: s.number(),
}) satisfies Schema<RichBlock>;

const richBodySchema: Schema<RichBody> = s.array(richBlockSchema);

const textElementPayloadSchema = s.object({
  ...visualPayloadProps,
  text: s.string(),
  fontFamily: s.string(),
  fontSize: s.number(),
  color: s.string().describe('Hex color, e.g. #RRGGBB'),
  alignment: s.enum(TEXT_HORIZONTAL_ALIGN_VALUES),
  verticalAlign: s.optional(s.enum(TEXT_VERTICAL_ALIGN_VALUES)),
  autoFit: s.optional(s.boolean()),
  autoFitMaxFontSize: s.optional(s.number()),
  caseTransform: s.optional(s.enum(TEXT_CASE_TRANSFORM_VALUES)),
  italic: s.optional(s.boolean()),
  underline: s.optional(s.boolean()),
  strikethrough: s.optional(s.boolean()),
  lineHeight: s.optional(s.number()),
  letterSpacing: s.optional(s.number().describe('Extra space between characters in px at the authored font size; default 0')),
  weight: s.optional(s.string().describe("Font weight, e.g. '400' or 'bold'")),
  textStrokeEnabled: s.optional(s.boolean()),
  textStrokeColor: s.optional(s.string()),
  textStrokeWidth: s.optional(s.number()),
  textStrokePosition: s.optional(strokePositionSchema),
  textShadowEnabled: s.optional(s.boolean()),
  textShadowColor: s.optional(s.string()),
  textShadowBlur: s.optional(s.number()),
  textShadowOffsetX: s.optional(s.number()),
  textShadowOffsetY: s.optional(s.number()),
  binding: s.optional(textBindingSchema),
  format: s.optional(s.enum(TEXT_FORMAT_VALUES).describe("'rich' means richBody is authoritative; 'plain'/absent means text is authoritative")),
  richBody: s.optional(richBodySchema),
}) satisfies Schema<TextElementPayload>;

/** Agent-facing deviation: `src` (a session-scoped `cast-media://` token) replaced by a stable `assetId`. */
export type AgentImageElementPayload = Omit<ImageElementPayload, 'src'> & { assetId: Id };
/** Agent-facing deviation: `src` replaced by a stable `assetId`. */
export type AgentVideoElementPayload = Omit<VideoElementPayload, 'src'> & { assetId: Id };

const agentImageElementPayloadSchema = s.object({
  ...visualPayloadProps,
  assetId: idSchema.describe('Image media asset id, from media.list'),
  fit: s.optional(mediaFitSchema),
}) satisfies Schema<AgentImageElementPayload>;

const agentVideoElementPayloadSchema = s.object({
  ...visualPayloadProps,
  assetId: idSchema.describe('Video media asset id, from media.list'),
  autoplay: s.boolean(),
  loop: s.boolean(),
  muted: s.optional(s.boolean()),
  playbackRate: s.optional(s.number()),
  fit: s.optional(mediaFitSchema),
}) satisfies Schema<AgentVideoElementPayload>;

// The domain `ShapeElementPayload` type declares fillColor/borderColor/
// borderWidth/borderRadius as all required (even though the hand-written RPC
// codec is more lenient in practice, per `SHAPE_OPTIONAL_FIELDS` in
// codecs.ts) — matched exactly here so this schema can satisfy
// `Schema<ShapeElementPayload>` and slot into `AgentSlideElementPayload`
// without a bespoke lenient variant.
const shapeElementPayloadSchema = s.object({
  ...visualPayloadProps,
  fillColor: s.string().describe('Hex color'),
  borderColor: s.string().describe('Hex color'),
  borderWidth: s.number(),
  borderRadius: s.number(),
}) satisfies Schema<ShapeElementPayload>;

/** Agent-facing deviation: group children are `AgentSlideElement[]`, recursively agent-ized. */
export interface AgentGroupElementPayload extends ElementVisualPayload {
  children: AgentSlideElement[];
}

export type AgentSlideElementPayload =
  | TextElementPayload
  | AgentImageElementPayload
  | AgentVideoElementPayload
  | ShapeElementPayload
  | AgentGroupElementPayload;

/** `SlideElement` with every image/video payload's `src` replaced by `assetId`, recursively through group children. */
export interface AgentSlideElement {
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
  layer: SlideElementBase['layer'];
  createdAt: string;
  updatedAt: string;
  payload: AgentSlideElementPayload;
  sourceThemeElementId?: Id | null;
  themeOverrideKeys?: string[] | null;
}

function fullElementBaseProps() {
  return {
    id: idSchema,
    slideId: idSchema,
    x: s.number().describe("Horizontal position in px from the slide's left edge"),
    y: s.number().describe("Vertical position in px from the slide's top edge"),
    width: s.number(),
    height: s.number(),
    rotation: s.number().describe('Degrees, clockwise'),
    opacity: s.number().describe('0 (invisible) to 1 (fully opaque)'),
    zIndex: s.number().describe('Stacking order within the slide; higher draws on top'),
    layer: elementLayerSchema,
    createdAt: s.string(),
    updatedAt: s.string(),
    sourceThemeElementId: s.optional(s.nullable(idSchema)),
    themeOverrideKeys: s.optional(s.nullable(s.array(s.string()))),
  };
}

// Recursive: a group element's children are themselves full elements, which
// may themselves be groups. `s.lazy` defers evaluation past the mutual
// forward reference to `agentGroupPayloadSchema` below.
const agentSlideElementSchema: Schema<AgentSlideElement> = s.lazy(() =>
  s.discriminatedUnion('type', [
    s.object({ ...fullElementBaseProps(), type: s.literal('text'), payload: textElementPayloadSchema }),
    s.object({ ...fullElementBaseProps(), type: s.literal('image'), payload: agentImageElementPayloadSchema }),
    s.object({ ...fullElementBaseProps(), type: s.literal('video'), payload: agentVideoElementPayloadSchema }),
    s.object({ ...fullElementBaseProps(), type: s.literal('shape'), payload: shapeElementPayloadSchema }),
    s.object({ ...fullElementBaseProps(), type: s.literal('group'), payload: agentGroupPayloadSchema }),
  ]),
);

const agentGroupPayloadSchema = s.object({
  ...visualPayloadProps,
  children: s.array(agentSlideElementSchema),
}) satisfies Schema<AgentGroupElementPayload>;

// ---------------------------------------------------------------------------
// element.create / element.createMany
// ---------------------------------------------------------------------------

/** Agent-facing deviation of `ElementCreateInput`: image/video payloads carry `assetId`, not `src`. */
export interface AgentElementCreateInput {
  id?: Id;
  slideId: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload: AgentSlideElementPayload;
  sourceThemeElementId?: Id | null;
  themeOverrideKeys?: string[] | null;
}

function createElementBaseProps() {
  return {
    id: s.optional(idSchema),
    slideId: idSchema,
    x: s.number().describe("Horizontal position in px from the slide's left edge"),
    y: s.number().describe("Vertical position in px from the slide's top edge"),
    width: s.number(),
    height: s.number(),
    rotation: s.optional(s.number().describe('Degrees, clockwise; default 0')),
    opacity: s.optional(s.number().describe('0 (invisible) to 1 (fully opaque); default 1')),
    zIndex: s.optional(s.number().describe('Stacking order within the slide; higher draws on top')),
    layer: s.optional(elementLayerSchema),
    sourceThemeElementId: s.optional(s.nullable(idSchema)),
    themeOverrideKeys: s.optional(s.nullable(s.array(s.string()))),
  };
}

/**
 * Cross-validated against the sibling `type` field (mirrors
 * `decodeElementCreateInput`/`decodeSlideElementPayload` in codecs.ts, which
 * dispatch the payload validator off the declared `type` rather than
 * accepting any structurally-valid payload). Used directly as
 * `element.create`'s params (wrapped via `asObjectSchema`, since its own
 * root shape is a discriminated union) and as `element.createMany`'s array
 * item type (nested, no wrapping needed there).
 */
const elementCreateVariantSchema = s.discriminatedUnion('type', [
  s.object({ ...createElementBaseProps(), type: s.literal('text'), payload: textElementPayloadSchema }),
  s.object({ ...createElementBaseProps(), type: s.literal('image'), payload: agentImageElementPayloadSchema }),
  s.object({ ...createElementBaseProps(), type: s.literal('video'), payload: agentVideoElementPayloadSchema }),
  s.object({ ...createElementBaseProps(), type: s.literal('shape'), payload: shapeElementPayloadSchema }),
  s.object({ ...createElementBaseProps(), type: s.literal('group'), payload: agentGroupPayloadSchema }),
]) satisfies Schema<AgentElementCreateInput>;

const elementCreateSchema = asObjectSchema(elementCreateVariantSchema);

// ---------------------------------------------------------------------------
// element.update / element.updateMany
// ---------------------------------------------------------------------------

/**
 * Agent-facing deviation of `ElementUpdateInput`. `payload`, when present, is
 * NOT cross-validated against a `type` (there is none to cross-validate
 * against — see `decodeElementUpdateInput`'s own comment on why: the
 * existing row's `type` is only known one layer further in, in the
 * repository). `payload` here accepts any of the five payload shapes.
 */
export interface AgentElementUpdateInput {
  id: Id;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload?: AgentSlideElementPayload;
  themeOverrideKeys?: string[] | null;
}

const agentSlideElementPayloadUnionSchema = s.union([
  textElementPayloadSchema,
  agentImageElementPayloadSchema,
  agentVideoElementPayloadSchema,
  shapeElementPayloadSchema,
  agentGroupPayloadSchema,
]) satisfies Schema<AgentSlideElementPayload>;

const elementUpdateSchema = s.object({
  id: idSchema,
  x: s.optional(s.number()),
  y: s.optional(s.number()),
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  rotation: s.optional(s.number()),
  opacity: s.optional(s.number()),
  zIndex: s.optional(s.number()),
  layer: s.optional(elementLayerSchema),
  payload: s.optional(agentSlideElementPayloadUnionSchema),
  themeOverrideKeys: s.optional(s.nullable(s.array(s.string()))),
}) satisfies Schema<AgentElementUpdateInput>;

// ---------------------------------------------------------------------------
// Slide backgrounds (agent-facing: image/video carry `assetId`, not `src`).
// ---------------------------------------------------------------------------

const gradientStopSchema = s.object({
  color: s.string().describe('Hex color'),
  position: s.number().describe('0-100, position along the gradient'),
}) satisfies Schema<GradientStop>;

const GRADIENT_KIND_VALUES = ['linear', 'radial'] as const satisfies readonly SlideGradient['kind'][];

const slideGradientSchema = s.object({
  kind: s.enum(GRADIENT_KIND_VALUES),
  angle: s.optional(s.number().describe('Degrees from the +x axis; linear gradients only')),
  stops: s.array(gradientStopSchema, { minItems: 2 }),
}) satisfies Schema<SlideGradient>;

export type AgentSlideBackground =
  | { type: 'color'; color: string }
  | { type: 'gradient'; gradient: SlideGradient }
  | { type: 'image'; assetId: Id; fit: SlideBackgroundFit }
  | { type: 'video'; assetId: Id; fit: SlideBackgroundFit };

const agentSlideBackgroundSchema = s.discriminatedUnion('type', [
  s.object({ type: s.literal('color'), color: s.string().describe('CSS color, e.g. #RRGGBB or rgba(...)') }),
  s.object({ type: s.literal('gradient'), gradient: slideGradientSchema }),
  s.object({ type: s.literal('image'), assetId: idSchema.describe('Image media asset id, from media.list'), fit: mediaFitSchema }),
  s.object({ type: s.literal('video'), assetId: idSchema.describe('Video media asset id, from media.list'), fit: mediaFitSchema }),
]) satisfies Schema<AgentSlideBackground>;

/** Agent-facing deviation of `SlideBackgroundUpdateInput`. */
export interface AgentSlideBackgroundUpdateInput {
  slideId: Id;
  background: AgentSlideBackground | null;
}

const slideUpdateBackgroundSchema = s.object({
  slideId: idSchema,
  background: s.nullable(agentSlideBackgroundSchema),
}) satisfies Schema<AgentSlideBackgroundUpdateInput>;

// ---------------------------------------------------------------------------
// Overlays / themes / stages (agent-facing: `elements`/`background` reuse
// the agent-ized element and background schemas above).
// ---------------------------------------------------------------------------

const OVERLAY_ANIMATION_KIND_VALUES = ['none', 'dissolve', 'fade', 'pulse'] as const satisfies readonly OverlayAnimation['kind'][];

const overlayAnimationSchema = s.object({
  kind: s.enum(OVERLAY_ANIMATION_KIND_VALUES),
  durationMs: s.number(),
  autoClearDurationMs: s.optional(s.nullable(s.number())),
}) satisfies Schema<OverlayAnimation>;

export interface AgentOverlayCreateInput {
  name: string;
  elements?: AgentSlideElement[];
  animation?: OverlayAnimation;
}
export interface AgentOverlayUpdateInput {
  id: Id;
  name?: string;
  elements?: AgentSlideElement[];
  animation?: OverlayAnimation;
}

const overlayCreateSchema = s.object({
  name: s.string(),
  elements: s.optional(s.array(agentSlideElementSchema)),
  animation: s.optional(overlayAnimationSchema),
}) satisfies Schema<AgentOverlayCreateInput>;

const overlayUpdateSchema = s.object({
  id: idSchema,
  name: s.optional(s.string()),
  elements: s.optional(s.array(agentSlideElementSchema)),
  animation: s.optional(overlayAnimationSchema),
}) satisfies Schema<AgentOverlayUpdateInput>;

export interface AgentThemeCreateInput {
  name: string;
  themeType: ThemeOwnerType;
  width?: number;
  height?: number;
  background?: AgentSlideBackground | null;
  elements?: AgentSlideElement[];
}
export interface AgentThemeUpdateInput {
  id: Id;
  themeType: ThemeOwnerType;
  name?: string;
  width?: number;
  height?: number;
  background?: AgentSlideBackground | null;
  elements?: AgentSlideElement[];
}

const themeCreateSchema = s.object({
  name: s.string(),
  themeType: themeOwnerTypeSchema,
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  background: s.optional(s.nullable(agentSlideBackgroundSchema)),
  elements: s.optional(s.array(agentSlideElementSchema)),
}) satisfies Schema<AgentThemeCreateInput>;

const themeUpdateSchema = s.object({
  id: idSchema,
  themeType: themeOwnerTypeSchema.describe('Which of the three per-owner theme tables this id lives in'),
  name: s.optional(s.string()),
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  background: s.optional(s.nullable(agentSlideBackgroundSchema)),
  elements: s.optional(s.array(agentSlideElementSchema)),
}) satisfies Schema<AgentThemeUpdateInput>;

export interface AgentStageCreateInput {
  name: string;
  width?: number;
  height?: number;
  elements?: AgentSlideElement[];
}
export interface AgentStageUpdateInput {
  id: Id;
  name?: string;
  width?: number;
  height?: number;
  elements?: AgentSlideElement[];
}

const stageCreateSchema = s.object({
  name: s.string(),
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  elements: s.optional(s.array(agentSlideElementSchema)),
}) satisfies Schema<AgentStageCreateInput>;

const stageUpdateSchema = s.object({
  id: idSchema,
  name: s.optional(s.string()),
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  elements: s.optional(s.array(agentSlideElementSchema)),
}) satisfies Schema<AgentStageUpdateInput>;

// ---------------------------------------------------------------------------
// Cues. `cuePayloadSchema` mirrors `decodeCuePayload` in codecs.ts exactly:
// each payload shape is validated independently of the cue's `kind` — the
// real RPC codec does not cross-validate kind against payload either (any
// structurally-valid `CuePayload` is accepted regardless of `kind`), so this
// is not a looser guard than the backend's, just an equally-loose one.
// ---------------------------------------------------------------------------

const CUE_KIND_VALUES = [
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
] as const satisfies readonly CueKind[];
const cueKindSchema = s.enum(CUE_KIND_VALUES);

const CUE_CLEAR_LAYER_VALUES = ['media', 'video', 'content', 'overlay'] as const satisfies readonly CueClearLayer[];
const cueClearLayerSchema = s.enum(CUE_CLEAR_LAYER_VALUES);

const LIFECYCLE_ACTION_VALUES = ['cancel', 'revert'] as const satisfies readonly LifecycleAction[];
const lifecycleActionSchema = s.enum(LIFECYCLE_ACTION_VALUES);

const lifecycleTargetSchema = s.union([
  idSchema,
  s.literal('*').describe("'*' targets every currently active run"),
]) satisfies Schema<LifecycleTarget>;

const CUE_FAILURE_POLICY_VALUES = ['continue', 'abort'] as const satisfies readonly CueFailurePolicy[];
const cueFailurePolicySchema = s.enum(CUE_FAILURE_POLICY_VALUES);

const cuePayloadSchema = s.union([
  s.object({ overlayId: idSchema }),
  s.object({ assetId: idSchema }),
  s.object({ stageId: idSchema }),
  s.object({ layer: cueClearLayerSchema }),
  s.object({ action: lifecycleActionSchema, target: lifecycleTargetSchema }),
  s.object({}),
]) satisfies Schema<CuePayload>;

const cueCreateSchema = s.object({
  kind: cueKindSchema.describe('Which built-in operation this cue performs; determines the accepted payload shape'),
  payload: cuePayloadSchema,
  failurePolicy: s.optional(cueFailurePolicySchema),
}) satisfies Schema<CueCreateInput>;

const cueUpdateSchema = s.object({
  id: idSchema,
  kind: s.optional(cueKindSchema),
  payload: s.optional(cuePayloadSchema),
  failurePolicy: s.optional(cueFailurePolicySchema),
}) satisfies Schema<CueUpdateInput>;

// ---------------------------------------------------------------------------
// Macros / trigger bindings / playback schedules
// ---------------------------------------------------------------------------

const SCOPE_LEVEL_VALUES = ['global', 'item', 'slide'] as const satisfies readonly ScopeLevel[];
const scopeLevelSchema = s.enum(SCOPE_LEVEL_VALUES);

const ON_SCOPE_EXIT_VALUES = ['cancel', 'revert', 'none'] as const satisfies readonly OnScopeExit[];
const onScopeExitSchema = s.enum(ON_SCOPE_EXIT_VALUES);

const macroCueCreateEntrySchema = s.object({
  cueId: idSchema,
  orderIndex: s.number().describe('0-based position of this cue within the macro'),
  delayBeforeMs: s.optional(s.number()),
  delayAfterMs: s.optional(s.number()),
}) satisfies Schema<NonNullable<MacroCreateInput['cues']>[number]>;

const macroCueUpdateEntrySchema = s.object({
  id: s.optional(idSchema.describe('Existing macro-cue row id; omit when adding a new cue to the macro')),
  cueId: idSchema,
  orderIndex: s.number().describe('0-based position of this cue within the macro'),
  delayBeforeMs: s.optional(s.number()),
  delayAfterMs: s.optional(s.number()),
}) satisfies Schema<NonNullable<MacroUpdateInput['cues']>[number]>;

const macroCreateSchema = s.object({
  name: s.string(),
  description: s.optional(s.string()),
  scopeLevel: s.optional(scopeLevelSchema),
  onScopeExit: s.optional(onScopeExitSchema),
  loopEnabled: s.optional(s.boolean()),
  loopCount: s.optional(s.nullable(s.number().describe('Max loop iterations; null loops until scope exit or cancel'))),
  cues: s.optional(s.array(macroCueCreateEntrySchema)),
}) satisfies Schema<MacroCreateInput>;

const macroUpdateSchema = s.object({
  id: idSchema,
  name: s.optional(s.string()),
  description: s.optional(s.string()),
  scopeLevel: s.optional(scopeLevelSchema),
  onScopeExit: s.optional(onScopeExitSchema),
  loopEnabled: s.optional(s.boolean()),
  loopCount: s.optional(s.nullable(s.number())),
  cues: s.optional(s.array(macroCueUpdateEntrySchema)),
}) satisfies Schema<MacroUpdateInput>;

const TRIGGER_TYPE_VALUES = ['slide.take', 'slide.activate', 'app.startup'] as const satisfies readonly TriggerType[];
const triggerTypeSchema = s.enum(TRIGGER_TYPE_VALUES);

const TRIGGER_BINDING_TARGET_TYPE_VALUES = ['cue', 'macro'] as const satisfies readonly TriggerBindingTargetType[];
const triggerBindingTargetTypeSchema = s.enum(TRIGGER_BINDING_TARGET_TYPE_VALUES);

const triggerBindingCreateSchema = s.object({
  triggerType: triggerTypeSchema,
  sourceId: s.nullable(idSchema.describe('Id the trigger fires from (e.g. a specific slide); null for a global trigger like app.startup')),
  targetType: triggerBindingTargetTypeSchema,
  targetId: idSchema,
  config: s.optional(s.record(s.unknown())),
  enabled: s.optional(s.boolean()),
}) satisfies Schema<TriggerBindingCreateInput>;

const slideTimingStepSchema = s.object({
  slideId: idSchema,
  durationMs: s.number().describe('Step duration in milliseconds'),
}) satisfies Schema<SlideTimingStep>;

const audioSlideMarkerSchema = s.object({
  id: idSchema,
  timeMs: s.number().describe('Marker time in milliseconds from the track start'),
  slideId: s.nullable(idSchema),
}) satisfies Schema<AudioSlideMarker>;

const scheduleItemRefSchema = s.object({
  type: s.enum(ITEM_TYPE_VALUES),
  id: idSchema,
});

const slideTimingScheduleSchema = s.object({
  id: idSchema,
  itemRef: s.nullable(scheduleItemRefSchema),
  enabled: s.boolean(),
  kind: s.literal('slide-timing'),
  steps: s.array(slideTimingStepSchema),
});

const audioSyncScheduleSchema = s.object({
  id: idSchema,
  itemRef: s.nullable(scheduleItemRefSchema),
  enabled: s.boolean(),
  kind: s.literal('audio-sync'),
  audioAssetId: idSchema,
  markers: s.array(audioSlideMarkerSchema),
});

const playbackScheduleSchema = s.discriminatedUnion('kind', [
  slideTimingScheduleSchema,
  audioSyncScheduleSchema,
]) satisfies Schema<PlaybackSchedule>;

const scheduleSaveSchema = s.object({ schedule: playbackScheduleSchema });

// ---------------------------------------------------------------------------
// Slide tags
// ---------------------------------------------------------------------------

const slideTagColorKeySchema = s.enum(SLIDE_TAG_COLOR_KEYS);

const slideTagCreateSchema = s.object({
  name: s.string(),
  colorKey: slideTagColorKeySchema,
}) satisfies Schema<SlideTagCreateInput>;

const slideTagUpdateSchema = s.object({
  id: idSchema,
  name: s.optional(s.string()),
  colorKey: s.optional(slideTagColorKeySchema),
  order: s.optional(s.number().describe('0-based position in the slide tag list')),
}) satisfies Schema<SlideTagUpdateInput>;

const slideTagAssignSchema = s.object({
  slideIds: s.array(idSchema),
  tagId: s.nullable(idSchema.describe('Tag to assign; null clears the assignment')),
}) satisfies Schema<SlideTagAssignInput>;

// ---------------------------------------------------------------------------
// Playlists / separators / items
// ---------------------------------------------------------------------------

const playlistCreateSchema = s.object({ name: s.string() });
const playlistRenameSchema = s.object({ id: idSchema, name: s.string() });
const playlistDeleteSchema = s.object({ id: idSchema });
const playlistSetOrderSchema = s.object({
  playlistId: idSchema,
  newOrder: s.number().describe('0-based target position among all playlists'),
});
const playlistGetSchema = s.object({ id: idSchema }) satisfies Schema<PlaylistGetInput>;
const playlistAddItemSchema = s.object({
  playlistId: idSchema,
  itemRef: itemRefSchema,
  position: s.optional(s.number().describe('0-based row position; appends to the end when omitted')),
});
const playlistMoveRowSchema = s.object({
  rowId: idSchema.describe('The row id (an item entry or a separator), not the item id'),
  newOrder: s.number().describe("0-based target position within the playlist's flat row list"),
});
const playlistRemoveRowSchema = s.object({ rowId: idSchema });

const separatorCreateSchema = s.object({ playlistId: idSchema, label: s.string() });
const separatorRenameSchema = s.object({ id: idSchema, label: s.string() });
const separatorSetColorSchema = s.object({
  id: idSchema,
  colorKey: s.nullable(s.string()).describe('A color key, or null to clear back to the default'),
});

const itemCreateSchema = s.object({
  type: itemTypeSchema,
  title: s.optional(s.string()),
  themeId: s.optional(s.nullable(idSchema)),
  playlistId: s.optional(s.nullable(idSchema).describe('Attach the new item to this playlist at creation time')),
  position: s.optional(s.number().describe('0-based row position within playlistId; appends when omitted')),
  blankSlideMode: s.optional(s.enum(['none', 'start', 'end', 'both'] as const).describe('Lyrics only: runtime blank slides at neither end, the start, the end, or both')),
}) satisfies Schema<ItemCreateInput>;

const itemDuplicateSchema = s.object({
  type: s.enum(['presentation', 'lyric'] as const),
  id: idSchema,
}) satisfies Schema<ItemDuplicateInput>;

const itemRenameSchema = s.object({ ref: itemRefSchema, title: s.string() });
const itemMoveSchema = s.object({ ref: itemRefSchema, direction: s.enum(MOVE_DIRECTION_VALUES) });
const itemDeleteSchema = s.object({ ref: itemRefSchema });

const itemListSchema = s.object({
  type: s.optional(itemTypeSchema),
  query: s.optional(s.string().describe('Case-insensitive substring match on title')),
  limit: s.optional(s.number({ min: 0 }).describe('Defaults to 100, capped at 500')),
  offset: s.optional(s.number({ min: 0 })),
}) satisfies Schema<ItemListInput>;

const itemGetSchema = s.object({
  ref: itemRefSchema,
  includeSlides: s.optional(s.boolean()),
  includeElements: s.optional(s.boolean().describe('Has no effect unless includeSlides is also true')),
}) satisfies Schema<ItemGetInput>;

const itemApplyThemeSchema = s.object({ themeId: idSchema, itemRef: itemRefSchema });
const itemDetachThemeSchema = s.object({ itemRef: itemRefSchema });
const lyricBlankSlidesSchema = s.object({
  lyricId: idSchema,
  mode: s.enum(['none', 'start', 'end', 'both'] as const),
}) satisfies Schema<LyricBlankSlidesUpdateInput>;

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

const slideCreateSchema = s.object({
  presentationId: s.optional(s.nullable(idSchema).describe('Owning presentation; exactly one of presentationId/lyricId should be set')),
  lyricId: s.optional(s.nullable(idSchema)),
  width: s.optional(s.number()),
  height: s.optional(s.number()),
}) satisfies Schema<SlideCreateInput>;

const slideDuplicateSchema = s.object({ slideId: idSchema });
const slideDeleteSchema = s.object({ slideId: idSchema });

const slideSetOrderSchema = s.object({
  slideId: idSchema,
  newOrder: s.number().describe("0-based target position within the slide's item"),
}) satisfies Schema<SlideOrderUpdateInput>;

const slideUpdateNotesSchema = s.object({
  slideId: idSchema,
  notes: s.string(),
}) satisfies Schema<SlideNotesUpdateInput>;

const slideGetSchema = s.object({
  slideId: idSchema,
  includeElements: s.optional(s.boolean()),
}) satisfies Schema<SlideGetInput>;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Agent-facing: not `MediaAssetCreateInput` — `path` is a filesystem path the dispatcher turns into a managed-media `src` token before calling `createMediaAsset`. */
export interface AgentMediaImportParams {
  path: string;
  name?: string;
  type?: MediaAssetType;
}
/** Agent-facing: not `{id, src}` — `path` is a filesystem path the dispatcher turns into a managed-media `src` token before calling `updateMediaAssetSrc`. */
export interface AgentMediaReplaceSourceParams {
  id: Id;
  path: string;
}

const mediaImportSchema = s.object({
  path: s.string().describe('Absolute filesystem path to the media file to import'),
  name: s.optional(s.string()),
  type: s.optional(mediaAssetTypeSchema),
}) satisfies Schema<AgentMediaImportParams>;

const mediaReplaceSourceSchema = s.object({
  id: idSchema,
  path: s.string().describe('Absolute filesystem path to the replacement media file'),
}) satisfies Schema<AgentMediaReplaceSourceParams>;

const mediaDeleteSchema = s.object({ id: idSchema });
const mediaEnsureDerivativeSchema = s.object({ assetId: idSchema });

const mediaListSchema = s.object({
  type: s.optional(mediaAssetTypeSchema),
  query: s.optional(s.string().describe('Case-insensitive substring match on name')),
  limit: s.optional(s.number({ min: 0 }).describe('Defaults to 100, capped at 500')),
  offset: s.optional(s.number({ min: 0 })),
}) satisfies Schema<MediaAssetListInput>;

// ---------------------------------------------------------------------------
// Overlays / themes / stages: simple positional actions
// ---------------------------------------------------------------------------

const overlaySetEnabledSchema = s.object({ overlayId: idSchema, enabled: s.boolean() });
const overlayDeleteSchema = s.object({ overlayId: idSchema });
const overlaySetOrderSchema = s.object({ overlayId: idSchema, newOrder: s.number().describe('0-based target position in the overlay list') });
const overlayApplyThemeSchema = s.object({ themeId: idSchema, overlayId: idSchema });

const themeDeleteSchema = s.object({
  themeId: idSchema,
  themeType: themeOwnerTypeSchema.describe('Which of the three per-owner theme tables themeId lives in'),
});
const themeSetOrderSchema = s.object({
  themeId: idSchema,
  themeType: themeOwnerTypeSchema,
  newOrder: s.number().describe("0-based target position within themeType's theme list"),
});
const themeSyncLinkedItemsSchema = s.object({
  themeId: idSchema,
  itemType: itemTypeSchema.describe('Which item table to re-apply the theme to (overlay themes have no linked items)'),
});
const themeListSchema = s.object({ ownerType: s.optional(themeOwnerTypeSchema) }) satisfies Schema<ThemeListInput>;

const stageDeleteSchema = s.object({ stageId: idSchema });
const stageDuplicateSchema = s.object({ stageId: idSchema });
const stageSetOrderSchema = s.object({ stageId: idSchema, newOrder: s.number().describe('0-based target position in the stage list') });

// ---------------------------------------------------------------------------
// Automation defs: simple positional actions
// ---------------------------------------------------------------------------

const cueDeleteSchema = s.object({ id: idSchema });
const macroDeleteSchema = s.object({ id: idSchema });
const macroSetOrderSchema = s.object({ macroId: idSchema, newOrder: s.number().describe('0-based target position in the macro list') });
const triggerBindingDeleteSchema = s.object({ id: idSchema });
const scheduleDeleteSchema = s.object({ id: idSchema });

// ---------------------------------------------------------------------------
// Project / bundles
// ---------------------------------------------------------------------------

const searchContentSchema = s.object({
  query: s.string(),
  limit: s.optional(s.number({ min: 0 }).describe('Defaults to 50')),
}) satisfies Schema<SearchContentInput>;

const bundleExportOptionsSchema = s.object({
  includeAllThemes: s.optional(s.boolean()),
  includeOverlays: s.optional(s.boolean()),
  includeStages: s.optional(s.boolean()),
  playlistIds: s.optional(s.array(idSchema).describe('Restrict export to these playlists; omit to export every playlist')),
}) satisfies Schema<BundleExportOptions>;

const projectExportBundleSchema = s.object({
  itemIds: s.array(idSchema),
  filePath: s.string().describe('Absolute filesystem path to write the bundle file to'),
  options: s.optional(bundleExportOptionsSchema),
});

const projectInspectBundleSchema = s.object({
  filePath: s.string().describe('Absolute filesystem path of a bundle file'),
});

const BUNDLE_BROKEN_REFERENCE_ACTION_VALUES = ['replace', 'remove', 'leave'] as const satisfies readonly BundleBrokenReferenceAction[];

const bundleBrokenReferenceDecisionSchema = s.object({
  source: s.string().describe('The broken media source string, exactly as reported by project.inspectBundle'),
  action: s.enum(BUNDLE_BROKEN_REFERENCE_ACTION_VALUES),
  replacementPath: s.optional(s.string().describe('Absolute filesystem path to substitute; required when action is "replace"')),
}) satisfies Schema<BundleBrokenReferenceDecision>;

const projectImportBundleSchema = s.object({
  filePath: s.string().describe('Absolute filesystem path of a bundle previously inspected via project.inspectBundle'),
  decisions: s.array(bundleBrokenReferenceDecisionSchema),
});

// --- project.restoreBackup: the full ProjectBackup envelope --------------

function backupTimestampProps() {
  return { created_at: s.string(), updated_at: s.string() };
}

const projectBackupItemRowSchema = s.object({
  id: idSchema,
  title: s.string(),
  theme_id: s.nullable(idSchema),
  order_index: s.number(),
  blank_slide_mode: s.optional(s.enum(['none', 'start', 'end', 'both'] as const)),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupItemRow>;

const SLIDE_KIND_VALUES = [
  'presentation',
  'lyric',
  'presentationTheme',
  'lyricTheme',
  'overlayTheme',
  'overlay',
  'stage',
] as const satisfies readonly SlideKind[];

const BACKGROUND_SOURCE_VALUES = ['theme', 'local'] as const satisfies readonly SlideBackgroundSource[];

const projectBackupSlideRowSchema = s.object({
  id: idSchema,
  presentation_id: s.nullable(idSchema),
  lyric_id: s.nullable(idSchema),
  presentation_theme_id: s.nullable(idSchema),
  lyric_theme_id: s.nullable(idSchema),
  overlay_theme_id: s.nullable(idSchema),
  overlay_id: s.nullable(idSchema),
  stage_id: s.nullable(idSchema),
  tag_id: s.nullable(idSchema),
  kind: s.enum(SLIDE_KIND_VALUES),
  width: s.number(),
  height: s.number(),
  notes: s.string(),
  background_json: s.nullable(s.string()),
  background_source: s.nullable(s.enum(BACKGROUND_SOURCE_VALUES)),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupSlideRow>;

const SLIDE_ELEMENT_TYPE_VALUES = ['text', 'image', 'video', 'shape', 'group'] as const satisfies readonly SlideElementType[];

const projectBackupSlideElementRowSchema = s.object({
  id: idSchema,
  slide_id: idSchema,
  type: s.enum(SLIDE_ELEMENT_TYPE_VALUES),
  x: s.number(),
  y: s.number(),
  width: s.number(),
  height: s.number(),
  rotation: s.number(),
  opacity: s.number(),
  z_index: s.number(),
  layer: elementLayerSchema,
  payload_json: s.string(),
  source_theme_element_id: s.nullable(idSchema),
  theme_override_keys_json: s.nullable(s.string()),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupSlideElementRow>;

const projectBackupPlaylistRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupPlaylistRow>;

const PLAYLIST_ENTRY_KIND_VALUES = ['item', 'separator'] as const;

const projectBackupPlaylistEntryRowSchema = s.object({
  id: idSchema,
  playlist_id: idSchema,
  kind: s.enum(PLAYLIST_ENTRY_KIND_VALUES),
  presentation_id: s.nullable(idSchema),
  lyric_id: s.nullable(idSchema),
  label: s.nullable(s.string()),
  color_key: s.nullable(s.string()),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupPlaylistEntryRow>;

const projectBackupMediaAssetRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  src: s.string(),
  width: s.nullable(s.number()),
  height: s.nullable(s.number()),
  duration: s.nullable(s.number()),
  codec: s.nullable(s.string()),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupMediaAssetRow>;

const projectBackupOverlayRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  enabled: s.number().describe('0 or 1'),
  animation_json: s.string(),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupOverlayRow>;

const projectBackupThemeRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  width: s.number(),
  height: s.number(),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupThemeRow>;

const projectBackupStageRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  width: s.number(),
  height: s.number(),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupStageRow>;

const projectBackupSlideTagRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  color_key: slideTagColorKeySchema,
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupSlideTagRow>;

const projectBackupCueRowSchema = s.object({
  id: idSchema,
  kind: cueKindSchema,
  payload_json: s.string(),
  failure_policy: cueFailurePolicySchema,
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupCueRow>;

const projectBackupMacroRowSchema = s.object({
  id: idSchema,
  name: s.string(),
  description: s.string(),
  scope_level: scopeLevelSchema,
  on_scope_exit: onScopeExitSchema,
  loop_enabled: s.number().describe('0 or 1'),
  loop_count: s.nullable(s.number()),
  order_index: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupMacroRow>;

const projectBackupMacroStepRowSchema = s.object({
  id: idSchema,
  action_id: idSchema,
  kind: cueKindSchema,
  payload_json: s.string(),
  failure_policy: cueFailurePolicySchema,
  cue_id: s.nullable(idSchema),
  order_index: s.number(),
  delay_before_ms: s.number(),
  delay_after_ms: s.number(),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupMacroStepRow>;

const projectBackupTriggerBindingRowSchema = s.object({
  id: idSchema,
  trigger_type: triggerTypeSchema,
  source_id: s.nullable(idSchema),
  target_type: triggerBindingTargetTypeSchema,
  target_id: idSchema,
  config_json: s.string(),
  enabled: s.number().describe('0 or 1'),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupTriggerBindingRow>;

const projectBackupPlaybackScheduleRowSchema = s.object({
  id: idSchema,
  item_ref_json: s.nullable(s.string()),
  enabled: s.number().describe('0 or 1'),
  kind: s.enum(['slide-timing', 'audio-sync'] as const),
  steps_json: s.nullable(s.string()),
  audio_asset_id: s.nullable(idSchema),
  markers_json: s.nullable(s.string()),
  ...backupTimestampProps(),
}) satisfies Schema<ProjectBackupPlaybackScheduleRow>;

const projectBackupTablesSchema = s.object({
  presentations: s.array(projectBackupItemRowSchema),
  lyrics: s.array(projectBackupItemRowSchema),
  slides: s.array(projectBackupSlideRowSchema),
  slide_elements: s.array(projectBackupSlideElementRowSchema),
  slide_tags: s.array(projectBackupSlideTagRowSchema),
  playlists: s.array(projectBackupPlaylistRowSchema),
  playlist_entries: s.array(projectBackupPlaylistEntryRowSchema),
  image_assets: s.array(projectBackupMediaAssetRowSchema),
  video_assets: s.array(projectBackupMediaAssetRowSchema),
  audio_assets: s.array(projectBackupMediaAssetRowSchema),
  overlays: s.array(projectBackupOverlayRowSchema),
  presentation_themes: s.array(projectBackupThemeRowSchema),
  lyric_themes: s.array(projectBackupThemeRowSchema),
  overlay_themes: s.array(projectBackupThemeRowSchema),
  stages: s.array(projectBackupStageRowSchema),
  cues: s.array(projectBackupCueRowSchema),
  actions: s.array(projectBackupMacroRowSchema),
  action_steps: s.array(projectBackupMacroStepRowSchema),
  trigger_bindings: s.array(projectBackupTriggerBindingRowSchema),
  playback_schedules: s.array(projectBackupPlaybackScheduleRowSchema),
}) satisfies Schema<ProjectBackupTables>;

const projectRestoreBackupSchema = s.object({
  format: s.literal('cast-project-backup'),
  version: s.literal(3),
  schemaVersion: s.number().describe('The database PRAGMA user_version this backup was exported at'),
  tables: projectBackupTablesSchema,
}) satisfies Schema<ProjectBackup>;

// ---------------------------------------------------------------------------
// Output / NDI
// ---------------------------------------------------------------------------

const NDI_OUTPUT_NAME_VALUES = ['audience', 'stage'] as const satisfies readonly NdiOutputName[];
const ndiOutputNameSchema = s.enum(NDI_OUTPUT_NAME_VALUES);

const outputSetEnabledSchema = s.object({ name: ndiOutputNameSchema, enabled: s.boolean() });

const ndiOutputConfigPatchSchema = s.object({
  senderName: s.optional(s.string()),
  withAlpha: s.optional(s.boolean()),
}) satisfies Schema<Partial<NdiOutputConfig>>;

const outputUpdateConfigSchema = s.object({ name: ndiOutputNameSchema, config: ndiOutputConfigPatchSchema });

// ---------------------------------------------------------------------------
// System: clipboard / logs
// ---------------------------------------------------------------------------

const clipboardWriteSchema = s.object({ text: s.string() });

const logsReadSessionSchema = s.object({
  filePath: s.string().describe('Session log file path, from logs.listSessions'),
  offset: s.number().describe('Byte offset to start reading from; 0 for the beginning'),
  limit: s.number().describe('Maximum number of lines to read'),
});

// ---------------------------------------------------------------------------
// `document.extractText` (main-site, bound to `agentExtractDocumentText`) and
// the seven now-`site: 'renderer'` canvas/render actions (see the module doc
// comment). Field names here are what `./action-bindings`'s
// `RendererActionParams` mirrors for those seven.
// ---------------------------------------------------------------------------

interface ReservedSlideRenderParams {
  slideId: Id;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg';
}
interface ReservedSlideRenderContactSheetParams {
  slideIds: Id[];
  columns?: number;
  thumbnailWidth?: number;
}
interface ReservedDocumentExtractTextParams {
  path: string;
  maxChars?: number;
}
interface ReservedElementSetRichTextParams {
  elementId: Id;
  text?: string;
  runs?: RichRun[];
}
interface ReservedElementGroupParams {
  elementIds: Id[];
  name?: string;
}
interface ReservedElementUngroupParams {
  groupId: Id;
}
interface ReservedElementAlignParams {
  elementIds: Id[];
  edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
  to?: 'selection' | 'slide';
}
interface ReservedElementDistributeParams {
  elementIds: Id[];
  axis: 'horizontal' | 'vertical';
}

const slideRenderSchema = s.object({
  slideId: idSchema,
  width: s.optional(s.number()),
  height: s.optional(s.number()),
  format: s.optional(s.enum(['png', 'jpeg'] as const)),
}) satisfies Schema<ReservedSlideRenderParams>;

const slideRenderContactSheetSchema = s.object({
  slideIds: s.array(idSchema),
  columns: s.optional(s.number()),
  thumbnailWidth: s.optional(s.number()),
}) satisfies Schema<ReservedSlideRenderContactSheetParams>;

const documentExtractTextSchema = s.object({
  path: s.string().describe('Absolute filesystem path to the document'),
  maxChars: s.optional(s.number()),
}) satisfies Schema<ReservedDocumentExtractTextParams>;

const elementSetRichTextSchema = s.object({
  elementId: idSchema,
  text: s.optional(s.string()),
  runs: s.optional(s.array(richRunSchema)),
}) satisfies Schema<ReservedElementSetRichTextParams>;

const elementGroupSchema = s.object({
  elementIds: s.array(idSchema),
  name: s.optional(s.string()),
}) satisfies Schema<ReservedElementGroupParams>;

const elementUngroupSchema = s.object({ groupId: idSchema }) satisfies Schema<ReservedElementUngroupParams>;

const elementAlignSchema = s.object({
  elementIds: s.array(idSchema),
  edge: s.enum(['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const),
  to: s.optional(s.enum(['selection', 'slide'] as const)),
}) satisfies Schema<ReservedElementAlignParams>;

const elementDistributeSchema = s.object({
  elementIds: s.array(idSchema),
  axis: s.enum(['horizontal', 'vertical'] as const),
}) satisfies Schema<ReservedElementDistributeParams>;

// ---------------------------------------------------------------------------
// Renderer-site actions. Typed directly against `RendererActionParams`
// (`./action-bindings`) so a drift there fails to compile here too.
// ---------------------------------------------------------------------------

const overlayModeSchema = s.enum(['single', 'multiple'] as const satisfies readonly ActionOverlayMode[]);
const workbenchModeSchema = s.enum([
  'show',
  'item-editor',
  'overlay-editor',
  'theme-editor',
  'stage-editor',
  'macro-editor',
  'settings',
] as const satisfies readonly ActionWorkbenchMode[]);
const slideBrowserModeSchema = s.enum(['grid', 'list'] as const satisfies readonly ActionSlideBrowserMode[]);
const programModeSchema = s.enum(['single', 'all'] as const satisfies readonly ActionProgramMode[]);

const slideActivateSchema = s.object({
  slideId: s.optional(idSchema),
  index: s.optional(s.number({ min: 0 }).describe('0-based index within the currently loaded item')),
}) satisfies Schema<RendererActionParams['slide.activate']>;

const slideJumpToSchema = s.object({
  index: s.number({ min: 0 }).describe('0-based index within the currently loaded item'),
}) satisfies Schema<RendererActionParams['slide.jumpTo']>;

const slideSelectSchema = s.object({
  slideId: s.optional(idSchema),
  index: s.optional(s.number({ min: 0 }).describe('0-based index within the currently loaded item')),
}) satisfies Schema<RendererActionParams['slide.select']>;

const slideSelectRangeSchema = s.object({
  fromIndex: s.number({ min: 0 }).describe('0-based'),
  toIndex: s.number({ min: 0 }).describe('0-based'),
}) satisfies Schema<RendererActionParams['slide.selectRange']>;

const overlayActivateSchema = s.object({ overlayId: idSchema }) satisfies Schema<RendererActionParams['overlay.activate']>;
const overlayClearSchema = s.object({ overlayId: idSchema }) satisfies Schema<RendererActionParams['overlay.clear']>;
const overlaySetModeSchema = s.object({ mode: overlayModeSchema }) satisfies Schema<RendererActionParams['overlay.setMode']>;
const mediaLayerSetSchema = s.object({ assetId: idSchema }) satisfies Schema<RendererActionParams['mediaLayer.set']>;

const videoArmSchema = s.object({ assetId: idSchema }) satisfies Schema<RendererActionParams['video.arm']>;
const videoSeekSchema = s.object({ seconds: s.number().describe('Seek target in seconds from the start') }) satisfies Schema<RendererActionParams['video.seek']>;
const videoSetVolumeSchema = s.object({ volume: s.number({ min: 0, max: 1 }).describe('0 (silent) to 1 (full volume)') }) satisfies Schema<RendererActionParams['video.setVolume']>;

const audioArmSchema = s.object({ assetId: idSchema }) satisfies Schema<RendererActionParams['audio.arm']>;
const audioSeekSchema = s.object({ seconds: s.number().describe('Seek target in seconds from the start') }) satisfies Schema<RendererActionParams['audio.seek']>;
const audioSetVolumeSchema = s.object({ volume: s.number({ min: 0, max: 1 }).describe('0 (silent) to 1 (full volume)') }) satisfies Schema<RendererActionParams['audio.setVolume']>;

const stageArmSchema = s.object({ stageId: idSchema }) satisfies Schema<RendererActionParams['stage.arm']>;
const macroRunSchema = s.object({ macroId: idSchema }) satisfies Schema<RendererActionParams['macro.run']>;
const cueRunSchema = s.object({ cueId: idSchema }) satisfies Schema<RendererActionParams['cue.run']>;

const workbenchSetModeSchema = s.object({ mode: workbenchModeSchema }) satisfies Schema<RendererActionParams['workbench.setMode']>;
const workbenchTogglePanelSchema = s.object({
  splitId: s.string(),
  paneId: s.string(),
}) satisfies Schema<RendererActionParams['workbench.togglePanel']>;
const workbenchSetSlideBrowserModeSchema = s.object({ mode: slideBrowserModeSchema }) satisfies Schema<RendererActionParams['workbench.setSlideBrowserMode']>;
const workbenchSetProgramModeSchema = s.object({ mode: programModeSchema }) satisfies Schema<RendererActionParams['workbench.setProgramMode']>;

const navigationSelectPlaylistSchema = s.object({ playlistId: idSchema }) satisfies Schema<RendererActionParams['navigation.selectPlaylist']>;
const navigationSelectPlaylistEntrySchema = s.object({ entryId: idSchema }) satisfies Schema<RendererActionParams['navigation.selectPlaylistEntry']>;
const navigationBrowseItemSchema = s.object({ ref: itemRefSchema }) satisfies Schema<RendererActionParams['navigation.browseItem']>;

const elementSelectSchema = s.object({ elementId: idSchema }) satisfies Schema<RendererActionParams['element.select']>;
const elementSelectManySchema = s.object({ elementIds: s.array(idSchema) }) satisfies Schema<RendererActionParams['element.selectMany']>;
const elementNudgeSchema = s.object({
  dx: s.number().describe('Horizontal offset in px'),
  dy: s.number().describe('Vertical offset in px'),
}) satisfies Schema<RendererActionParams['element.nudge']>;
const elementOptionalTargetSchema = s.object({
  elementId: s.optional(idSchema.describe('Omit to reorder the current selection')),
});
const elementToggleVisibilitySchema = s.object({ elementId: idSchema }) satisfies Schema<RendererActionParams['element.toggleVisibility']>;
const elementToggleLockSchema = s.object({ elementId: idSchema }) satisfies Schema<RendererActionParams['element.toggleLock']>;
const elementRenameSchema = s.object({
  elementId: idSchema,
  name: s.string(),
}) satisfies Schema<RendererActionParams['element.rename']>;

// ---------------------------------------------------------------------------
// ACTION_SCHEMAS
// ---------------------------------------------------------------------------

export interface ActionSchema {
  params: Schema<unknown>;
}

export const ACTION_SCHEMAS: Readonly<Record<ActionId, ActionSchema>> = {
  // --- Playlists (main) ---
  'playlist.create': { params: playlistCreateSchema },
  'playlist.rename': { params: playlistRenameSchema },
  'playlist.delete': { params: playlistDeleteSchema },
  'playlist.setOrder': { params: playlistSetOrderSchema },
  'playlist.list': { params: emptyParamsSchema },
  'playlist.get': { params: playlistGetSchema },
  'playlist.addItem': { params: playlistAddItemSchema },
  'playlist.moveRow': { params: playlistMoveRowSchema },
  'playlist.removeRow': { params: playlistRemoveRowSchema },
  'separator.create': { params: separatorCreateSchema },
  'separator.rename': { params: separatorRenameSchema },
  'separator.setColor': { params: separatorSetColorSchema },
  // --- Items (main) ---
  'item.create': { params: itemCreateSchema },
  'item.duplicate': { params: itemDuplicateSchema },
  'item.rename': { params: itemRenameSchema },
  'item.move': { params: itemMoveSchema },
  'item.delete': { params: itemDeleteSchema },
  'item.list': { params: itemListSchema },
  'item.get': { params: itemGetSchema },
  'item.applyTheme': { params: itemApplyThemeSchema },
  'item.detachTheme': { params: itemDetachThemeSchema },
  'lyric.setBlankSlides': { params: lyricBlankSlidesSchema },
  // --- Slides (main) ---
  'slide.create': { params: slideCreateSchema },
  'slide.duplicate': { params: slideDuplicateSchema },
  'slide.delete': { params: slideDeleteSchema },
  'slide.setOrder': { params: slideSetOrderSchema },
  'slide.updateNotes': { params: slideUpdateNotesSchema },
  'slide.updateBackground': { params: slideUpdateBackgroundSchema },
  'slide.get': { params: slideGetSchema },
  'slideTag.create': { params: slideTagCreateSchema },
  'slideTag.update': { params: slideTagUpdateSchema },
  'slideTag.delete': { params: s.object({ id: idSchema }) },
  'slideTag.assign': { params: slideTagAssignSchema },
  'slideTag.list': { params: emptyParamsSchema },
  // --- Elements (main) ---
  'element.create': { params: elementCreateSchema },
  'element.createMany': { params: s.object({ inputs: s.array(elementCreateVariantSchema) }) },
  'element.update': { params: elementUpdateSchema },
  'element.updateMany': { params: s.object({ inputs: s.array(elementUpdateSchema) }) },
  'element.delete': { params: s.object({ id: idSchema }) },
  'element.deleteMany': { params: s.object({ ids: s.array(idSchema) }) },
  // --- Media (main) ---
  'media.import': { params: mediaImportSchema },
  'media.delete': { params: mediaDeleteSchema },
  'media.replaceSource': { params: mediaReplaceSourceSchema },
  'media.reclaimLibrary': { params: emptyParamsSchema },
  'media.ensureDerivative': { params: mediaEnsureDerivativeSchema },
  'media.list': { params: mediaListSchema },
  // --- Overlays (main) ---
  'overlay.create': { params: overlayCreateSchema },
  'overlay.update': { params: overlayUpdateSchema },
  'overlay.setEnabled': { params: overlaySetEnabledSchema },
  'overlay.delete': { params: overlayDeleteSchema },
  'overlay.setOrder': { params: overlaySetOrderSchema },
  'overlay.applyTheme': { params: overlayApplyThemeSchema },
  'overlay.list': { params: emptyParamsSchema },
  // --- Themes (main) ---
  'theme.create': { params: themeCreateSchema },
  'theme.update': { params: themeUpdateSchema },
  'theme.delete': { params: themeDeleteSchema },
  'theme.setOrder': { params: themeSetOrderSchema },
  'theme.syncLinkedItems': { params: themeSyncLinkedItemsSchema },
  'theme.list': { params: themeListSchema },
  // --- Stages (main) ---
  'stage.create': { params: stageCreateSchema },
  'stage.update': { params: stageUpdateSchema },
  'stage.delete': { params: stageDeleteSchema },
  'stage.duplicate': { params: stageDuplicateSchema },
  'stage.setOrder': { params: stageSetOrderSchema },
  'stage.list': { params: emptyParamsSchema },
  // --- Automation defs (main) ---
  'cue.create': { params: cueCreateSchema },
  'cue.update': { params: cueUpdateSchema },
  'cue.delete': { params: cueDeleteSchema },
  'cue.list': { params: emptyParamsSchema },
  'macro.create': { params: macroCreateSchema },
  'macro.update': { params: macroUpdateSchema },
  'macro.delete': { params: macroDeleteSchema },
  'macro.setOrder': { params: macroSetOrderSchema },
  'macro.list': { params: emptyParamsSchema },
  'triggerBinding.create': { params: triggerBindingCreateSchema },
  'triggerBinding.delete': { params: triggerBindingDeleteSchema },
  'triggerBinding.list': { params: emptyParamsSchema },
  'schedule.save': { params: scheduleSaveSchema },
  'schedule.delete': { params: scheduleDeleteSchema },
  'schedule.list': { params: emptyParamsSchema },
  // --- Project (main) ---
  'project.getSnapshot': { params: emptyParamsSchema },
  'project.getOverview': { params: emptyParamsSchema },
  'project.search': { params: searchContentSchema },
  'project.exportBundle': { params: projectExportBundleSchema },
  'project.inspectBundle': { params: projectInspectBundleSchema },
  'project.importBundle': { params: projectImportBundleSchema },
  'project.restoreBackup': { params: projectRestoreBackupSchema },
  // --- Output (main) ---
  'output.setEnabled': { params: outputSetEnabledSchema },
  'output.getState': { params: emptyParamsSchema },
  'output.getConfigs': { params: emptyParamsSchema },
  'output.updateConfig': { params: outputUpdateConfigSchema },
  'output.getDiagnostics': { params: emptyParamsSchema },
  // --- System (main) ---
  'clipboard.read': { params: emptyParamsSchema },
  'clipboard.write': { params: clipboardWriteSchema },
  'logs.listSessions': { params: emptyParamsSchema },
  'logs.readSession': { params: logsReadSessionSchema },
  'logs.getCurrentPath': { params: emptyParamsSchema },
  'logs.getSystemMetrics': { params: emptyParamsSchema },
  // --- Reserved for upcoming features (main) ---
  'slide.render': { params: slideRenderSchema },
  'slide.renderContactSheet': { params: slideRenderContactSheetSchema },
  'document.extractText': { params: documentExtractTextSchema },
  'element.setRichText': { params: elementSetRichTextSchema },
  'element.group': { params: elementGroupSchema },
  'element.ungroup': { params: elementUngroupSchema },
  'element.align': { params: elementAlignSchema },
  'element.distribute': { params: elementDistributeSchema },
  // --- Take/nav (renderer) ---
  'slide.take': { params: emptyParamsSchema },
  'slide.activate': { params: slideActivateSchema },
  'slide.next': { params: emptyParamsSchema },
  'slide.previous': { params: emptyParamsSchema },
  'slide.jumpTo': { params: slideJumpToSchema },
  'slide.select': { params: slideSelectSchema },
  'slide.selectRange': { params: slideSelectRangeSchema },
  // --- Layers (renderer) ---
  'overlay.activate': { params: overlayActivateSchema },
  'overlay.clear': { params: overlayClearSchema },
  'overlay.clearAll': { params: emptyParamsSchema },
  'overlay.setMode': { params: overlaySetModeSchema },
  'mediaLayer.set': { params: mediaLayerSetSchema },
  'mediaLayer.clear': { params: emptyParamsSchema },
  'layer.clearContent': { params: emptyParamsSchema },
  'layer.clearAll': { params: emptyParamsSchema },
  // --- Video transport (renderer) ---
  'video.arm': { params: videoArmSchema },
  'video.clear': { params: emptyParamsSchema },
  'video.play': { params: emptyParamsSchema },
  'video.pause': { params: emptyParamsSchema },
  'video.seek': { params: videoSeekSchema },
  'video.setVolume': { params: videoSetVolumeSchema },
  'video.toggleMute': { params: emptyParamsSchema },
  'video.toggleLoop': { params: emptyParamsSchema },
  'video.next': { params: emptyParamsSchema },
  'video.previous': { params: emptyParamsSchema },
  // --- Audio transport (renderer) ---
  'audio.arm': { params: audioArmSchema },
  'audio.clear': { params: emptyParamsSchema },
  'audio.play': { params: emptyParamsSchema },
  'audio.pause': { params: emptyParamsSchema },
  'audio.seek': { params: audioSeekSchema },
  'audio.setVolume': { params: audioSetVolumeSchema },
  'audio.toggleMute': { params: emptyParamsSchema },
  'audio.toggleLoop': { params: emptyParamsSchema },
  'audio.next': { params: emptyParamsSchema },
  'audio.previous': { params: emptyParamsSchema },
  'audioSync.resume': { params: emptyParamsSchema },
  // --- Stage (renderer) ---
  'stage.arm': { params: stageArmSchema },
  'stage.clear': { params: emptyParamsSchema },
  // --- Automation exec (renderer) ---
  'macro.run': { params: macroRunSchema },
  'macro.cancelAll': { params: emptyParamsSchema },
  'cue.run': { params: cueRunSchema },
  // --- Workbench (renderer) ---
  'workbench.setMode': { params: workbenchSetModeSchema },
  'workbench.openSettings': { params: emptyParamsSchema },
  'workbench.togglePanel': { params: workbenchTogglePanelSchema },
  'workbench.setSlideBrowserMode': { params: workbenchSetSlideBrowserModeSchema },
  'workbench.setProgramMode': { params: workbenchSetProgramModeSchema },
  'commandPalette.open': { params: emptyParamsSchema },
  'lyricEditor.open': { params: emptyParamsSchema },
  'editor.saveChanges': { params: emptyParamsSchema },
  // --- Navigation/selection (renderer) ---
  'navigation.selectPlaylist': { params: navigationSelectPlaylistSchema },
  'navigation.selectPlaylistEntry': { params: navigationSelectPlaylistEntrySchema },
  'navigation.browseItem': { params: navigationBrowseItemSchema },
  // --- Element editing (renderer) ---
  'element.select': { params: elementSelectSchema },
  'element.selectMany': { params: elementSelectManySchema },
  'element.clearSelection': { params: emptyParamsSchema },
  'element.copy': { params: emptyParamsSchema },
  'element.cut': { params: emptyParamsSchema },
  'element.paste': { params: emptyParamsSchema },
  'element.duplicateSelection': { params: emptyParamsSchema },
  'element.nudge': { params: elementNudgeSchema },
  'element.bringToFront': { params: elementOptionalTargetSchema },
  'element.sendToBack': { params: elementOptionalTargetSchema },
  'element.bringForward': { params: elementOptionalTargetSchema },
  'element.sendBackward': { params: elementOptionalTargetSchema },
  'element.toggleVisibility': { params: elementToggleVisibilitySchema },
  'element.toggleLock': { params: elementToggleLockSchema },
  'element.rename': { params: elementRenameSchema },
  // --- History (renderer) ---
  'edit.undo': { params: emptyParamsSchema },
  'edit.redo': { params: emptyParamsSchema },
};

// ---------------------------------------------------------------------------
// Decode / tool-definition helpers
// ---------------------------------------------------------------------------

export function decodeActionParams(actionId: ActionId, params: unknown, context: CodecContext): unknown {
  const schema = ACTION_SCHEMAS[actionId];
  if (!schema) fail(context, `unknown action id: ${String(actionId)}`);
  return schema.params.decode(params, context);
}

export interface ActionToolDefinition {
  name: string;
  actionId: ActionId;
  description: string;
  inputSchema: JsonSchema;
}

/**
 * `'playlist.create'` -> `'playlist_create'`. Tool-calling providers restrict
 * names to `[a-zA-Z0-9_-]{1,64}`; every `ActionId` has exactly one `.`
 * separator and no underscores in either segment (see the naming rule in
 * `@lumacast/commands`'s action-registry.ts), so replacing it is lossless.
 */
export function toolNameForAction(actionId: ActionId): string {
  return actionId.replace(/\./g, '_');
}

/** Reverse of `toolNameForAction`; `null` when `name` doesn't name a known action. */
export function actionIdFromToolName(name: string): ActionId | null {
  const dotted = name.replace(/_/g, '.');
  return (ACTION_IDS as readonly string[]).includes(dotted) ? (dotted as ActionId) : null;
}

/**
 * Builds one MCP-style tool definition per `ActionId` that passes `filter`
 * (every id when `filter` is omitted). `description` comes straight from
 * `ACTION_METADATA`; `inputSchema` is `ACTION_SCHEMAS[id].params.toJsonSchema()`.
 */
export function buildActionToolDefinitions(
  filter?: (id: ActionId, meta: ActionMetadata) => boolean,
): ActionToolDefinition[] {
  return ACTION_IDS.filter((id) => (filter ? filter(id, ACTION_METADATA[id]) : true)).map((id) => ({
    name: toolNameForAction(id),
    actionId: id,
    description: ACTION_METADATA[id].description,
    inputSchema: ACTION_SCHEMAS[id].params.toJsonSchema(),
  }));
}
