import { SLIDE_TAG_COLOR_KEYS, stampExplicitOverrides } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type {
  SlideBackgroundSource,
  SlideElement,
  SlideElementType,
  SlideKind,
} from '@lumacast/composition';
import type {
  CueFailurePolicy,
  CueKind,
  OnScopeExit,
  ScopeLevel,
  TriggerBindingTargetType,
  TriggerType,
} from '@lumacast/automation';
import type {
  BundleItem,
  BundleManifest,
  BundleMediaReference,
  BundleOverlay,
  BundlePlaylist,
  BundlePlaylistItemEntry,
  BundleStage,
  BundleTheme,
} from './deck-bundle-manifest';
import {
  parsePlaylistItemReference,
  type PlaylistItemReference,
} from '@lumacast/composition';
import { decodeBundleManifest, decodePlaybackSchedule, decodeThemeOverrideKeys, type CodecContext } from './codecs';
import type { ProjectBackup, ProjectBackupTables } from './project-backup';
import type {
  ProjectBackupV1,
  ProjectBackupV1ScopeLevel,
  ProjectBackupV1SlideKind,
  ProjectBackupV1Tables,
  ProjectBackupV1ThemeKind,
} from './project-backup';

interface MediaReferenceAccumulator {
  elementTypes: Set<'image' | 'video'>;
  occurrenceCount: number;
}

export function cloneBundleManifest(manifest: BundleManifest): BundleManifest {
  return JSON.parse(JSON.stringify(manifest)) as BundleManifest;
}

export function readElementMediaReference(element: SlideElement): { source: string; elementType: 'image' | 'video' } | null {
  if (element.type !== 'image' && element.type !== 'video') return null;
  const source = typeof (element.payload as { src?: string })?.src === 'string'
    ? (element.payload as { src: string }).src
    : '';
  if (!source) return null;
  return { source, elementType: element.type };
}

export function collectBundleMediaReferences(
  items: BundleItem[],
  themes: BundleTheme[],
  overlays: BundleOverlay[] = [],
  stages: BundleStage[] = [],
): BundleMediaReference[] {
  const references = new Map<string, MediaReferenceAccumulator>();

  function collect(elements: SlideElement[]) {
    for (const element of elements) {
      const reference = readElementMediaReference(element);
      if (!reference) continue;
      const current = references.get(reference.source) ?? {
        elementTypes: new Set<'image' | 'video'>(),
        occurrenceCount: 0,
      };
      current.elementTypes.add(reference.elementType);
      current.occurrenceCount += 1;
      references.set(reference.source, current);
    }
  }

  for (const item of items) {
    for (const slide of item.slides) {
      collect(slide.elements);
    }
  }

  for (const theme of themes) {
    collect(theme.elements);
  }

  for (const overlay of overlays) {
    collect(overlay.elements);
  }

  for (const stage of stages) {
    collect(stage.elements);
  }

  return Array.from(references.entries())
    .map(([source, reference]) => ({
      source,
      elementTypes: Array.from(reference.elementTypes).sort(),
      occurrenceCount: reference.occurrenceCount,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

export function normalizeBundleManifest(manifest: BundleManifest): BundleManifest {
  return {
    ...manifest,
    mediaReferences: collectBundleMediaReferences(
      manifest.items,
      manifest.themes,
      manifest.overlays ?? [],
      manifest.stages ?? [],
    ),
  };
}

/**
 * The single named validation entry point for the deck-bundle wire contract.
 * Delegates to the structural codec in app/contracts (the authoritative
 * boundary), then applies the domain referential rules this module owns:
 * playlist item-entry rows must reference exactly one owner. Pure: never
 * mutates. Separator rows own no item and are skipped (decision D5) —
 * `getBundlePlaylistEntryReference` must never be called on one.
 */
export function validateBundleManifest(input: unknown, context?: CodecContext): BundleManifest {
  const ctx: CodecContext = context ?? { boundary: 'bundle-import', operation: 'validateBundleManifest', path: 'manifest' };
  const manifest = decodeBundleManifest(input, ctx);
  for (const playlist of manifest.playlists ?? []) {
    for (const row of playlist.rows) {
      if (row.kind !== 'item') continue;
      // Rejects zero or multiple populated owner columns.
      getBundlePlaylistEntryReference(row);
    }
  }
  return manifest;
}

/**
 * Parses a bundle playlist item-entry row's legacy owner columns into the
 * canonical reference, rejecting entries with zero or multiple populated
 * owners. This is the single interpretation point for
 * `BundlePlaylistItemEntry` — callers must not re-derive the referenced
 * item id with an inline `??` chain. Never call this on a
 * separator row — discriminate on `kind` first.
 */
export function getBundlePlaylistEntryReference(entry: BundlePlaylistItemEntry): PlaylistItemReference {
  return parsePlaylistItemReference(
    { presentationId: entry.presentationId, lyricId: entry.lyricId },
    `playlist entry ${entry.id}`,
  );
}

/** Collects every distinct item id referenced by any item-entry row across the given playlists. */
export function collectBundlePlaylistItemIds(playlists: BundlePlaylist[]): Set<Id> {
  const ids = new Set<Id>();
  for (const playlist of playlists) {
    for (const row of playlist.rows) {
      if (row.kind !== 'item') continue;
      ids.add(getBundlePlaylistEntryReference(row).itemId);
    }
  }
  return ids;
}

/**
 * Filters each playlist's rows down to item entries referencing an included
 * item id, preserving row identity and order. Separator rows are structural,
 * not item-referencing, so they are never subject to this filter — they are
 * always kept.
 */
export function filterBundlePlaylistsToIncludedItems(
  playlists: BundlePlaylist[],
  includedItemIds: ReadonlySet<Id>,
): BundlePlaylist[] {
  return playlists.map((playlist) => ({
    ...playlist,
    rows: playlist.rows.filter((row) =>
      row.kind === 'separator' || includedItemIds.has(getBundlePlaylistEntryReference(row).itemId),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Project backup (#145): document constants and the named validation function.
// The wire contract itself lives in app/contracts/project-backup.ts
// (`ProjectBackup`, a serialization contract, not a persistence DTO — see
// #215); this module is the single interpretation point for it — callers must
// not re-derive the supported format/version/schemaVersion inline. See
// ADR-0006.
// ---------------------------------------------------------------------------

export const PROJECT_BACKUP_FORMAT = 'cast-project-backup' as const;
export const PROJECT_BACKUP_VERSION = 3 as const;
// Format v2 spans schemas 30–32 and is accepted only as legacy import input;
// it is normalized to the current v3/schema-34 shape by discarding Talk content.
export const PROJECT_BACKUP_PREVIOUS_VERSION = 2 as const;
// Format v1 is pinned to schema 22 and uses the separate database-migration
// import path below.
export const PROJECT_BACKUP_LEGACY_VERSION = 1 as const;
// The exact `PRAGMA user_version` this build's backup contract serializes.
// The database layer's authoritative LATEST_SCHEMA_VERSION (ADR-0005) must
// match; the focused lockstep test in project-backup.test.ts fails on drift.
// Core keeps its own copy because the migrations module is unreachable here
// (core may not import the database layer).
export const PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION = 34 as const;
const PROJECT_BACKUP_PRE_SLIDE_TAG_SCHEMA_VERSION = 33 as const;
// The last schema serialized by format v2.
export const PROJECT_BACKUP_PREVIOUS_SCHEMA_VERSION = 32 as const;
// The earliest accepted v2 schema version, predating migration v31's
// `playback_schedules` table. A v2 document at schema 30 is not rejected:
// `validateProjectBackupEnvelope` checks it against the 30 table set (every
// table except `playback_schedules`) and the 30 column set (slide element
// rows without the override column), then normalizes it to the current shape
// with an empty schedule list and `theme_override_keys_json: null` — a
// 30-era database could hold no schedules, so nothing is silently lost and
// no old file is rejected.
export const PROJECT_BACKUP_EARLIEST_SUPPORTED_SCHEMA_VERSION = 30 as const;
// The one and only schema version a v1-format backup was ever exported at
// (PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION was hardcoded to 22 for the whole
// lifetime of format version 1). `validateLegacyProjectBackup` rejects any
// other schemaVersion on a version-1 document as unsupported, rather than
// guessing at an earlier historical table set.
export const PROJECT_BACKUP_LEGACY_SCHEMA_VERSION = 22 as const;

export type ProjectBackupTableKey = keyof ProjectBackupTables;

export class ProjectBackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBackupValidationError';
  }
}

// Validation mirrors of the type unions in @core/types. TypeScript cannot
// derive a value-level list from a union, so these arrays are the runtime
// domains the validator enforces; keep each in step with its union.
const SLIDE_KINDS: readonly SlideKind[] = [
  'presentation', 'lyric',
  'presentationTheme', 'lyricTheme', 'overlayTheme',
  'overlay', 'stage',
];
const SLIDE_ELEMENT_TYPES: readonly SlideElementType[] = ['text', 'image', 'video', 'shape', 'group'];
const SLIDE_ELEMENT_LAYERS: readonly SlideElement['layer'][] = ['background', 'media', 'content'];
const SLIDE_BACKGROUND_SOURCES: readonly SlideBackgroundSource[] = ['theme', 'local'];
const PLAYLIST_ENTRY_KINDS = ['item', 'separator'] as const;
const CUE_KINDS: readonly CueKind[] = [
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
];
const CUE_FAILURE_POLICIES: readonly CueFailurePolicy[] = ['continue', 'abort'];
const SCOPE_LEVELS: readonly ScopeLevel[] = ['global', 'item', 'slide'];
const ON_SCOPE_EXITS: readonly OnScopeExit[] = ['cancel', 'revert', 'none'];
const TRIGGER_TYPES: readonly TriggerType[] = ['slide.take', 'slide.activate', 'app.startup'];
const TRIGGER_TARGET_TYPES: readonly TriggerBindingTargetType[] = ['cue', 'macro'];
const PLAYBACK_SCHEDULE_KINDS = ['slide-timing', 'audio-sync'] as const;

type ProjectBackupColumnType = 'string' | 'number' | 'json-string' | 'enum' | 'flag';

interface ProjectBackupColumnSpec {
  name: string;
  type: ProjectBackupColumnType;
  /** enum columns must be one of these values. */
  enum?: readonly string[];
  /** Whether null is a legal value for this column. */
  nullable?: boolean;
}

const ITEM_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'title', type: 'string' },
  { name: 'theme_id', type: 'string', nullable: true },
  { name: 'order_index', type: 'number' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const MEDIA_ASSET_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'src', type: 'string' },
  { name: 'width', type: 'number', nullable: true },
  { name: 'height', type: 'number', nullable: true },
  { name: 'duration', type: 'number', nullable: true },
  { name: 'codec', type: 'string', nullable: true },
  { name: 'order_index', type: 'number' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const THEME_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'width', type: 'number' },
  { name: 'height', type: 'number' },
  { name: 'order_index', type: 'number' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const PROJECT_BACKUP_COLUMN_SPECS: Record<ProjectBackupTableKey, readonly ProjectBackupColumnSpec[]> = {
  presentations: ITEM_ROW_SPEC,
  lyrics: ITEM_ROW_SPEC,
  slides: [
    { name: 'id', type: 'string' },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'presentation_theme_id', type: 'string', nullable: true },
    { name: 'lyric_theme_id', type: 'string', nullable: true },
    { name: 'overlay_theme_id', type: 'string', nullable: true },
    { name: 'overlay_id', type: 'string', nullable: true },
    { name: 'stage_id', type: 'string', nullable: true },
    { name: 'tag_id', type: 'string', nullable: true },
    { name: 'kind', type: 'enum', enum: SLIDE_KINDS },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'notes', type: 'string' },
    { name: 'background_json', type: 'json-string', nullable: true },
    { name: 'background_source', type: 'enum', enum: SLIDE_BACKGROUND_SOURCES, nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  slide_elements: [
    { name: 'id', type: 'string' },
    { name: 'slide_id', type: 'string' },
    { name: 'type', type: 'enum', enum: SLIDE_ELEMENT_TYPES },
    { name: 'x', type: 'number' },
    { name: 'y', type: 'number' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'rotation', type: 'number' },
    { name: 'opacity', type: 'number' },
    { name: 'z_index', type: 'number' },
    { name: 'layer', type: 'enum', enum: SLIDE_ELEMENT_LAYERS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'source_theme_element_id', type: 'string', nullable: true },
    { name: 'theme_override_keys_json', type: 'json-string', nullable: true },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  slide_tags: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'color_key', type: 'enum', enum: SLIDE_TAG_COLOR_KEYS },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlists: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlist_entries: [
    { name: 'id', type: 'string' },
    { name: 'playlist_id', type: 'string' },
    { name: 'kind', type: 'enum', enum: PLAYLIST_ENTRY_KINDS },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'label', type: 'string', nullable: true },
    { name: 'color_key', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  image_assets: MEDIA_ASSET_ROW_SPEC,
  video_assets: MEDIA_ASSET_ROW_SPEC,
  audio_assets: MEDIA_ASSET_ROW_SPEC,
  overlays: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'enabled', type: 'flag' },
    { name: 'animation_json', type: 'json-string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  presentation_themes: THEME_ROW_SPEC,
  lyric_themes: THEME_ROW_SPEC,
  overlay_themes: THEME_ROW_SPEC,
  stages: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  cues: [
    { name: 'id', type: 'string' },
    { name: 'kind', type: 'enum', enum: CUE_KINDS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'failure_policy', type: 'enum', enum: CUE_FAILURE_POLICIES },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  actions: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'scope_level', type: 'enum', enum: SCOPE_LEVELS },
    { name: 'on_scope_exit', type: 'enum', enum: ON_SCOPE_EXITS },
    { name: 'loop_enabled', type: 'flag' },
    { name: 'loop_count', type: 'number', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  action_steps: [
    { name: 'id', type: 'string' },
    { name: 'action_id', type: 'string' },
    // kind/payload_json/failure_policy are the legacy denormalized copies of
    // the referenced cue (v15..v17 heritage; still written on every step
    // insert and read by snapshot restore). Validated as structurally sound
    // JSON/domains; consistency with the referenced cue is a restore-side
    // concern (#146).
    { name: 'kind', type: 'enum', enum: CUE_KINDS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'failure_policy', type: 'enum', enum: CUE_FAILURE_POLICIES },
    // The physical column carries no NOT NULL constraint, so direct,
    // legacy, or externally maintained database state may legally contain
    // null here.
    { name: 'cue_id', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'delay_before_ms', type: 'number' },
    { name: 'delay_after_ms', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  trigger_bindings: [
    { name: 'id', type: 'string' },
    { name: 'trigger_type', type: 'enum', enum: TRIGGER_TYPES },
    { name: 'source_id', type: 'string', nullable: true },
    { name: 'target_type', type: 'enum', enum: TRIGGER_TARGET_TYPES },
    { name: 'target_id', type: 'string' },
    { name: 'config_json', type: 'json-string' },
    { name: 'enabled', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playback_schedules: [
    { name: 'id', type: 'string' },
    { name: 'item_ref_json', type: 'json-string', nullable: true },
    { name: 'enabled', type: 'flag' },
    { name: 'kind', type: 'enum', enum: PLAYBACK_SCHEDULE_KINDS },
    { name: 'steps_json', type: 'json-string', nullable: true },
    { name: 'audio_asset_id', type: 'string', nullable: true },
    { name: 'markers_json', type: 'json-string', nullable: true },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
};

const LEGACY_V2_SLIDE_KINDS = [
  'presentation', 'lyric', 'talk', 'presentationTheme', 'lyricTheme',
  'talkTheme', 'overlayTheme', 'overlay', 'stage',
] as const;

const PROJECT_BACKUP_COLUMN_SPECS_BEFORE_SLIDE_TAGS = Object.fromEntries(
  Object.entries(PROJECT_BACKUP_COLUMN_SPECS).filter(([tableName]) => tableName !== 'slide_tags'),
) as Record<string, readonly ProjectBackupColumnSpec[]>;
const PROJECT_BACKUP_SCHEMA_33_COLUMN_SPECS: Record<string, readonly ProjectBackupColumnSpec[]> = {
  ...PROJECT_BACKUP_COLUMN_SPECS_BEFORE_SLIDE_TAGS,
  slides: PROJECT_BACKUP_COLUMN_SPECS.slides.filter((spec) => spec.name !== 'tag_id'),
};
const PROJECT_BACKUP_SCHEMA_33_TABLE_KEYS = Object.keys(PROJECT_BACKUP_SCHEMA_33_COLUMN_SPECS);

const LEGACY_V2_PROJECT_BACKUP_COLUMN_SPECS: Record<string, readonly ProjectBackupColumnSpec[]> = {
  ...PROJECT_BACKUP_COLUMN_SPECS_BEFORE_SLIDE_TAGS,
  talks: ITEM_ROW_SPEC,
  slides: [
    { name: 'id', type: 'string' },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'talk_id', type: 'string', nullable: true },
    { name: 'presentation_theme_id', type: 'string', nullable: true },
    { name: 'lyric_theme_id', type: 'string', nullable: true },
    { name: 'talk_theme_id', type: 'string', nullable: true },
    { name: 'overlay_theme_id', type: 'string', nullable: true },
    { name: 'overlay_id', type: 'string', nullable: true },
    { name: 'stage_id', type: 'string', nullable: true },
    { name: 'kind', type: 'enum', enum: LEGACY_V2_SLIDE_KINDS },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'notes', type: 'string' },
    { name: 'background_json', type: 'json-string', nullable: true },
    { name: 'background_source', type: 'enum', enum: SLIDE_BACKGROUND_SOURCES, nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  talk_script_blocks: [
    { name: 'id', type: 'string' },
    { name: 'slide_id', type: 'string' },
    { name: 'text', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlist_entries: [
    { name: 'id', type: 'string' },
    { name: 'playlist_id', type: 'string' },
    { name: 'kind', type: 'enum', enum: PLAYLIST_ENTRY_KINDS },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'talk_id', type: 'string', nullable: true },
    { name: 'label', type: 'string', nullable: true },
    { name: 'color_key', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  talk_themes: THEME_ROW_SPEC,
};

const PROJECT_BACKUP_TABLE_KEYS = Object.keys(PROJECT_BACKUP_COLUMN_SPECS) as ProjectBackupTableKey[];

const LEGACY_V2_PROJECT_BACKUP_TABLE_KEYS = Object.keys(LEGACY_V2_PROJECT_BACKUP_COLUMN_SPECS);

// The v2 table set before migration v31 introduced `playback_schedules`.
// A schema-30 document is validated against exactly this set, then
// normalized with an empty schedule list (see
// PROJECT_BACKUP_EARLIEST_SUPPORTED_SCHEMA_VERSION above).
const PROJECT_BACKUP_TABLE_KEYS_V30 = LEGACY_V2_PROJECT_BACKUP_TABLE_KEYS.filter(
  (key) => key !== 'playback_schedules',
);

function describeProjectBackupValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function assertProjectBackupRow(
  row: unknown,
  tableName: string,
  rowIndex: number,
  columnSpecs: Record<string, readonly ProjectBackupColumnSpec[]> = PROJECT_BACKUP_COLUMN_SPECS,
): void {
  const path = `tables.${tableName}[${rowIndex}]`;
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new ProjectBackupValidationError(`Invalid project backup: ${path} must be a row object.`);
  }
  const record = row as Record<string, unknown>;
  const specs = columnSpecs[tableName];
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = specs.map((spec) => spec.name).sort();
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: ${path} must have exactly the columns [${expectedKeys.join(', ')}], got [${actualKeys.join(', ')}].`,
    );
  }
  for (const spec of specs) {
    const value = record[spec.name];
    const columnPath = `${path}.${spec.name}`;
    const isNull = value === null;
    if (isNull) {
      if (!spec.nullable) {
        throw new ProjectBackupValidationError(`Invalid project backup: ${columnPath} must not be null.`);
      }
      continue;
    }
    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} must be a string, got ${describeProjectBackupValue(value)}.`,
          );
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} must be a finite number, got ${describeProjectBackupValue(value)}.`,
          );
        }
        break;
      case 'json-string':
        if (typeof value !== 'string') {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} must be a JSON string, got ${describeProjectBackupValue(value)}.`,
          );
        }
        try {
          JSON.parse(value);
        } catch (error) {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} is not valid JSON (${(error as Error).message}).`,
          );
        }
        break;
      case 'enum': {
        if (typeof value !== 'string' || !spec.enum?.includes(value)) {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} must be one of [${spec.enum?.join(', ')}], got ${describeProjectBackupValue(value)}.`,
          );
        }
        break;
      }
      case 'flag':
        if (value !== 0 && value !== 1) {
          throw new ProjectBackupValidationError(
            `Invalid project backup: ${columnPath} must be 0 or 1, got ${describeProjectBackupValue(value)}.`,
          );
        }
        break;
    }
  }
  if (columnSpecs === PROJECT_BACKUP_COLUMN_SPECS && tableName === 'slide_elements' && record.theme_override_keys_json !== null) {
    try {
      decodeThemeOverrideKeys(JSON.parse(record.theme_override_keys_json as string), { boundary: 'project-backup', operation: 'validateProjectBackup', path });
    } catch (cause) {
      throw new ProjectBackupValidationError(`Invalid project backup: ${path}.theme_override_keys_json: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (columnSpecs === PROJECT_BACKUP_COLUMN_SPECS && tableName === 'playback_schedules') {
    try {
      const itemRef = record.item_ref_json === null ? null : JSON.parse(record.item_ref_json as string);
      const common = { id: record.id, itemRef, enabled: record.enabled === 1, kind: record.kind };
      const schedule = record.kind === 'slide-timing'
        ? { ...common, steps: record.steps_json === null ? null : JSON.parse(record.steps_json as string) }
        : { ...common, audioAssetId: record.audio_asset_id, markers: record.markers_json === null ? null : JSON.parse(record.markers_json as string) };
      if (record.kind === 'slide-timing' ? record.audio_asset_id !== null || record.markers_json !== null : record.steps_json !== null) {
        throw new Error('columns do not match schedule kind');
      }
      decodePlaybackSchedule(schedule, { boundary: 'project-backup', operation: 'validateProjectBackup', path });
    } catch (cause) {
      throw new ProjectBackupValidationError(`Invalid project backup: ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/**
 * The single named validation entry point for the project-backup contract.
 * Rejects documents with an unsupported (including future) format/version, a
 * `schemaVersion` other than 34 (current), 33 (the pre-tag v3 shape), or
 * 32, 31, or 30 (previous versions — normalized to 34 by the envelope check
 * below, never rejected: schema 33 gains an empty `slide_tags` table and null
 * `slides.tag_id` values; schema 30 gains an
 * empty `playback_schedules` list, and 30/31 slide element rows gain
 * `theme_override_keys_json: null`), an envelope that is not exactly the
 * four keys `format`/`version`/`schemaVersion`/`tables`, missing or extra
 * tables, or rows that violate the per-column contract — including JSON
 * columns that do not parse and the slide owner-exclusivity rule the schema
 * CHECK enforces. Cross-table referential integrity is a restore-side
 * concern (#146), not part of this validation. Pure: never mutates its
 * input (a schema-30/31/32 document normalizes to a new object).
 *
 * Version 1 is handled through the separate schema-22 migration path below.
 */
interface ValidProjectBackupEnvelope {
  backup: ProjectBackup;
  tables: Record<string, unknown>;
  backfillLegacyOverrides: boolean;
}

function validateProjectBackupEnvelope(input: unknown): ValidProjectBackupEnvelope {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProjectBackupValidationError('Invalid project backup: must be an object.');
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.format !== PROJECT_BACKUP_FORMAT) {
    throw new ProjectBackupValidationError(
      `Unsupported backup format: ${describeProjectBackupValue(candidate.format)}.`,
    );
  }

  if (candidate.version === PROJECT_BACKUP_LEGACY_VERSION) {
    throw new ProjectBackupValidationError(
      'This backup is from an older app version and must be restored through the legacy import path.',
    );
  }

  const isCurrentFormat = candidate.version === PROJECT_BACKUP_VERSION;
  const isLegacyV2Format = candidate.version === PROJECT_BACKUP_PREVIOUS_VERSION;
  if (!isCurrentFormat && !isLegacyV2Format) {
    if (typeof candidate.version === 'number' && candidate.version > PROJECT_BACKUP_VERSION) {
      throw new ProjectBackupValidationError(
        `Future backup format version ${candidate.version} is not supported; this build supports version ${PROJECT_BACKUP_VERSION}.`,
      );
    }
    throw new ProjectBackupValidationError(
      `Unsupported backup format version: ${describeProjectBackupValue(candidate.version)}.`,
    );
  }

  const schemaVersion = candidate.schemaVersion;
  const isCurrentSchema = isCurrentFormat && schemaVersion === PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION;
  const isPreSlideTagSchema = isCurrentFormat && schemaVersion === PROJECT_BACKUP_PRE_SLIDE_TAG_SCHEMA_VERSION;
  const isLegacyV2Schema = typeof schemaVersion === 'number'
    && isLegacyV2Format
    && Number.isInteger(schemaVersion)
    && schemaVersion >= PROJECT_BACKUP_EARLIEST_SUPPORTED_SCHEMA_VERSION
    && schemaVersion <= PROJECT_BACKUP_PREVIOUS_SCHEMA_VERSION;
  const isEarliestSchema = schemaVersion === PROJECT_BACKUP_EARLIEST_SUPPORTED_SCHEMA_VERSION;
  if (!isCurrentSchema && !isPreSlideTagSchema && !isLegacyV2Schema) {
    throw new ProjectBackupValidationError(
      `Unsupported backup format/schema version combination: version ${describeProjectBackupValue(candidate.version)}, schema ${describeProjectBackupValue(schemaVersion)}.`,
    );
  }

  const actualEnvelopeKeys = Object.keys(candidate).sort();
  const expectedEnvelopeKeys = ['format', 'version', 'schemaVersion', 'tables'].sort();
  if (
    actualEnvelopeKeys.length !== expectedEnvelopeKeys.length ||
    expectedEnvelopeKeys.some((key, index) => key !== actualEnvelopeKeys[index])
  ) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: envelope must have exactly the keys [${expectedEnvelopeKeys.join(', ')}], got [${actualEnvelopeKeys.join(', ')}].`,
    );
  }

  const tables = candidate.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    throw new ProjectBackupValidationError('Invalid project backup: tables must be an object.');
  }
  const tablesRecord = tables as Record<string, unknown>;
  // A schema-30 document predates `playback_schedules`: it must carry exactly
  // the 30 table set (no more, no less), and is normalized here to the
  // current shape with an empty schedule list before any row is validated.
  // Schema-30/31 documents predate `theme_override_keys_json`: their slide
  // element rows must carry exactly the 31 column set and are normalized
  // with `theme_override_keys_json: null` (a 30/31-era database holds no
  // override metadata, so nothing is silently lost).
  const expectedKeys = isCurrentSchema
    ? PROJECT_BACKUP_TABLE_KEYS
    : isPreSlideTagSchema
      ? PROJECT_BACKUP_SCHEMA_33_TABLE_KEYS
      : isEarliestSchema
        ? PROJECT_BACKUP_TABLE_KEYS_V30
        : LEGACY_V2_PROJECT_BACKUP_TABLE_KEYS;
  const actualTableKeys = Object.keys(tablesRecord).sort();
  const expectedTableKeys = expectedKeys.slice().sort();
  if (
    actualTableKeys.length !== expectedTableKeys.length ||
    expectedTableKeys.some((key, index) => key !== actualTableKeys[index])
  ) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: tables must have exactly [${expectedTableKeys.join(', ')}], got [${actualTableKeys.join(', ')}].`,
    );
  }

  if (isCurrentSchema) {
    return { backup: input as ProjectBackup, tables: tablesRecord, backfillLegacyOverrides: false };
  }

  if (isPreSlideTagSchema) {
    for (const tableName of expectedKeys) {
      const rows = tablesRecord[tableName];
      if (!Array.isArray(rows)) {
        throw new ProjectBackupValidationError(`Invalid project backup: tables.${tableName} must be an array.`);
      }
      rows.forEach((row, rowIndex) => assertProjectBackupRow(row, tableName, rowIndex, PROJECT_BACKUP_SCHEMA_33_COLUMN_SPECS));
    }
    const normalizedTables: Record<string, unknown> = {};
    for (const tableName of PROJECT_BACKUP_TABLE_KEYS) normalizedTables[tableName] = tablesRecord[tableName] ?? [];
    normalizedTables.slides = (tablesRecord.slides as Array<Record<string, unknown>>)
      .map((row) => ({ ...row, tag_id: null }));
    normalizedTables.slide_tags = [];
    const normalized: ProjectBackup = {
      format: PROJECT_BACKUP_FORMAT,
      version: PROJECT_BACKUP_VERSION,
      schemaVersion: PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
      tables: normalizedTables as unknown as ProjectBackupTables,
    };
    return { backup: normalized, tables: normalizedTables, backfillLegacyOverrides: false };
  }

  const legacySpecs = schemaVersion === 32
    ? LEGACY_V2_PROJECT_BACKUP_COLUMN_SPECS
    : {
        ...LEGACY_V2_PROJECT_BACKUP_COLUMN_SPECS,
        slide_elements: LEGACY_V2_PROJECT_BACKUP_COLUMN_SPECS.slide_elements.filter((spec) => spec.name !== 'theme_override_keys_json'),
      };
  for (const tableName of expectedKeys) {
    const rows = tablesRecord[tableName];
    if (!Array.isArray(rows)) {
      throw new ProjectBackupValidationError(`Invalid project backup: tables.${tableName} must be an array.`);
    }
    rows.forEach((row, rowIndex) => assertProjectBackupRow(row, tableName, rowIndex, legacySpecs));
  }

  const legacySlides = tablesRecord.slides as Array<Record<string, unknown>>;
  legacySlides.forEach((row, rowIndex) => {
    const ownerCount = [
      'presentation_id', 'lyric_id', 'talk_id', 'presentation_theme_id',
      'lyric_theme_id', 'talk_theme_id', 'overlay_theme_id', 'overlay_id', 'stage_id',
    ].filter((column) => row[column] !== null).length;
    if (ownerCount !== 1) {
      throw new ProjectBackupValidationError(`Invalid project backup: tables.slides[${rowIndex}] must have exactly one owner id, got ${ownerCount}.`);
    }
  });

  const discardedSlideIds = new Set(legacySlides
    .filter((row) => row.talk_id !== null || row.talk_theme_id !== null)
    .map((row) => row.id as Id));
  const legacyElements = tablesRecord.slide_elements as Array<Record<string, unknown>>;
  const discardedElementIds = new Set(legacyElements
    .filter((row) => discardedSlideIds.has(row.slide_id as Id))
    .map((row) => row.id as Id));
  const schedules = (isEarliestSchema ? [] : tablesRecord.playback_schedules as Array<Record<string, unknown>>)
    .filter((row) => {
      const itemRef = row.item_ref_json === null ? null : JSON.parse(row.item_ref_json as string) as { type?: unknown };
      if (itemRef?.type === 'talk') return false;
      const referencesDiscardedSlide = (json: unknown): boolean => {
        if (json === null) return false;
        const entries = JSON.parse(json as string) as unknown;
        return Array.isArray(entries)
          && entries.some((entry) => typeof entry?.slideId === 'string' && discardedSlideIds.has(entry.slideId));
      };
      return !referencesDiscardedSlide(row.steps_json) && !referencesDiscardedSlide(row.markers_json);
    });

  const normalizedTables: Record<string, unknown> = {};
  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    normalizedTables[tableName] = tablesRecord[tableName] ?? [];
  }
  normalizedTables.slides = legacySlides
    .filter((row) => !discardedSlideIds.has(row.id as Id))
    .map(({ talk_id: _talkId, talk_theme_id: _talkThemeId, ...row }) => ({ ...row, tag_id: null }));
  normalizedTables.slide_tags = [];
  normalizedTables.slide_elements = legacyElements
    .filter((row) => !discardedSlideIds.has(row.slide_id as Id))
    .map((row) => {
      const sourceWasDiscarded = typeof row.source_theme_element_id === 'string' && discardedElementIds.has(row.source_theme_element_id);
      return {
        ...row,
        source_theme_element_id: sourceWasDiscarded ? null : row.source_theme_element_id,
        theme_override_keys_json: schemaVersion === 32 && !sourceWasDiscarded ? row.theme_override_keys_json : null,
      };
    });
  normalizedTables.playlist_entries = (tablesRecord.playlist_entries as Array<Record<string, unknown>>)
    .filter((row) => row.talk_id === null)
    .map(({ talk_id: _talkId, ...row }) => row);
  normalizedTables.trigger_bindings = (tablesRecord.trigger_bindings as Array<Record<string, unknown>>)
    .filter((row) => typeof row.source_id !== 'string' || !discardedSlideIds.has(row.source_id));
  normalizedTables.playback_schedules = schedules;
  const normalized: ProjectBackup = {
    format: PROJECT_BACKUP_FORMAT,
    version: PROJECT_BACKUP_VERSION,
    schemaVersion: PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
    tables: normalizedTables as unknown as ProjectBackup['tables'],
  };
  return { backup: normalized, tables: normalizedTables, backfillLegacyOverrides: schemaVersion < 32 };
}

function assertProjectBackupSlideOwner(
  row: ProjectBackupTables['slides'][number],
  rowIndex: number,
): void {
  const ownerCount =
    (row.presentation_id !== null ? 1 : 0) +
    (row.lyric_id !== null ? 1 : 0) +
    (row.presentation_theme_id !== null ? 1 : 0) +
    (row.lyric_theme_id !== null ? 1 : 0) +
    (row.overlay_theme_id !== null ? 1 : 0) +
    (row.overlay_id !== null ? 1 : 0) +
    (row.stage_id !== null ? 1 : 0);
  if (ownerCount !== 1) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: tables.slides[${rowIndex}] must have exactly one owner id (presentation/lyric/presentationTheme/lyricTheme/overlayTheme/overlay/stage), got ${ownerCount}.`,
    );
  }
}


/** Apply the same conservative override inference to older backups as a live database upgrade. */
function backfillLegacyBackupThemeOverrides(backup: ProjectBackup): ProjectBackup {
  const tables = backup.tables;
  const slidesById = new Map(tables.slides.map((slide) => [slide.id, slide]));
  const owners = {
    presentation: new Map(tables.presentations.map((item) => [item.id, item])),
    lyric: new Map(tables.lyrics.map((item) => [item.id, item])),
  };
  const elementsById = new Map(tables.slide_elements.map((row) => [row.id, row]));
  function asElement(row: ProjectBackupTables['slide_elements'][number]): SlideElement {
    return {
      id: row.id, slideId: row.slide_id, type: row.type,
      x: row.x, y: row.y, width: row.width, height: row.height,
      rotation: row.rotation, opacity: row.opacity, zIndex: row.z_index, layer: row.layer,
      payload: JSON.parse(row.payload_json), sourceThemeElementId: row.source_theme_element_id,
      themeOverrideKeys: null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  const rows = tables.slide_elements.map((row) => {
    if (!row.source_theme_element_id) return row;
    const slide = slidesById.get(row.slide_id);
    const sourceRow = elementsById.get(row.source_theme_element_id);
    const sourceSlide = sourceRow ? slidesById.get(sourceRow.slide_id) : null;
    if (!slide || !sourceRow || !sourceSlide) return row;
    const matches = slide.presentation_id
      ? owners.presentation.get(slide.presentation_id)?.theme_id === sourceSlide.presentation_theme_id && sourceSlide.presentation_theme_id !== null
      : slide.lyric_id
        ? owners.lyric.get(slide.lyric_id)?.theme_id === sourceSlide.lyric_theme_id && sourceSlide.lyric_theme_id !== null
        : false;
    if (!matches) return row;
    try {
      const element = asElement(row);
      const themeElement = asElement(sourceRow);
      const stamped = stampExplicitOverrides({ elements: [themeElement], updatedAt: sourceRow.updated_at }, [element])[0];
      return { ...row, theme_override_keys_json: stamped.themeOverrideKeys?.length ? JSON.stringify(stamped.themeOverrideKeys) : null,
        payload_json: JSON.stringify(stamped.payload) };
    } catch (cause) {
      throw new ProjectBackupValidationError(`Invalid project backup: element ${row.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  });
  return { ...backup, tables: { ...tables, slide_elements: rows } };
}

export function validateProjectBackup(input: unknown): ProjectBackup {
  const { backup, tables: tablesRecord, backfillLegacyOverrides } = validateProjectBackupEnvelope(input);

  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    const rows = tablesRecord[tableName];
    if (!Array.isArray(rows)) {
      throw new ProjectBackupValidationError(`Invalid project backup: tables.${tableName} must be an array.`);
    }
    rows.forEach((row, rowIndex) => assertProjectBackupRow(row, tableName, rowIndex));
  }

  const slides = tablesRecord.slides as ProjectBackupTables['slides'];
  slides.forEach(assertProjectBackupSlideOwner);

  return backfillLegacyOverrides ? backfillLegacyBackupThemeOverrides(backup) : backup;
}

export interface ProjectBackupValidationProgress {
  validatedRows: number;
  totalRows: number;
}

export interface ValidateProjectBackupAsyncOptions {
  /** Maximum row-validation operations performed before yielding. */
  batchSize?: number;
  onProgress?: (progress: ProjectBackupValidationProgress) => void;
  /** Injectable for deterministic tests; defaults to a zero-delay timer. */
  yieldToEventLoop?: () => Promise<void>;
}

function defaultProjectBackupValidationYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function reportProjectBackupValidationProgress(
  observer: ValidateProjectBackupAsyncOptions['onProgress'],
  progress: ProjectBackupValidationProgress,
): void {
  try {
    observer?.(progress);
  } catch {
    // Progress is observational and cannot alter trust-boundary validation.
  }
}

/**
 * Asynchronous counterpart to `validateProjectBackup` for large restore
 * payloads. It preserves the synchronous validator's accepted values and
 * error messages while yielding between bounded row batches.
 */
export async function validateProjectBackupAsync(
  input: unknown,
  options: ValidateProjectBackupAsyncOptions = {},
): Promise<ProjectBackup> {
  const { backup, tables: tablesRecord, backfillLegacyOverrides } = validateProjectBackupEnvelope(input);
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 250));
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultProjectBackupValidationYield;

  let totalRows = 0;
  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    const rows = tablesRecord[tableName];
    if (Array.isArray(rows)) totalRows += rows.length;
  }

  let validatedRows = 0;
  let rowsSinceYield = 0;
  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    const rows = tablesRecord[tableName];
    if (!Array.isArray(rows)) {
      throw new ProjectBackupValidationError(`Invalid project backup: tables.${tableName} must be an array.`);
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      assertProjectBackupRow(rows[rowIndex], tableName, rowIndex);
      validatedRows += 1;
      rowsSinceYield += 1;
      if (rowsSinceYield >= batchSize && validatedRows < totalRows) {
        reportProjectBackupValidationProgress(options.onProgress, { validatedRows, totalRows });
        await yieldToEventLoop();
        rowsSinceYield = 0;
      }
    }
  }
  const slides = tablesRecord.slides as ProjectBackupTables['slides'];
  for (let rowIndex = 0; rowIndex < slides.length; rowIndex += 1) {
    assertProjectBackupSlideOwner(slides[rowIndex], rowIndex);
    if ((rowIndex + 1) % batchSize === 0 && rowIndex + 1 < slides.length) {
      await yieldToEventLoop();
    }
  }

  if (totalRows > 0) {
    reportProjectBackupValidationProgress(options.onProgress, { validatedRows, totalRows });
  }

  return backfillLegacyOverrides ? backfillLegacyBackupThemeOverrides(backup) : backup;
}

// ---------------------------------------------------------------------------
// Legacy (v1) project backup import (#219 item-model refactor, wave K).
// `validateProjectBackup` above validates current v3 and legacy v2 documents,
// and keeps rejecting version 1 directly. This section is a separate,
// deliberate opt-in: a caller that
// wants to import an old file, rather than reject it, first calls
// `isLegacyProjectBackup` to decide whether a document is even worth trying
// as legacy, then `validateLegacyProjectBackup` to fully structurally
// validate it against the frozen v22 schema (mirroring the pre-#219
// `validateProjectBackup` this module used to have, verbatim). A document
// that fails structural validation is rejected explicitly — it is never
// silently accepted or partially imported — with a message that always
// names it as coming from an older app version, whether the failure is a
// wrong schema version, a missing table, or a malformed row. The actual
// v1→v3 transform (materializing to schema 22, replaying migrations 23–33,
// reading the result back out) is @lumacast/persistence-sqlite's job — it
// owns the database this module may not import.
// ---------------------------------------------------------------------------

function legacyBackupError(message: string): never {
  throw new ProjectBackupValidationError(
    `This project backup is from an older app version (format version ${PROJECT_BACKUP_LEGACY_VERSION}): ${message}`,
  );
}

/**
 * Cheap, non-throwing classification: does this document even claim to be a
 * v1 project backup? Used by a caller to decide whether to attempt the
 * legacy import path (`validateLegacyProjectBackup`) instead of the normal
 * `validateProjectBackup`. Does not check `schemaVersion` or the table
 * shape — a document that passes this but fails `validateLegacyProjectBackup`
 * is legacy-labeled garbage, still rejected explicitly.
 */
export function isLegacyProjectBackup(input: unknown): input is { format: 'cast-project-backup'; version: 1 } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const candidate = input as Record<string, unknown>;
  return candidate.format === PROJECT_BACKUP_FORMAT && candidate.version === PROJECT_BACKUP_LEGACY_VERSION;
}

const LEGACY_SLIDE_KINDS: readonly ProjectBackupV1SlideKind[] = ['presentation', 'lyric', 'talk', 'theme', 'overlay', 'stage'];
const LEGACY_THEME_KINDS: readonly ProjectBackupV1ThemeKind[] = ['slides', 'lyrics', 'overlays'];
const LEGACY_SCOPE_LEVELS: readonly ProjectBackupV1ScopeLevel[] = ['global', 'deckItem', 'slide'];

const LEGACY_ITEM_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'title', type: 'string' },
  { name: 'theme_id', type: 'string', nullable: true },
  { name: 'collection_id', type: 'string' },
  { name: 'order_index', type: 'number' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const LEGACY_MEDIA_ASSET_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'src', type: 'string' },
  { name: 'collection_id', type: 'string' },
  { name: 'order_index', type: 'number' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const LEGACY_COLLECTION_ROW_SPEC: readonly ProjectBackupColumnSpec[] = [
  { name: 'id', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'order_index', type: 'number' },
  { name: 'is_default', type: 'flag' },
  { name: 'created_at', type: 'string' },
  { name: 'updated_at', type: 'string' },
];

const LEGACY_PROJECT_BACKUP_COLUMN_SPECS: Record<keyof ProjectBackupV1Tables, readonly ProjectBackupColumnSpec[]> = {
  libraries: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  presentations: LEGACY_ITEM_ROW_SPEC,
  lyrics: LEGACY_ITEM_ROW_SPEC,
  talks: LEGACY_ITEM_ROW_SPEC,
  slides: [
    { name: 'id', type: 'string' },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'talk_id', type: 'string', nullable: true },
    { name: 'theme_id', type: 'string', nullable: true },
    { name: 'overlay_id', type: 'string', nullable: true },
    { name: 'stage_id', type: 'string', nullable: true },
    { name: 'kind', type: 'enum', enum: LEGACY_SLIDE_KINDS },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'notes', type: 'string' },
    { name: 'background_json', type: 'json-string', nullable: true },
    { name: 'background_source', type: 'enum', enum: SLIDE_BACKGROUND_SOURCES, nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  slide_elements: [
    { name: 'id', type: 'string' },
    { name: 'slide_id', type: 'string' },
    { name: 'type', type: 'enum', enum: SLIDE_ELEMENT_TYPES },
    { name: 'x', type: 'number' },
    { name: 'y', type: 'number' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'rotation', type: 'number' },
    { name: 'opacity', type: 'number' },
    { name: 'z_index', type: 'number' },
    { name: 'layer', type: 'enum', enum: SLIDE_ELEMENT_LAYERS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'source_theme_element_id', type: 'string', nullable: true },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  talk_script_blocks: [
    { name: 'id', type: 'string' },
    { name: 'slide_id', type: 'string' },
    { name: 'text', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlists: [
    { name: 'id', type: 'string' },
    { name: 'library_id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlist_groups: [
    { name: 'id', type: 'string' },
    { name: 'playlist_id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'color_key', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  playlist_entries: [
    { name: 'id', type: 'string' },
    { name: 'group_id', type: 'string' },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'talk_id', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  image_assets: LEGACY_MEDIA_ASSET_ROW_SPEC,
  video_assets: LEGACY_MEDIA_ASSET_ROW_SPEC,
  audio_assets: LEGACY_MEDIA_ASSET_ROW_SPEC,
  overlays: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'enabled', type: 'flag' },
    { name: 'animation_json', type: 'json-string' },
    { name: 'collection_id', type: 'string' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  themes: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'kind', type: 'enum', enum: LEGACY_THEME_KINDS },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'order_index', type: 'number' },
    { name: 'collection_id', type: 'string' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  stages: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'order_index', type: 'number' },
    { name: 'collection_id', type: 'string' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  cues: [
    { name: 'id', type: 'string' },
    { name: 'kind', type: 'enum', enum: CUE_KINDS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'failure_policy', type: 'enum', enum: CUE_FAILURE_POLICIES },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  actions: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'collection_id', type: 'string' },
    { name: 'scope_level', type: 'enum', enum: LEGACY_SCOPE_LEVELS },
    { name: 'on_scope_exit', type: 'enum', enum: ON_SCOPE_EXITS },
    { name: 'loop_enabled', type: 'flag' },
    { name: 'loop_count', type: 'number', nullable: true },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  action_steps: [
    { name: 'id', type: 'string' },
    { name: 'action_id', type: 'string' },
    { name: 'kind', type: 'enum', enum: CUE_KINDS },
    { name: 'payload_json', type: 'json-string' },
    { name: 'failure_policy', type: 'enum', enum: CUE_FAILURE_POLICIES },
    { name: 'cue_id', type: 'string', nullable: true },
    { name: 'order_index', type: 'number' },
    { name: 'delay_before_ms', type: 'number' },
    { name: 'delay_after_ms', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  trigger_bindings: [
    { name: 'id', type: 'string' },
    { name: 'trigger_type', type: 'enum', enum: TRIGGER_TYPES },
    { name: 'source_id', type: 'string', nullable: true },
    { name: 'target_type', type: 'enum', enum: TRIGGER_TARGET_TYPES },
    { name: 'target_id', type: 'string' },
    { name: 'config_json', type: 'json-string' },
    { name: 'enabled', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  deck_collections: LEGACY_COLLECTION_ROW_SPEC,
  image_collections: LEGACY_COLLECTION_ROW_SPEC,
  video_collections: LEGACY_COLLECTION_ROW_SPEC,
  audio_collections: LEGACY_COLLECTION_ROW_SPEC,
  theme_collections: LEGACY_COLLECTION_ROW_SPEC,
  overlay_collections: LEGACY_COLLECTION_ROW_SPEC,
  stage_collections: LEGACY_COLLECTION_ROW_SPEC,
  macro_collections: LEGACY_COLLECTION_ROW_SPEC,
};

const LEGACY_PROJECT_BACKUP_TABLE_KEYS = Object.keys(LEGACY_PROJECT_BACKUP_COLUMN_SPECS) as (keyof ProjectBackupV1Tables)[];

function assertLegacyProjectBackupRow(
  row: unknown,
  tableName: keyof ProjectBackupV1Tables,
  rowIndex: number,
): void {
  const path = `tables.${tableName}[${rowIndex}]`;
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    legacyBackupError(`${path} must be a row object.`);
  }
  const record = row as Record<string, unknown>;
  const specs = LEGACY_PROJECT_BACKUP_COLUMN_SPECS[tableName];
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = specs.map((spec) => spec.name).sort();
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    legacyBackupError(`${path} must have exactly the columns [${expectedKeys.join(', ')}], got [${actualKeys.join(', ')}].`);
  }
  for (const spec of specs) {
    const value = record[spec.name];
    const columnPath = `${path}.${spec.name}`;
    if (value === null) {
      if (!spec.nullable) legacyBackupError(`${columnPath} must not be null.`);
      continue;
    }
    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') legacyBackupError(`${columnPath} must be a string, got ${describeProjectBackupValue(value)}.`);
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) legacyBackupError(`${columnPath} must be a finite number, got ${describeProjectBackupValue(value)}.`);
        break;
      case 'json-string':
        if (typeof value !== 'string') {
          legacyBackupError(`${columnPath} must be a JSON string, got ${describeProjectBackupValue(value)}.`);
        }
        try {
          JSON.parse(value as string);
        } catch (error) {
          legacyBackupError(`${columnPath} is not valid JSON (${(error as Error).message}).`);
        }
        break;
      case 'enum':
        if (typeof value !== 'string' || !spec.enum?.includes(value)) {
          legacyBackupError(`${columnPath} must be one of [${spec.enum?.join(', ')}], got ${describeProjectBackupValue(value)}.`);
        }
        break;
      case 'flag':
        if (value !== 0 && value !== 1) legacyBackupError(`${columnPath} must be 0 or 1, got ${describeProjectBackupValue(value)}.`);
        break;
    }
  }
}

/**
 * Full structural validation of a v1/schema-22 project backup — the single
 * named entry point a caller uses to classify a v1 document as "legacy but
 * structurally plausible" (returns normally) versus garbage (throws). Mirrors
 * the pre-#219 `validateProjectBackup` verbatim: exact envelope keys, exact
 * v22 table set (28 tables — libraries, the eight per-bin collection tables,
 * the single kind-tagged `themes` table, `playlist_groups`, and
 * `playlist_entries.group_id`), per-column type/nullability/enum contracts,
 * and the six-owner slide exclusivity rule. Cross-table referential
 * integrity is, as with the current validator, a restore-side concern. Every
 * rejection names this as an older-app-version document. Pure: never
 * mutates anything.
 */
export function validateLegacyProjectBackup(input: unknown): ProjectBackupV1 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    legacyBackupError('must be an object.');
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.format !== PROJECT_BACKUP_FORMAT) {
    legacyBackupError(`unsupported backup format ${describeProjectBackupValue(candidate.format)}.`);
  }
  if (candidate.version !== PROJECT_BACKUP_LEGACY_VERSION) {
    legacyBackupError(`expected format version ${PROJECT_BACKUP_LEGACY_VERSION}, got ${describeProjectBackupValue(candidate.version)}.`);
  }
  if (candidate.schemaVersion !== PROJECT_BACKUP_LEGACY_SCHEMA_VERSION) {
    legacyBackupError(
      `unsupported legacy schema version ${describeProjectBackupValue(candidate.schemaVersion)}; the only supported legacy schema version is ${PROJECT_BACKUP_LEGACY_SCHEMA_VERSION}.`,
    );
  }

  const actualEnvelopeKeys = Object.keys(candidate).sort();
  const expectedEnvelopeKeys = ['format', 'version', 'schemaVersion', 'tables'].sort();
  if (
    actualEnvelopeKeys.length !== expectedEnvelopeKeys.length ||
    expectedEnvelopeKeys.some((key, index) => key !== actualEnvelopeKeys[index])
  ) {
    legacyBackupError(`envelope must have exactly the keys [${expectedEnvelopeKeys.join(', ')}], got [${actualEnvelopeKeys.join(', ')}].`);
  }

  const tables = candidate.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    legacyBackupError('tables must be an object.');
  }
  const tablesRecord = tables as Record<string, unknown>;
  const actualTableKeys = Object.keys(tablesRecord).sort();
  const expectedTableKeys = LEGACY_PROJECT_BACKUP_TABLE_KEYS.slice().sort();
  if (
    actualTableKeys.length !== expectedTableKeys.length ||
    expectedTableKeys.some((key, index) => key !== actualTableKeys[index])
  ) {
    legacyBackupError(`tables must have exactly [${expectedTableKeys.join(', ')}], got [${actualTableKeys.join(', ')}].`);
  }

  for (const tableName of LEGACY_PROJECT_BACKUP_TABLE_KEYS) {
    const rows = tablesRecord[tableName];
    if (!Array.isArray(rows)) {
      legacyBackupError(`tables.${tableName} must be an array.`);
    }
    (rows as unknown[]).forEach((row, rowIndex) => assertLegacyProjectBackupRow(row, tableName, rowIndex));
  }

  const slides = tablesRecord.slides as ProjectBackupV1Tables['slides'];
  slides.forEach((row, rowIndex) => {
    const ownerCount =
      (row.presentation_id !== null ? 1 : 0) +
      (row.lyric_id !== null ? 1 : 0) +
      (row.talk_id !== null ? 1 : 0) +
      (row.theme_id !== null ? 1 : 0) +
      (row.overlay_id !== null ? 1 : 0) +
      (row.stage_id !== null ? 1 : 0);
    if (ownerCount !== 1) {
      legacyBackupError(`tables.slides[${rowIndex}] must have exactly one owner id (presentation/lyric/talk/theme/overlay/stage), got ${ownerCount}.`);
    }
  });

  return input as ProjectBackupV1;
}
