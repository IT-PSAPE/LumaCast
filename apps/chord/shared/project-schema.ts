// Zod validation, (de)serialization, and construction for ChordProject
// (`.lumachord` files). Process-neutral: no Node builtins, no Electron. The
// schema is deliberately forgiving about ordering/duplication — a hand-edited
// or slightly-stale file should open with its cues repaired rather than
// rejected — but strict about shape, so a field that isn't a ChordProject
// key, or has the wrong type, fails with a readable path.
import { z } from 'zod';
import {
  PROJECT_FORMAT_VERSION,
  FRAME_RATES,
  type FrameRate,
  type ChordProject,
  type ChordComposition,
  type ChordMediaRef,
  type MediaFit,
  type ChordBackground,
  type TextStyle,
  type TextBox,
  type Transition,
  type TransitionKind,
  type ChordTheme,
  type CueOverride,
  type ChordCue,
} from './project';
import { normalizeCues } from './cue-model';
import { DEFAULT_PRESET_ID, findPreset } from './theme-presets';

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Leaf schemas
// ---------------------------------------------------------------------------

const frameRateSchema = z
  .number()
  .refine((value): value is FrameRate => (FRAME_RATES as readonly number[]).includes(value), {
    message: `fps must be one of ${FRAME_RATES.join(', ')}`,
  });

const compositionSchema = z
  .object({
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680),
    fps: frameRateSchema,
  })
  .strict() satisfies z.ZodType<ChordComposition>;

const chordMediaRefSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    durationMs: z.number().nonnegative().nullable(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict() satisfies z.ZodType<ChordMediaRef>;

const mediaFitSchema = z.enum(['cover', 'contain', 'fill']) satisfies z.ZodType<MediaFit>;

const chordBackgroundColorSchema = z.object({
  kind: z.literal('color'),
  color: z.string().min(1),
}).strict();

function mediaBackgroundSchema<K extends 'image' | 'video'>(kind: K) {
  return z
    .object({
      kind: z.literal(kind),
      media: chordMediaRefSchema,
      fit: mediaFitSchema,
      dim: z.number().min(0).max(1),
      blur: z.number().min(0).max(40),
      loop: z.boolean(),
    })
    .strict();
}

const chordBackgroundSchema = z.discriminatedUnion('kind', [
  chordBackgroundColorSchema,
  mediaBackgroundSchema('image'),
  mediaBackgroundSchema('video'),
]) satisfies z.ZodType<ChordBackground>;

// TextStyle: fontFamily/fontSize/color/alignment are required (the composition
// TextElementPayload keeps them required); every other picked key is optional.
const textAlignmentSchema = z.enum(['left', 'right', 'center', 'start', 'end', 'justify']);
const textVerticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
const textCaseTransformSchema = z.enum(['none', 'uppercase', 'sentence']);

const textStyleSchema = z
  .object({
    fontFamily: z.string().min(1),
    fontSize: z.number().positive(),
    color: z.string().min(1),
    alignment: textAlignmentSchema,
    weight: z.string().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    verticalAlign: textVerticalAlignSchema.optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
    caseTransform: textCaseTransformSchema.optional(),
    autoFit: z.boolean().optional(),
    autoFitMaxFontSize: z.number().positive().optional(),
    textStrokeEnabled: z.boolean().optional(),
    textStrokeColor: z.string().min(1).optional(),
    textStrokeWidth: z.number().nonnegative().optional(),
    textShadowEnabled: z.boolean().optional(),
    textShadowColor: z.string().min(1).optional(),
    textShadowBlur: z.number().nonnegative().optional(),
    textShadowOffsetX: z.number().optional(),
    textShadowOffsetY: z.number().optional(),
  })
  .strict() satisfies z.ZodType<TextStyle>;

const partialTextStyleSchema = textStyleSchema.partial() satisfies z.ZodType<Partial<TextStyle>>;

const textBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    rotation: z.number(),
    opacity: z.number().min(0).max(1),
  })
  .strict() satisfies z.ZodType<TextBox>;

const partialTextBoxSchema = textBoxSchema.partial() satisfies z.ZodType<Partial<TextBox>>;

const transitionKindSchema = z.enum([
  'none',
  'fade',
  'slide-up',
  'slide-down',
  'scale',
]) satisfies z.ZodType<TransitionKind>;

const transitionSchema = z
  .object({
    in: transitionKindSchema,
    out: transitionKindSchema,
    durationMs: z.number().nonnegative(),
  })
  .strict() satisfies z.ZodType<Transition>;

const partialTransitionSchema = transitionSchema.partial() satisfies z.ZodType<Partial<Transition>>;

const chordThemeSchema = z
  .object({
    presetId: z.string().min(1),
    text: textStyleSchema,
    box: textBoxSchema,
    transition: transitionSchema,
  })
  .strict() satisfies z.ZodType<ChordTheme>;

const cueOverrideSchema = z
  .object({
    text: partialTextStyleSchema.optional(),
    box: partialTextBoxSchema.optional(),
    transition: partialTransitionSchema.optional(),
  })
  .strict() satisfies z.ZodType<CueOverride>;

const richRunSchema = z
  .object({
    text: z.string(),
    color: z.string().optional(),
    weight: z.number().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    fontSize: z.number().positive().optional(),
  })
  .strict();

const richBlockSchema = z
  .object({
    runs: z.array(richRunSchema),
    listType: z.enum(['bullet', 'number']).optional(),
    indent: z.number().int().nonnegative(),
  })
  .strict();

const richBodySchema = z.array(richBlockSchema);

const chordCueSchema = z
  .object({
    id: z.string().min(1),
    startMs: z.number(),
    endMs: z.number().nullable(),
    text: z.string(),
    richBody: richBodySchema.optional(),
    override: cueOverrideSchema.nullable(),
  })
  .strict() satisfies z.ZodType<ChordCue>;

// ---------------------------------------------------------------------------
// Project schema
// ---------------------------------------------------------------------------

const chordProjectShapeSchema = z
  .object({
    formatVersion: z.literal(PROJECT_FORMAT_VERSION),
    id: z.string().min(1),
    title: z.string(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    composition: compositionSchema,
    audio: chordMediaRefSchema.nullable(),
    background: chordBackgroundSchema,
    theme: chordThemeSchema,
    cues: z.array(chordCueSchema),
  })
  .strict();

/**
 * Validates a `ChordProject`. Field shape is enforced strictly (unknown keys
 * and wrong types are rejected); the cues array's ordering, id-uniqueness,
 * and endMs sanity are repaired defensively rather than rejected, since those
 * can drift from hand-edited or slightly-stale files without the document
 * being unreadable.
 */
export const chordProjectSchema = chordProjectShapeSchema.transform(
  (project): ChordProject => ({
    ...project,
    cues: normalizeCues(project.cues),
  }),
);

/** Parses a `.lumachord` file's text. Throws `ProjectFileError` with a readable message. */
export function parseProjectFile(text: string): ChordProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file is not a LumaChord project');
  }

  if (!isRecord(raw)) {
    throw new ProjectFileError('This file is not a LumaChord project');
  }

  if (typeof raw.formatVersion !== 'number') {
    throw new ProjectFileError('This file is not a LumaChord project');
  }
  if (raw.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new ProjectFileError(`Unsupported project version ${raw.formatVersion}`);
  }

  const result = chordProjectSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw new ProjectFileError(path ? `${path}: ${issue.message}` : issue.message);
  }
  return result.data;
}

const TEXT_STYLE_KEY_ORDER: readonly (keyof TextStyle)[] = [
  'fontFamily',
  'fontSize',
  'color',
  'weight',
  'italic',
  'underline',
  'alignment',
  'verticalAlign',
  'lineHeight',
  'letterSpacing',
  'caseTransform',
  'autoFit',
  'autoFitMaxFontSize',
  'textStrokeEnabled',
  'textStrokeColor',
  'textStrokeWidth',
  'textShadowEnabled',
  'textShadowColor',
  'textShadowBlur',
  'textShadowOffsetX',
  'textShadowOffsetY',
];
const TEXT_BOX_KEY_ORDER: readonly (keyof TextBox)[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
const TRANSITION_KEY_ORDER: readonly (keyof Transition)[] = ['in', 'out', 'durationMs'];
const MEDIA_REF_KEY_ORDER: readonly (keyof ChordMediaRef)[] = ['path', 'name', 'durationMs', 'width', 'height'];

function pickOrdered<T extends object>(value: T, order: readonly (keyof T)[]): T {
  const ordered: Partial<T> = {};
  for (const key of order) {
    if (value[key] !== undefined) ordered[key] = value[key];
  }
  return ordered as T;
}

function orderedBackground(background: ChordBackground): ChordBackground {
  if (background.kind === 'color') {
    return { kind: 'color', color: background.color };
  }
  return {
    kind: background.kind,
    media: pickOrdered(background.media, MEDIA_REF_KEY_ORDER),
    fit: background.fit,
    dim: background.dim,
    blur: background.blur,
    loop: background.loop,
  };
}

function orderedTheme(theme: ChordTheme): ChordTheme {
  return {
    presetId: theme.presetId,
    text: pickOrdered(theme.text, TEXT_STYLE_KEY_ORDER),
    box: pickOrdered(theme.box, TEXT_BOX_KEY_ORDER),
    transition: pickOrdered(theme.transition, TRANSITION_KEY_ORDER),
  };
}

function orderedOverride(override: CueOverride): CueOverride {
  const ordered: CueOverride = {};
  if (override.text) ordered.text = pickOrdered(override.text, TEXT_STYLE_KEY_ORDER);
  if (override.box) ordered.box = pickOrdered(override.box, TEXT_BOX_KEY_ORDER);
  if (override.transition) ordered.transition = pickOrdered(override.transition, TRANSITION_KEY_ORDER);
  return ordered;
}

function orderedCue(cue: ChordCue): ChordCue {
  return {
    id: cue.id,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    ...(cue.richBody !== undefined ? { richBody: cue.richBody } : {}),
    override: cue.override ? orderedOverride(cue.override) : null,
  };
}

/** Stable key order, 2-space JSON, trailing newline. */
export function serializeProject(project: ChordProject): string {
  const ordered: ChordProject = {
    formatVersion: project.formatVersion,
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    composition: {
      width: project.composition.width,
      height: project.composition.height,
      fps: project.composition.fps,
    },
    audio: project.audio ? pickOrdered(project.audio, MEDIA_REF_KEY_ORDER) : null,
    background: orderedBackground(project.background),
    theme: orderedTheme(project.theme),
    cues: project.cues.map(orderedCue),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** A brand-new, unsaved project: 1920×1080 @ 30fps, black background, the `classic` theme preset, no cues. */
export function createEmptyProject(now: string, id: string): ChordProject {
  const preset = findPreset(DEFAULT_PRESET_ID);
  if (!preset) throw new Error(`Unknown default theme preset "${DEFAULT_PRESET_ID}"`);
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id,
    title: 'Untitled',
    createdAt: now,
    updatedAt: now,
    composition: { width: 1920, height: 1080, fps: 30 },
    audio: null,
    background: { kind: 'color', color: '#000000' },
    // Deep-clone so mutating this project's theme never mutates the shared preset table.
    theme: JSON.parse(JSON.stringify(preset.theme)) as ChordTheme,
    cues: [],
  };
}

export function touchProject(project: ChordProject, now: string): ChordProject {
  return { ...project, updatedAt: now };
}
