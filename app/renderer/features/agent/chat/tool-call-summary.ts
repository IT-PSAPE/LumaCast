// Human-readable summaries of one agent tool call for the chat transcript
// (`agent-chat-popup.tsx`). The transcript never shows a call's raw
// arguments or result JSON; it shows one line per step — "Listing
// playlists…" while it runs, "Found 4 playlists" plus the names once it has
// settled — the way a chat product narrates what its assistant is doing.
//
// Pure: no React, no `window`, no I/O. Everything here derives from the
// `tool_call` part itself plus the action's metadata in `@lumacast/commands`.
//
// The whole module leans on one observation: every `ActionMetadata.title` is
// an imperative "<Verb> <object>" phrase ("Create playlist", "Go to next
// slide"). Conjugating the verb and reusing "<object>" covers the
// progressive line ("Creating playlist…"), the plain past line ("Created
// playlist"), and the failed/denied/cancelled lines, for all but the two
// "Enable or disable …" titles that don't fit that shape — those are
// special-cased explicitly (see `SET_ENABLED_OBJECT`) rather than bent into
// the general rule. Result-shaped phrasing (list counts, read-projection
// "Get" actions, `project.getOverview`) is layered on top only for the
// settled/succeeded line.
import { ACTION_METADATA, type ActionId, type ActionMetadata } from '@lumacast/commands';
import type { AgentMessagePart, AgentToolCallStatus } from '@lumacast/protocol';

export type ToolCallPart = Extract<AgentMessagePart, { type: 'tool_call' }>;

export interface ToolCallSummary {
  /** Present-progressive line while the call is pending/running/awaiting permission, e.g. "Listing playlists…". */
  active: string;
  /**
   * Past-tense line once the call has settled, e.g. "Found 4 playlists",
   * "Created playlist “Sunday”", "Couldn’t create playlist".
   */
  settled: string;
  /**
   * Names worth showing after `settled` (the playlists found, the items
   * matched). Empty when there is nothing to name. The caller renders them
   * comma-separated and may clip a long list.
   */
  items: string[];
  /** Human detail for a failed/denied/cancelled call; `null` otherwise. */
  detail: string | null;
}

const SETTLED_STATUSES: ReadonlySet<AgentToolCallStatus> = new Set(['succeeded', 'failed', 'denied', 'cancelled']);

/** Whether the call has reached a terminal state. */
export function isToolCallSettled(status: AgentToolCallStatus): boolean {
  return SETTLED_STATUSES.has(status);
}

/** The one line the transcript shows for this call right now: `active` until it settles, then `settled`. */
export function toolCallLabel(part: ToolCallPart): string {
  const summary = summarizeToolCall(part);
  return isToolCallSettled(part.status) ? summary.settled : summary.active;
}

// ---------------------------------------------------------------------------
// Verb conjugation
//
// Keyed by an `ActionMetadata.title`'s first word. Every first word that
// appears anywhere in `ACTION_METADATA` must have an entry in both tables —
// the test file iterates the registry and fails the suite the day a new
// action introduces a verb these tables don't know, rather than silently
// degrading to a naive "<verb>ing"/"<verb>ed" guess (the fallback below
// exists only so a genuinely unlisted verb still renders *something*
// instead of throwing).
// ---------------------------------------------------------------------------

const PRESENT_PARTICIPLE: Readonly<Record<string, string>> = {
  Activate: 'Activating',
  Add: 'Adding',
  Align: 'Aligning',
  Apply: 'Applying',
  Arm: 'Arming',
  Assign: 'Assigning',
  Bring: 'Bringing',
  Browse: 'Browsing',
  Cancel: 'Cancelling',
  Clear: 'Clearing',
  Copy: 'Copying',
  Create: 'Creating',
  Cut: 'Cutting',
  Delete: 'Deleting',
  Detach: 'Detaching',
  Distribute: 'Distributing',
  Duplicate: 'Duplicating',
  Enable: 'Enabling',
  Ensure: 'Ensuring',
  Export: 'Exporting',
  Extract: 'Extracting',
  Get: 'Getting',
  Go: 'Going',
  Group: 'Grouping',
  Import: 'Importing',
  Inspect: 'Inspecting',
  Jump: 'Jumping',
  List: 'Listing',
  Move: 'Moving',
  Nudge: 'Nudging',
  Open: 'Opening',
  Paste: 'Pasting',
  Pause: 'Pausing',
  Play: 'Playing',
  Read: 'Reading',
  Reclaim: 'Reclaiming',
  Redo: 'Redoing',
  Remove: 'Removing',
  Rename: 'Renaming',
  Render: 'Rendering',
  Reorder: 'Reordering',
  Replace: 'Replacing',
  Restore: 'Restoring',
  Resume: 'Resuming',
  Run: 'Running',
  Save: 'Saving',
  Search: 'Searching',
  Seek: 'Seeking',
  Select: 'Selecting',
  Send: 'Sending',
  Set: 'Setting',
  Sync: 'Syncing',
  Take: 'Taking',
  Toggle: 'Toggling',
  Undo: 'Undoing',
  Ungroup: 'Ungrouping',
  Update: 'Updating',
  Write: 'Writing',
};

const SIMPLE_PAST: Readonly<Record<string, string>> = {
  Activate: 'Activated',
  Add: 'Added',
  Align: 'Aligned',
  Apply: 'Applied',
  Arm: 'Armed',
  Assign: 'Assigned',
  Bring: 'Brought',
  Browse: 'Browsed',
  Cancel: 'Cancelled',
  Clear: 'Cleared',
  Copy: 'Copied',
  Create: 'Created',
  Cut: 'Cut',
  Delete: 'Deleted',
  Detach: 'Detached',
  Distribute: 'Distributed',
  Duplicate: 'Duplicated',
  Enable: 'Enabled',
  Ensure: 'Ensured',
  Export: 'Exported',
  Extract: 'Extracted',
  Get: 'Got',
  Go: 'Went',
  Group: 'Grouped',
  Import: 'Imported',
  Inspect: 'Inspected',
  Jump: 'Jumped',
  List: 'Listed',
  Move: 'Moved',
  Nudge: 'Nudged',
  Open: 'Opened',
  Paste: 'Pasted',
  Pause: 'Paused',
  Play: 'Played',
  Read: 'Read',
  Reclaim: 'Reclaimed',
  Redo: 'Redid',
  Remove: 'Removed',
  Rename: 'Renamed',
  Render: 'Rendered',
  Reorder: 'Reordered',
  Replace: 'Replaced',
  Restore: 'Restored',
  Resume: 'Resumed',
  Run: 'Ran',
  Save: 'Saved',
  Search: 'Searched',
  Seek: 'Sought',
  Select: 'Selected',
  Send: 'Sent',
  Set: 'Set',
  Sync: 'Synced',
  Take: 'Took',
  Toggle: 'Toggled',
  Undo: 'Undid',
  Ungroup: 'Ungrouped',
  Update: 'Updated',
  Write: 'Wrote',
};

/**
 * `overlay.setEnabled`/`output.setEnabled` are the only two actions whose
 * title ("Enable or disable overlay"/"…output") isn't a plain "<Verb>
 * <object>" phrase, so they're resolved from `arguments.enabled` instead of
 * the title text. Keyed by `ActionId` (as a plain string, matching how the
 * rest of this module deliberately treats `part.actionId` before it's known
 * to be a real `ActionId`).
 */
const SET_ENABLED_OBJECT: Readonly<Record<string, string>> = {
  'overlay.setEnabled': 'overlay',
  'output.setEnabled': 'output',
};

interface VerbForm {
  /** e.g. "Creating", "Enabling". */
  participle: string;
  /** e.g. "Created", "Enabled". */
  past: string;
  /** Title's object, lowercased, e.g. "playlist", "to next slide", "overlay". Empty for a one-word title ("Undo"). */
  restLower: string;
  /** Whole title, lowercased, for the "Waiting to …"/"Couldn't …" phrasings. */
  titleLower: string;
}

function resolveVerbForm(actionId: string, title: string, args: unknown): VerbForm {
  const setEnabledObject = SET_ENABLED_OBJECT[actionId];
  if (setEnabledObject !== undefined) {
    const enabled = readBooleanField(args, 'enabled');
    const [participle, past, base] =
      enabled === true
        ? (['Enabling', 'Enabled', 'enable'] as const)
        : enabled === false
          ? (['Disabling', 'Disabled', 'disable'] as const)
          : (['Toggling', 'Toggled', 'toggle'] as const);
    return { participle, past, restLower: setEnabledObject, titleLower: `${base} ${setEnabledObject}` };
  }

  const spaceIndex = title.indexOf(' ');
  const firstWord = spaceIndex === -1 ? title : title.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? '' : title.slice(spaceIndex + 1);
  return {
    participle: PRESENT_PARTICIPLE[firstWord] ?? `${firstWord}ing`,
    past: SIMPLE_PAST[firstWord] ?? `${firstWord}ed`,
    restLower: rest.toLowerCase(),
    titleLower: title.toLowerCase(),
  };
}

/** `verb` alone for a one-word title ("Undo" → "Undoing"), otherwise `"<verb> <rest>"`. */
function withRest(verb: string, rest: string): string {
  return rest.length > 0 ? `${verb} ${rest}` : verb;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toLowerCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Argument/result reading — permissive by design: an agent's arguments and
// results are only ever `unknown` (they cross an LLM tool-call boundary), so
// every reader below degrades to a generic phrasing instead of throwing on a
// malformed or unexpected shape.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBooleanField(value: unknown, field: string): boolean | undefined {
  if (!isPlainObject(value)) return undefined;
  const raw = value[field];
  return typeof raw === 'boolean' ? raw : undefined;
}

function firstNonEmptyString(record: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

const MAX_NAME_LENGTH = 40;

function clip(value: string): string {
  return value.length > MAX_NAME_LENGTH ? `${value.slice(0, MAX_NAME_LENGTH)}…` : value;
}

type NameDetailField = 'name' | 'title' | 'label' | 'query';
const NAME_DETAIL_FIELDS: readonly NameDetailField[] = ['name', 'title', 'label', 'query'];

interface NameDetail {
  field: NameDetailField;
  value: string;
}

/** The top-level string argument (in priority order) worth quoting after a summary line. */
function extractNameDetail(args: unknown): NameDetail | null {
  if (!isPlainObject(args)) return null;
  for (const field of NAME_DETAIL_FIELDS) {
    const value = args[field];
    if (typeof value === 'string' && value.length > 0) return { field, value: clip(value) };
  }
  return null;
}

/** `''` for no name, `' “Sunday”'` for a plain one, `' for “sunday”'` for a query. */
function nameSuffix(detail: NameDetail | null): string {
  if (!detail) return '';
  return detail.field === 'query' ? ` for “${detail.value}”` : ` “${detail.value}”`;
}

function singularize(noun: string): string {
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

/** `"no playlists"` / `"1 playlist"` / `"4 playlists"` — the part of "Found …"/"Created …" after the verb. */
function countPhrase(count: number, pluralNoun: string): string {
  if (count === 0) return `no ${pluralNoun}`;
  if (count === 1) return `1 ${singularize(pluralNoun)}`;
  return `${count} ${pluralNoun}`;
}

/** The length of the first top-level array argument, if any (e.g. `element.createMany`'s `elements`). */
function findTopLevelArrayLength(args: unknown): number | null {
  if (!isPlainObject(args)) return null;
  for (const value of Object.values(args)) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function interlockDetail(error: string | null): string | null {
  return typeof error === 'string' && /interlock/i.test(error) ? 'Blocked by the show-safety interlock' : null;
}

// ---------------------------------------------------------------------------
// Result-shaped settled phrasing (status === 'succeeded', and reused as the
// best-guess `settled` line while the call is still pending/running/awaiting
// permission, since that field is never read until the call is settled).
// ---------------------------------------------------------------------------

const OVERVIEW_COUNT_KEYS = [
  'playlists',
  'presentations',
  'lyrics',
  'slides',
  'mediaAssets',
  'themes',
  'overlays',
  'stages',
  'macros',
  'cues',
] as const;

/** camelCase count key -> lowercase noun, e.g. "mediaAssets" -> "media assets". */
function humanizeCountKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function summarizeOverview(result: unknown): Pick<ToolCallSummary, 'settled' | 'items'> {
  const items: string[] = [];
  const counts = isPlainObject(result) ? result.counts : undefined;
  if (isPlainObject(counts)) {
    for (const key of OVERVIEW_COUNT_KEYS) {
      const value = counts[key];
      if (typeof value === 'number' && value > 0) {
        const noun = humanizeCountKey(key);
        items.push(`${value} ${value === 1 ? singularize(noun) : noun}`);
      }
    }
  }
  return { settled: 'Read project overview', items };
}

function summarizeListResult(
  actionId: string,
  titleNoun: string,
  result: unknown[],
  nameDetail: NameDetail | null,
): Pick<ToolCallSummary, 'settled' | 'items'> {
  const noun = actionId === 'project.search' ? 'results' : titleNoun;
  const items = result
    .map((entry) => (isPlainObject(entry) ? firstNonEmptyString(entry, ['name', 'title', 'label']) : null))
    .filter((label): label is string => label !== null);

  const phrase = countPhrase(result.length, noun);
  if (actionId === 'project.search' && nameDetail?.field === 'query') {
    return { settled: `Found ${phrase} for “${nameDetail.value}”`, items };
  }
  return { settled: `Found ${phrase}`, items };
}

function summarizeGetResult(objectNoun: string, result: unknown): Pick<ToolCallSummary, 'settled' | 'items'> {
  if (result === null || result === undefined) return { settled: `Found no ${objectNoun}`, items: [] };
  if (isPlainObject(result)) {
    const label = firstNonEmptyString(result, ['name', 'title']);
    return { settled: label ? `Read ${objectNoun} “${clip(label)}”` : `Read ${objectNoun}`, items: [] };
  }
  // A primitive result (e.g. `logs.getCurrentPath`'s path string) — nothing to quote, but still not an error.
  return { settled: `Read ${objectNoun}`, items: [] };
}

function summarizeMutation(form: VerbForm, args: unknown, nameDetail: NameDetail | null): Pick<ToolCallSummary, 'settled' | 'items'> {
  const arrayCount = findTopLevelArrayLength(args);
  if (arrayCount !== null) {
    return { settled: `${form.past} ${countPhrase(arrayCount, form.restLower)}`, items: [] };
  }
  return { settled: `${withRest(form.past, form.restLower)}${nameSuffix(nameDetail)}`, items: [] };
}

function summarizeSettledOnSuccess(
  part: ToolCallPart,
  metadata: ActionMetadata,
  form: VerbForm,
  nameDetail: NameDetail | null,
): Pick<ToolCallSummary, 'settled' | 'items'> {
  if (part.actionId === 'project.getOverview') return summarizeOverview(part.result);
  if (Array.isArray(part.result)) return summarizeListResult(part.actionId, form.restLower, part.result, nameDetail);
  if (metadata.title.startsWith('Get ')) return summarizeGetResult(form.restLower, part.result);
  return summarizeMutation(form, part.arguments, nameDetail);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function summarizeToolCall(part: ToolCallPart): ToolCallSummary {
  const metadata = ACTION_METADATA[part.actionId as ActionId] as ActionMetadata | undefined;
  if (!metadata) return summarizeUnknownAction(part);

  const form = resolveVerbForm(part.actionId, metadata.title, part.arguments);
  const nameDetail = extractNameDetail(part.arguments);
  const suffix = nameSuffix(nameDetail);

  const active =
    part.status === 'awaiting_permission'
      ? `Waiting to ${form.titleLower}${suffix}…`
      : `${withRest(form.participle, form.restLower)}${suffix}…`;

  if (part.status === 'failed') {
    return { active, settled: `Couldn’t ${form.titleLower}${suffix}`, items: [], detail: part.error };
  }
  if (part.status === 'denied') {
    return {
      active,
      settled: `Skipped ${withRest(lowerFirst(form.participle), form.restLower)}${suffix}`,
      items: [],
      detail: interlockDetail(part.error),
    };
  }
  if (part.status === 'cancelled') {
    return {
      active,
      settled: `Stopped ${withRest(lowerFirst(form.participle), form.restLower)}${suffix}`,
      items: [],
      detail: null,
    };
  }

  const { settled, items } = summarizeSettledOnSuccess(part, metadata, form, nameDetail);
  return { active, settled, items, detail: null };
}

function summarizeUnknownAction(part: ToolCallPart): ToolCallSummary {
  const active = part.status === 'awaiting_permission' ? `Waiting to run ${part.actionId}…` : `Running ${part.actionId}…`;

  if (part.status === 'failed') return { active, settled: `Couldn’t run ${part.actionId}`, items: [], detail: part.error };
  if (part.status === 'denied') {
    return { active, settled: `Skipped running ${part.actionId}`, items: [], detail: interlockDetail(part.error) };
  }
  if (part.status === 'cancelled') return { active, settled: `Stopped running ${part.actionId}`, items: [], detail: null };
  return { active, settled: `Ran ${part.actionId}`, items: [], detail: null };
}
