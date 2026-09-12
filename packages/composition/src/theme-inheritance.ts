// Live inherited themes (presentation/lyric).
//
// Linked slides resolve their current appearance at read/render time from the
// shared theme instead of mass-copying theme values into slide rows on every
// theme change. This module is the single pure implementation every surface
// (editor preview, show/live output, thumbnails, NDI capture, detach,
// export) shares:
//
// - `resolveLinkedSlideElements` / `resolveLinkedSlideBackground` are the
//   read path: deterministic, side-effect free, and allocation-stable for
//   unlinked input (unlinked slides are returned by reference, untouched).
// - Link identity is the existing provenance field `sourceThemeElementId`
//   plus the item's `themeId`; no array positions and no authored text are
//   ever used for matching (same contract as `syncThemeToElements`).
// - Explicit local overrides (`themeOverrideKeys` on `SlideElement`) pin
//   individual geometry/payload properties to their persisted values while
//   everything else follows the theme live. Authored text content (`text`,
//   `format`, `richBody`) is always local and is never recorded as an
//   override key.
// - Legacy rows without override metadata resolve conservatively: authored
//   content survives, all other properties inherit the theme. Resolution
//   never writes, so dormant divergences stay intact in storage until an
//   explicit edit records them (`stampExplicitOverrides`) or a detach
//   materializes the resolved appearance (`planDetachMaterialization`).
// - Elements the theme gained after linking (or whose source changed type)
//   are represented with deterministic derived IDs — a pure function of
//   `(slideId, themeElementId)` — so render never mints random IDs.
// - Overlay themes are untouched: overlays carry no persisted theme link
//   (theming an overlay is a one-shot apply), so the resolver naturally
//   no-ops for them. Legacy overlay theme types stay compatible by simply
//   never being passed here as a link source.
//
// The legacy mass-copy algorithms (`applyThemeToElements`,
// `syncThemeToElements` in `./themes`) are preserved unchanged for RPC/store
// compat and are not used by the live read path.
import type { Id } from '@lumacast/kernel';
import type { SlideBackground, SlideBackgroundSource } from './domain/slides';
import type {
  GroupElementPayload,
  SlideElement,
  SlideElementPayload,
} from './domain/slide-elements';
import { cloneElement } from './clone';

/** Minimal structural shape of a theme link source (any theme family). */
export interface ThemeInheritanceSource {
  elements: SlideElement[];
  background?: SlideBackground | null;
  updatedAt: string;
}

/** Geometry keys that may be pinned as explicit local overrides. */
export const THEME_OVERRIDE_GEOMETRY_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'zIndex',
  'layer',
] as const;

export type ThemeOverrideGeometryKey = (typeof THEME_OVERRIDE_GEOMETRY_KEYS)[number];

/**
 * Text payload keys that are always authored content. They are preserved
 * from the persisted row unconditionally and are never valid override keys.
 */
export const THEME_AUTHORED_TEXT_KEYS = ['text', 'format', 'richBody'] as const;

const GEOMETRY_KEY_SET = new Set<string>(THEME_OVERRIDE_GEOMETRY_KEYS);
const AUTHORED_KEY_SET = new Set<string>(THEME_AUTHORED_TEXT_KEYS);

/** Identity keys are never overridable and never diffed. */
const IDENTITY_KEYS = new Set(['id', 'slideId', 'type', 'sourceThemeElementId', 'themeOverrideKeys', 'createdAt', 'updatedAt']);

export function isThemeOverrideKey(key: string): boolean {
  if (key.length === 0 || IDENTITY_KEYS.has(key) || AUTHORED_KEY_SET.has(key)) return false;
  // Group membership is structural (merged by provenance at resolve time) and
  // is never an override key — recording it would pin a stale child list.
  if (key === 'children' || key === 'payload.children') return false;
  if (GEOMETRY_KEY_SET.has(key)) return true;
  // Payload keys are recorded bare (`fontSize`, `color`, `src`, ...).
  // `payload.<key>` is accepted on read for forward tolerance and normalized to `<key>`.
  return key.startsWith('payload.') ? key.slice('payload.'.length).length > 0 : true;
}

export function normalizeThemeOverrideKey(key: string): string | null {
  const bare = key.startsWith('payload.') ? key.slice('payload.'.length) : key;
  return isThemeOverrideKey(bare) ? bare : null;
}

function normalizeOverrideKeys(keys: readonly string[] | null | undefined): string[] {
  if (!keys) return [];
  const normalized = new Set<string>();
  for (const key of keys) {
    const bare = normalizeThemeOverrideKey(key);
    if (bare) normalized.add(bare);
  }
  return [...normalized].sort();
}

export function isLinkedSlideElement(element: SlideElement): boolean {
  return Boolean(element.sourceThemeElementId);
}

/**
 * Deterministic render-time ID for a theme element with no persisted linked
 * row (new theme element, or a source whose type changed). Pure function of
 * `(slideId, themeElementId)` — stable across renders, reloads, and
 * surfaces, and disjoint from persisted IDs (which never contain `::theme::`).
 * Nested group children compose from their resolved parent ID.
 */
export function deriveLinkedElementId(parentId: Id, themeElementId: Id): Id {
  return `${parentId}::theme::${themeElementId}`;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left !== null && right !== null && typeof left === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  // NaN and undefined-vs-missing normalize through JSON below.
  return JSON.stringify(left) === JSON.stringify(right);
}

function readKey(element: SlideElement, key: string): unknown {
  if (GEOMETRY_KEY_SET.has(key)) return (element as unknown as Record<string, unknown>)[key];
  return (element.payload as unknown as Record<string, unknown>)[key];
}

/**
 * Conservative legacy divergence derivation (for the `v32` backfill
 * migration, owned by the data worker): every non-authored, non-identity
 * property where the persisted row differs from its same-type theme source
 * becomes an explicit override key. Type-mismatched and dangling rows yield
 * no keys — detach preserves those rows as local content instead.
 */
export function deriveLegacyOverrideKeys(
  themeElement: SlideElement | null | undefined,
  persistedElement: SlideElement,
): string[] {
  if (!themeElement || themeElement.type !== persistedElement.type) return [];
  const keys = new Set<string>();
  for (const key of THEME_OVERRIDE_GEOMETRY_KEYS) {
    if (!valuesEqual(readKey(persistedElement, key), readKey(themeElement, key))) keys.add(key);
  }
  const themePayload = themeElement.payload as unknown as Record<string, unknown>;
  const persistedPayload = persistedElement.payload as unknown as Record<string, unknown>;
  const payloadKeys = new Set([...Object.keys(themePayload), ...Object.keys(persistedPayload)]);
  for (const key of payloadKeys) {
    // Children merge by provenance at resolve time; the child list itself is
    // structural and never an override key.
    if (key === 'children') continue;
    if (AUTHORED_KEY_SET.has(key)) continue;
    if (!valuesEqual(persistedPayload[key], themePayload[key])) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Session override stamping for staged edits: records which properties the
 * current edit explicitly diverges from the theme, so the live resolver keeps
 * them while everything else follows the theme. Key sets shrink as well as
 * grow, so re-adopting a theme value clears the pin.
 *
 * Edit-aware (no dormant-diff pinning): when `previousElements` (the rows
 * before this edit, by id) is provided, only properties that actually changed
 * in this edit can gain a pin — newly differing from the theme — while prior
 * pins survive unrelated edits even when the theme happens to match. Dormant divergences that predate
 * recorded override metadata (legacy rows) stay unpinned until explicitly
 * touched. Without `previousElements` (legacy backfill path) the full
 * row-vs-theme diff is used, matching `deriveLegacyOverrideKeys`.
 *
 * Unlinked rows pass through untouched (same reference); linked rows whose
 * key set — and, for groups, whose children key sets — are unchanged keep
 * their reference. Group children always recurse, so a child-only edit is
 * never dropped by an unchanged parent diff.
 */
export function stampExplicitOverrides(
  theme: ThemeInheritanceSource | null | undefined,
  elements: SlideElement[],
  previousElements?: readonly SlideElement[] | null,
): SlideElement[] {
  if (!theme) return elements;
  const themeById = new Map<Id, SlideElement>();
  for (const themeElement of theme.elements) themeById.set(themeElement.id, themeElement);
  const previousById = new Map<Id, SlideElement>();
  if (previousElements) {
    for (const previous of previousElements) previousById.set(previous.id, previous);
  }
  let changed = false;
  const next = elements.map((element) => {
    if (!element.sourceThemeElementId) return element;
    const themeElement = themeById.get(element.sourceThemeElementId);
    if (!themeElement || themeElement.type !== element.type) return element;
    const previous = normalizeOverrideKeys(element.themeOverrideKeys);
    const derived = previousById.has(element.id)
      ? deriveEditOverrideKeys(themeElement, previousById.get(element.id)!, element, previous)
      : deriveLegacyOverrideKeys(themeElement, element);
    const previousPayload = element.payload;
    let nextPayload = previousPayload;
    if (element.type === 'group' && themeElement.type === 'group') {
      nextPayload = stampGroupChildren(themeElement, element, previousById.get(element.id) ?? null);
    }
    if (valuesEqual(derived, previous) && nextPayload === previousPayload) return element;
    changed = true;
    const stamped: SlideElement = { ...element, themeOverrideKeys: derived.length > 0 ? derived : null };
    if (nextPayload !== previousPayload) stamped.payload = nextPayload;
    return stamped;
  });
  return changed ? next : elements;
}

/**
 * Edit-aware key derivation for one matched element: the union of (a) prior
 * pins not explicitly returned to the theme value and (b) properties changed by this
 * edit (before → after) that now differ from the theme. Properties at the
 * theme value never pin, so re-adopting clears. Authored text is never a key.
 */
function deriveEditOverrideKeys(
  themeElement: SlideElement,
  before: SlideElement,
  after: SlideElement,
  priorKeys: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const key of priorKeys) {
    const changed = !valuesEqual(readKey(before, key), readKey(after, key));
    if (!changed || !valuesEqual(readKey(after, key), readKey(themeElement, key))) keys.add(key);
  }
  for (const key of THEME_OVERRIDE_GEOMETRY_KEYS) {
    if (!valuesEqual(readKey(before, key), readKey(after, key)) && !valuesEqual(readKey(after, key), readKey(themeElement, key))) {
      keys.add(key);
    }
  }
  const themePayload = themeElement.payload as unknown as Record<string, unknown>;
  const beforePayload = before.payload as unknown as Record<string, unknown>;
  const afterPayload = after.payload as unknown as Record<string, unknown>;
  const payloadKeys = new Set([...Object.keys(themePayload), ...Object.keys(beforePayload), ...Object.keys(afterPayload)]);
  for (const key of payloadKeys) {
    if (key === 'children' || AUTHORED_KEY_SET.has(key)) continue;
    if (!valuesEqual(beforePayload[key], afterPayload[key]) && !valuesEqual(afterPayload[key], themePayload[key])) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

function stampGroupChildren(
  themeElement: SlideElement,
  persistedElement: SlideElement,
  previousElement: SlideElement | null,
): SlideElementPayload {
  const themeChildren = (themeElement.payload as GroupElementPayload).children ?? [];
  const persistedChildren = (persistedElement.payload as GroupElementPayload).children ?? [];
  const themeById = new Map<Id, SlideElement>();
  for (const child of themeChildren) themeById.set(child.id, child);
  const previousChildrenById = new Map<Id, SlideElement>();
  if (previousElement && previousElement.type === 'group') {
    for (const child of (previousElement.payload as GroupElementPayload).children ?? []) {
      if (!previousChildrenById.has(child.id)) previousChildrenById.set(child.id, child);
    }
  }
  let childrenChanged = false;
  const stampedChildren = persistedChildren.map((child) => {
    if (!child.sourceThemeElementId) return child;
    const themeChild = themeById.get(child.sourceThemeElementId);
    if (!themeChild || themeChild.type !== child.type) return child;
    const previous = normalizeOverrideKeys(child.themeOverrideKeys);
    const beforeChild = previousChildrenById.get(child.id) ?? null;
    const derived = beforeChild
      ? deriveEditOverrideKeys(themeChild, beforeChild, child, previous)
      : deriveLegacyOverrideKeys(themeChild, child);
    let nextChild: SlideElement = valuesEqual(derived, previous)
      ? child
      : { ...child, themeOverrideKeys: derived.length > 0 ? derived : null };
    if (child.type === 'group' && themeChild.type === 'group') {
      const restamped = stampGroupChildren(themeChild, nextChild, beforeChild);
      if (restamped !== nextChild.payload) nextChild = { ...nextChild, payload: restamped };
    }
    if (nextChild !== child) childrenChanged = true;
    return nextChild;
  });
  if (!childrenChanged) return persistedElement.payload;
  return { ...(persistedElement.payload as GroupElementPayload), children: stampedChildren };
}

// ── Live resolution (read path) ──────────────────────────────────────────

function mergePayload(
  themeElement: SlideElement,
  persistedElement: SlideElement,
  overrideKeys: ReadonlySet<string>,
): SlideElementPayload {
  const themePayload = themeElement.payload as unknown as Record<string, unknown>;
  const persistedPayload = persistedElement.payload as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...themePayload };
  for (const key of AUTHORED_KEY_SET) {
    if (key in persistedPayload) merged[key] = persistedPayload[key];
  }
  for (const key of overrideKeys) {
    if (GEOMETRY_KEY_SET.has(key)) continue;
    if (key in persistedPayload) merged[key] = persistedPayload[key];
    else delete merged[key];
  }
  return merged as unknown as SlideElementPayload;
}

function resolveMatchedElement(
  themeElement: SlideElement,
  persistedElement: SlideElement,
  slideId: Id,
  themeUpdatedAt: string,
): SlideElement {
  const overrides = new Set(normalizeOverrideKeys(persistedElement.themeOverrideKeys));
  const base = cloneElement(themeElement);
  const resolved: SlideElement = {
    ...base,
    id: persistedElement.id,
    slideId,
    sourceThemeElementId: themeElement.id,
    createdAt: persistedElement.createdAt,
    updatedAt: persistedElement.updatedAt,
    // Invalid stored keys normalize to nothing — never fall back to the raw
    // metadata, which would pin arbitrary properties on resolve.
    themeOverrideKeys: overrides.size > 0 ? [...overrides].sort() : null,
  };
  for (const key of THEME_OVERRIDE_GEOMETRY_KEYS) {
    if (overrides.has(key)) {
      (resolved as unknown as Record<string, unknown>)[key] = readKey(persistedElement, key);
    }
  }
  // Authored text content always survives inside mergePayload; all other
  // payload properties follow the theme unless pinned by `overrides`.
  resolved.payload = mergePayload(themeElement, persistedElement, overrides);
  if (themeElement.type === 'group' && persistedElement.type === 'group') {
    resolved.payload = {
      ...resolved.payload,
      children: resolveGroupChildren(themeElement, persistedElement, resolved.id),
    } as GroupElementPayload;
  }
  void themeUpdatedAt;
  return resolved;
}

function deriveThemeElement(
  themeElement: SlideElement,
  parentId: Id,
  slideId: Id,
  themeUpdatedAt: string,
): SlideElement {
  const derived = cloneElement(themeElement);
  const derivedId = deriveLinkedElementId(parentId, themeElement.id);
  derived.id = derivedId;
  derived.slideId = slideId;
  derived.sourceThemeElementId = themeElement.id;
  derived.createdAt = themeElement.createdAt;
  derived.updatedAt = themeUpdatedAt;
  derived.themeOverrideKeys = null;
  if (derived.type === 'group') {
    const payload = derived.payload as GroupElementPayload;
    payload.children = (payload.children ?? []).map((child) => deriveThemeElement(child, derivedId, slideId, themeUpdatedAt));
  }
  return derived;
}

function resolveGroupChildren(
  themeElement: SlideElement,
  persistedElement: SlideElement,
  resolvedParentId: Id,
): SlideElement[] {
  const themeChildren = (themeElement.payload as GroupElementPayload).children ?? [];
  const persistedChildren = (persistedElement.payload as GroupElementPayload).children ?? [];
  const persistedBySource = new Map<string, SlideElement>();
  const localChildren: SlideElement[] = [];
  for (const child of persistedChildren) {
    if (child.sourceThemeElementId) {
      if (!persistedBySource.has(child.sourceThemeElementId)) persistedBySource.set(child.sourceThemeElementId, child);
    } else {
      localChildren.push(child);
    }
  }
  const slideId = persistedElement.slideId;
  const themeUpdatedAt = themeElement.updatedAt;
  const resolved: SlideElement[] = themeChildren.map((themeChild) => {
    const existing = persistedBySource.get(themeChild.id);
    if (existing && existing.type === themeChild.type) {
      return resolveMatchedElement(themeChild, existing, slideId, themeUpdatedAt);
    }
    return deriveThemeElement(themeChild, resolvedParentId, slideId, themeUpdatedAt);
  });
  resolved.push(...localChildren);
  return resolved;
}

/**
 * Resolve a linked slide's elements against its theme. Pure and
 * deterministic: no timestamps are minted (matched rows keep their persisted
 * `createdAt`/`updatedAt`, derived elements carry the theme's), and no random
 * IDs are created. Unlinked rows (null provenance) keep their identity and
 * relative order, appended after the theme-ordered elements. Stale rows
 * (dangling provenance or a type-changed source) are excluded from the
 * resolved output but left untouched in storage — see
 * `planDetachMaterialization`, which removes their stale storage rows.
 */
export function resolveLinkedSlideElements(
  theme: ThemeInheritanceSource,
  slideId: Id,
  elements: SlideElement[],
): SlideElement[] {
  const linkedBySource = new Map<string, SlideElement>();
  const userElements: SlideElement[] = [];
  for (const element of elements) {
    if (element.sourceThemeElementId) {
      if (!linkedBySource.has(element.sourceThemeElementId)) linkedBySource.set(element.sourceThemeElementId, element);
      else userElements.push(element);
    } else {
      userElements.push(element);
    }
  }
  const resolved: SlideElement[] = theme.elements.map((themeElement) => {
    const existing = linkedBySource.get(themeElement.id);
    if (existing && existing.type === themeElement.type) {
      return resolveMatchedElement(themeElement, existing, slideId, theme.updatedAt);
    }
    return deriveThemeElement(themeElement, slideId, slideId, theme.updatedAt);
  });
  resolved.push(...userElements);
  return resolved;
}

/**
 * Resolve a linked slide's background. `local` backgrounds always win;
 * otherwise the theme background applies (null clears, mirroring sync).
 */
export function resolveLinkedSlideBackground(
  themeBackground: SlideBackground | null | undefined,
  slideBackground: SlideBackground | null | undefined,
  backgroundSource: SlideBackgroundSource,
): SlideBackground | null {
  if (backgroundSource === 'local') return slideBackground ?? null;
  return themeBackground ?? null;
}

// ── Detach materialization (write planner; execution stays renderer/store) ──

export interface DetachMaterializationPlan {
  /** Full resolved rows to write back before dropping the link (matched by persisted ID). */
  updates: SlideElement[];
  /** Resolved derived elements with no persisted row yet (carry explicit IDs + provenance). */
  creates: SlideElement[];
  /**
   * Stale linked rows to delete: persisted rows whose theme source is gone
   * (or type-changed) and which the resolver hides. They must not survive a
   * detach — clearing their provenance would otherwise resurrect deleted
   * theme elements as local content.
   */
  deletes: Id[];
  /** Resolved background to persist (the detach itself also marks it local). */
  background: SlideBackground | null;
}

/**
 * Normalize persisted override metadata: bare `payload.<key>` forms collapse
 * to `<key>`, unknown/identity/authored/structural keys drop, duplicates
 * collapse. Returns the sorted key set, or null when nothing valid remains —
 * never the raw input.
 */
export function decodePersistedOverrideKeys(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const normalized = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const bare = normalizeThemeOverrideKey(entry);
    if (bare) normalized.add(bare);
  }
  return normalized.size > 0 ? [...normalized].sort() : null;
}

/**
 * Plan the writes that materialize a linked slide's current resolved
 * appearance before the link is dropped. Pure: callers execute `updates`
 * (by ID), `creates` (explicit IDs, provenance intact for the detach to
 * clear), `deletes` (stale linked rows the resolver hides), and the
 * background write atomically, then detach. A null theme (assigned theme
 * deleted) preserves current appearance and clears nested provenance.
 */
export function planDetachMaterialization(
  theme: ThemeInheritanceSource | null | undefined,
  slideId: Id,
  elements: SlideElement[],
  slideBackground: SlideBackground | null | undefined,
  backgroundSource: SlideBackgroundSource,
): DetachMaterializationPlan {
  if (!theme) {
    return { updates: elements.filter((element) => element.type === 'group').map(stripOverrideMetadata), creates: [], deletes: [], background: slideBackground ?? null };
  }
  const resolved = resolveLinkedSlideElements(theme, slideId, elements);
  const persistedById = new Map<Id, SlideElement>();
  for (const element of elements) persistedById.set(element.id, element);
  const resolvedIds = new Set<Id>(resolved.map((element) => element.id));
  const updates: SlideElement[] = [];
  const creates: SlideElement[] = [];
  for (const element of resolved) {
    const persisted = persistedById.get(element.id);
    if (!persisted) {
      creates.push(stripOverrideMetadata(element));
      continue;
    }
    if (!elementsEqualForDetach(persisted, element) || persisted.type === 'group') updates.push(stripOverrideMetadata(element));
  }
  const deletes: Id[] = [];
  for (const element of elements) {
    if (!element.sourceThemeElementId) continue;
    if (!resolvedIds.has(element.id)) deletes.push(element.id);
  }
  return {
    updates,
    creates,
    deletes,
    background: resolveLinkedSlideBackground(theme.background, slideBackground, backgroundSource),
  };
}

function elementsEqualForDetach(persisted: SlideElement, resolved: SlideElement): boolean {
  // Compare appearance only: provenance/override metadata ride on the rows
  // (in memory) but are cleared by the detach itself, so they must not force
  // a write on their own.
  const persistedPayload = JSON.stringify(normalizeForAppearanceCompare(persisted.payload));
  const resolvedPayload = JSON.stringify(normalizeForAppearanceCompare(resolved.payload));
  return (
    persisted.x === resolved.x &&
    persisted.y === resolved.y &&
    persisted.width === resolved.width &&
    persisted.height === resolved.height &&
    persisted.rotation === resolved.rotation &&
    persisted.opacity === resolved.opacity &&
    persisted.zIndex === resolved.zIndex &&
    persisted.layer === resolved.layer &&
    persistedPayload === resolvedPayload
  );
}

function normalizeForAppearanceCompare(payload: SlideElementPayload): SlideElementPayload {
  if ((payload as GroupElementPayload).children !== undefined) {
    const group = payload as unknown as { children: SlideElement[] };
    const normalizedChildren = group.children.map((child) => {
      const { sourceThemeElementId: _provenance, themeOverrideKeys: _overrides, ...rest } = child;
      void _provenance;
      void _overrides;
      return { ...rest, payload: normalizeForAppearanceCompare(child.payload) };
    });
    return { ...payload, children: normalizedChildren } as unknown as SlideElementPayload;
  }
  return payload;
}

/**
 * Detach output shape: current appearance with the link dropped. IDs are
 * preserved (stable instances); provenance and override metadata are cleared
 * so no future theme change can reach the rows. Children recurse.
 */
export function stripOverrideMetadata(element: SlideElement): SlideElement {
  const stripped: SlideElement = {
    ...element,
    sourceThemeElementId: null,
    themeOverrideKeys: null,
  };
  if (element.type === 'group') {
    const payload = element.payload as GroupElementPayload;
    stripped.payload = { ...payload, children: (payload.children ?? []).map(stripOverrideMetadata) };
  }
  return stripped;
}


/** A local delete of a theme-owned node hides it; the theme still owns its structure. */
export function preserveThemeLocalRemovals(
  themeElements: readonly SlideElement[], previous: readonly SlideElement[], edited: readonly SlideElement[],
): SlideElement[] {
  const sources = new Map(themeElements.map((element) => [element.id, element]));
  const before = new Map(previous.map((element) => [element.id, element]));
  const ids = new Set(edited.map((element) => element.id));
  const result = edited.map((element) => {
    const source = element.sourceThemeElementId ? sources.get(element.sourceThemeElementId) : null;
    const old = before.get(element.id);
    if (element.type !== 'group' || source?.type !== 'group' || old?.type !== 'group') return element;
    return { ...element, payload: { ...element.payload, children: preserveThemeLocalRemovals(
      (source.payload as GroupElementPayload).children, (old.payload as GroupElementPayload).children,
      (element.payload as GroupElementPayload).children,
    ) } } as SlideElement;
  });
  for (const element of previous) {
    if (ids.has(element.id) || !element.sourceThemeElementId || !sources.has(element.sourceThemeElementId)) continue;
    result.push({ ...element, payload: { ...element.payload, visible: false },
      themeOverrideKeys: [...new Set([...(element.themeOverrideKeys ?? []), 'visible'])].sort() } as SlideElement);
  }
  return result;
}
