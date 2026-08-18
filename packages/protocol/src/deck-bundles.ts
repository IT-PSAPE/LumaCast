import type { Id } from '@lumacast/kernel';
import type {
  SlideBackgroundSource,
  SlideElement,
  SlideElementType,
  SlideKind,
  ThemeKind,
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
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleMediaReference,
  DeckBundleOverlay,
  DeckBundlePlaylist,
  DeckBundlePlaylistEntry,
  DeckBundleStage,
  DeckBundleTheme,
} from './deck-bundle-manifest';
import {
  parsePlaylistItemReference,
  type PlaylistItemReference,
} from '@lumacast/composition';
import { decodeDeckBundleManifest, type CodecContext } from './codecs';
import type { ProjectBackup, ProjectBackupTables } from './project-backup';

interface MediaReferenceAccumulator {
  elementTypes: Set<'image' | 'video'>;
  occurrenceCount: number;
}

export function cloneDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return JSON.parse(JSON.stringify(manifest)) as DeckBundleManifest;
}

export function readElementMediaReference(element: SlideElement): { source: string; elementType: 'image' | 'video' } | null {
  if (element.type !== 'image' && element.type !== 'video') return null;
  const source = typeof (element.payload as { src?: string })?.src === 'string'
    ? (element.payload as { src: string }).src
    : '';
  if (!source) return null;
  return { source, elementType: element.type };
}

export function collectDeckBundleMediaReferences(
  items: DeckBundleItem[],
  themes: DeckBundleTheme[],
  overlays: DeckBundleOverlay[] = [],
  stages: DeckBundleStage[] = [],
): DeckBundleMediaReference[] {
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

export function normalizeDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return {
    ...manifest,
    mediaReferences: collectDeckBundleMediaReferences(
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
 * playlist entries must reference exactly one owner. Pure: never mutates.
 */
export function validateDeckBundleManifest(input: unknown, context?: CodecContext): DeckBundleManifest {
  const ctx: CodecContext = context ?? { boundary: 'bundle-import', operation: 'validateDeckBundleManifest', path: 'manifest' };
  const manifest = decodeDeckBundleManifest(input, ctx);
  for (const playlist of manifest.playlists ?? []) {
    for (const group of playlist.groups) {
      for (const entry of group.entries) {
        // Rejects zero or multiple populated owner columns instead of the
        // `presentationId ?? lyricId` chain that previously accepted (and
        // then silently mis-imported) a Talk-only entry.
        getDeckBundlePlaylistEntryReference(entry);
      }
    }
  }
  return manifest;
}

/**
 * Parses a bundle playlist entry's legacy owner columns into the canonical
 * reference, rejecting entries with zero or multiple populated owners. This
 * is the single interpretation point for `DeckBundlePlaylistEntry` — callers
 * must not re-derive the referenced item id with an inline `??` chain, which
 * previously dropped Talk entries whenever the chain stopped short of
 * `talkId`.
 */
export function getDeckBundlePlaylistEntryReference(entry: DeckBundlePlaylistEntry): PlaylistItemReference {
  return parsePlaylistItemReference(
    { presentationId: entry.presentationId, lyricId: entry.lyricId, talkId: entry.talkId ?? null },
    `playlist entry ${entry.id}`,
  );
}

/** Collects every distinct item id referenced by any entry across the given playlists. */
export function collectDeckBundlePlaylistItemIds(playlists: DeckBundlePlaylist[]): Set<Id> {
  const ids = new Set<Id>();
  for (const playlist of playlists) {
    for (const group of playlist.groups) {
      for (const entry of group.entries) {
        ids.add(getDeckBundlePlaylistEntryReference(entry).itemId);
      }
    }
  }
  return ids;
}

/** Filters each playlist's entries down to those referencing an included item id, preserving entry and group identity/order. */
export function filterDeckBundlePlaylistsToIncludedItems(
  playlists: DeckBundlePlaylist[],
  includedItemIds: ReadonlySet<Id>,
): DeckBundlePlaylist[] {
  return playlists.map((playlist) => ({
    ...playlist,
    groups: playlist.groups.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        includedItemIds.has(getDeckBundlePlaylistEntryReference(entry).itemId),
      ),
    })),
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
export const PROJECT_BACKUP_VERSION = 1 as const;
// The exact `PRAGMA user_version` this build's backup contract serializes.
// The database layer's authoritative LATEST_SCHEMA_VERSION (ADR-0005) must
// match; the focused lockstep test in project-backup.test.ts fails on drift.
// Core keeps its own copy because the migrations module is unreachable here
// (core may not import the database layer).
export const PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION = 22 as const;

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
const SLIDE_KINDS: readonly SlideKind[] = ['presentation', 'lyric', 'talk', 'theme', 'overlay', 'stage'];
const SLIDE_ELEMENT_TYPES: readonly SlideElementType[] = ['text', 'image', 'video', 'shape', 'group'];
const SLIDE_ELEMENT_LAYERS: readonly SlideElement['layer'][] = ['background', 'media', 'content'];
const SLIDE_BACKGROUND_SOURCES: readonly SlideBackgroundSource[] = ['theme', 'local'];
const THEME_KINDS: readonly ThemeKind[] = ['slides', 'lyrics', 'overlays'];
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
const SCOPE_LEVELS: readonly ScopeLevel[] = ['global', 'deckItem', 'slide'];
const ON_SCOPE_EXITS: readonly OnScopeExit[] = ['cancel', 'revert', 'none'];
const TRIGGER_TYPES: readonly TriggerType[] = ['slide.take', 'slide.activate', 'app.startup'];
const TRIGGER_TARGET_TYPES: readonly TriggerBindingTargetType[] = ['cue', 'macro'];

type ProjectBackupColumnType = 'string' | 'number' | 'json-string' | 'enum' | 'flag';

interface ProjectBackupColumnSpec {
  name: string;
  type: ProjectBackupColumnType;
  /** enum columns must be one of these values. */
  enum?: readonly string[];
  /** Whether null is a legal value for this column. */
  nullable?: boolean;
}

const PROJECT_BACKUP_COLUMN_SPECS: Record<ProjectBackupTableKey, readonly ProjectBackupColumnSpec[]> = {
  libraries: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  presentations: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'theme_id', type: 'string', nullable: true },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  lyrics: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'theme_id', type: 'string', nullable: true },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  talks: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'theme_id', type: 'string', nullable: true },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  slides: [
    { name: 'id', type: 'string' },
    { name: 'presentation_id', type: 'string', nullable: true },
    { name: 'lyric_id', type: 'string', nullable: true },
    { name: 'talk_id', type: 'string', nullable: true },
    { name: 'theme_id', type: 'string', nullable: true },
    { name: 'overlay_id', type: 'string', nullable: true },
    { name: 'stage_id', type: 'string', nullable: true },
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
  image_assets: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'src', type: 'string' },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  video_assets: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'src', type: 'string' },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  audio_assets: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'src', type: 'string' },
    { name: 'collection_id', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
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
    { name: 'kind', type: 'enum', enum: THEME_KINDS },
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
    { name: 'scope_level', type: 'enum', enum: SCOPE_LEVELS },
    { name: 'on_scope_exit', type: 'enum', enum: ON_SCOPE_EXITS },
    { name: 'loop_enabled', type: 'flag' },
    { name: 'loop_count', type: 'number', nullable: true },
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
    // The v22 physical column carries no NOT NULL constraint, so direct,
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
  deck_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  image_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  video_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  audio_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  theme_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  overlay_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  stage_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
  macro_collections: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'order_index', type: 'number' },
    { name: 'is_default', type: 'flag' },
    { name: 'created_at', type: 'string' },
    { name: 'updated_at', type: 'string' },
  ],
};

const PROJECT_BACKUP_TABLE_KEYS = Object.keys(PROJECT_BACKUP_COLUMN_SPECS) as ProjectBackupTableKey[];

function describeProjectBackupValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function assertProjectBackupRow(
  row: unknown,
  tableName: ProjectBackupTableKey,
  rowIndex: number,
): void {
  const path = `tables.${tableName}[${rowIndex}]`;
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new ProjectBackupValidationError(`Invalid project backup: ${path} must be a row object.`);
  }
  const record = row as Record<string, unknown>;
  const specs = PROJECT_BACKUP_COLUMN_SPECS[tableName];
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
}

/**
 * The single named validation entry point for the project-backup contract.
 * Rejects documents with an unsupported (including future) format/version,
 * a `schemaVersion` other than the exact supported version, an envelope that
 * is not exactly the four keys `format`/`version`/`schemaVersion`/`tables`,
 * missing or extra tables, or rows that violate the per-column contract —
 * including JSON columns that do not parse and the slide owner-exclusivity
 * rule the schema CHECK enforces. Cross-table referential integrity is a
 * restore-side concern (#146), not part of this validation. Pure: never
 * mutates anything.
 */
export function validateProjectBackup(input: unknown): ProjectBackup {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProjectBackupValidationError('Invalid project backup: must be an object.');
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.format !== PROJECT_BACKUP_FORMAT) {
    throw new ProjectBackupValidationError(
      `Unsupported backup format: ${describeProjectBackupValue(candidate.format)}.`,
    );
  }

  if (candidate.version !== PROJECT_BACKUP_VERSION) {
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
  if (schemaVersion !== PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION) {
    throw new ProjectBackupValidationError(
      `Unsupported backup schema version: ${describeProjectBackupValue(schemaVersion)}; supported schema version is ${PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION}.`,
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
  const actualTableKeys = Object.keys(tablesRecord).sort();
  const expectedTableKeys = PROJECT_BACKUP_TABLE_KEYS.slice().sort();
  if (
    actualTableKeys.length !== expectedTableKeys.length ||
    expectedTableKeys.some((key, index) => key !== actualTableKeys[index])
  ) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: tables must have exactly [${expectedTableKeys.join(', ')}], got [${actualTableKeys.join(', ')}].`,
    );
  }

  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    const rows = tablesRecord[tableName];
    if (!Array.isArray(rows)) {
      throw new ProjectBackupValidationError(`Invalid project backup: tables.${tableName} must be an array.`);
    }
    rows.forEach((row, rowIndex) => assertProjectBackupRow(row, tableName, rowIndex));
  }

  const slides = tablesRecord.slides as ProjectBackupTables['slides'];
  slides.forEach((row, rowIndex) => {
    const ownerCount =
      (row.presentation_id !== null ? 1 : 0) +
      (row.lyric_id !== null ? 1 : 0) +
      (row.talk_id !== null ? 1 : 0) +
      (row.theme_id !== null ? 1 : 0) +
      (row.overlay_id !== null ? 1 : 0) +
      (row.stage_id !== null ? 1 : 0);
    if (ownerCount !== 1) {
      throw new ProjectBackupValidationError(
        `Invalid project backup: tables.slides[${rowIndex}] must have exactly one owner id (presentation/lyric/talk/theme/overlay/stage), got ${ownerCount}.`,
      );
    }
  });

  return input as ProjectBackup;
}
