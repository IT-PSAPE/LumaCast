/**
 * Resizable workbench geometry: the bottom docks (Scenes, Sources, Audio
 * Mixer, YouTube Live, Controls, Zoom) and the height of the bottom
 * panel that holds them. Widths are kept as grid weights so the docks still
 * share any spare width when the window changes size; the panel height is a
 * fixed pixel value. Docks can be individually hidden; hidden docks keep
 * their stored weight so re-showing one restores its previous width.
 */

export type DockId = 'scenes' | 'sources' | 'mixer' | 'youtube' | 'zoom' | 'controls';

export const DOCK_ORDER: readonly DockId[] = ['scenes', 'sources', 'mixer', 'youtube', 'controls', 'zoom'];

export const DOCK_LABELS: Record<DockId, string> = {
  scenes: 'Scenes',
  sources: 'Sources',
  mixer: 'Audio Mixer',
  youtube: 'YouTube Live',
  zoom: 'Zoom',
  controls: 'Controls',
};

export const DOCK_MIN_WIDTHS: Record<DockId, number> = {
  scenes: 200,
  sources: 185,
  mixer: 225,
  youtube: 240,
  zoom: 240,
  controls: 180,
};

export const DEFAULT_DOCK_WEIGHTS: Record<DockId, number> = {
  scenes: 0.9,
  sources: 1,
  mixer: 1.2,
  youtube: 1,
  zoom: 1,
  controls: 0.95,
};

/** Provider docks are opt-in until a user configures them. */
export const DEFAULT_HIDDEN_DOCKS: readonly DockId[] = ['youtube', 'zoom'];

/** The dock set visible by default, in column order — this is the exact set the stylesheet's static grid is built for. */
const DEFAULT_VISIBLE_DOCKS: readonly DockId[] = DOCK_ORDER.filter((id) => !DEFAULT_HIDDEN_DOCKS.includes(id));

/**
 * Row height used when the panel height has never been customized but the
 * visible dock set isn't the default one. The static stylesheet rows only
 * suit the default dock set; any other set renders an explicit row so the
 * panel keeps a sensible height instead of silently depending on CSS tuned
 * for a different layout.
 */
const FALLBACK_BOTTOM_PANEL_HEIGHT = 210;

export const BOTTOM_PANEL_MIN_HEIGHT = 150;
export const MONITOR_MIN_HEIGHT = 240;
export const WORKBENCH_LAYOUT_STORAGE_KEY = 'lumastream.workbench-layout';

export interface WorkbenchLayout {
  /** Relative dock widths keyed by dock id, or null for the stylesheet defaults. Docks absent from the record use their default weight. */
  dockWeights: Partial<Record<DockId, number>> | null;
  /** Bottom panel height in pixels, or null for the stylesheet default. */
  bottomPanelHeight: number | null;
  /** Docks the user has hidden, in no particular order. */
  hiddenDocks: DockId[];
  /** Left-to-right dock order, visible and hidden docks alike. Defaults to DOCK_ORDER. */
  dockOrder: DockId[];
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  dockWeights: null,
  bottomPanelHeight: null,
  hiddenDocks: [...DEFAULT_HIDDEN_DOCKS],
  dockOrder: [...DOCK_ORDER],
};

const DOCK_ID_SET: ReadonlySet<string> = new Set(DOCK_ORDER);

function isDockId(value: unknown): value is DockId {
  return typeof value === 'string' && DOCK_ID_SET.has(value);
}

/** Docks in column order that are currently shown. */
export function visibleDocks(layout: WorkbenchLayout): DockId[] {
  return layout.dockOrder.filter((id) => !layout.hiddenDocks.includes(id));
}

/** Shows a hidden dock or hides a visible one, keeping `hiddenDocks` in column order. */
export function toggleDockVisibility(layout: WorkbenchLayout, id: DockId): WorkbenchLayout {
  const isHidden = layout.hiddenDocks.includes(id);
  const nextHidden = isHidden ? layout.hiddenDocks.filter((dockId) => dockId !== id) : [...layout.hiddenDocks, id];
  return { ...layout, hiddenDocks: layout.dockOrder.filter((dockId) => nextHidden.includes(dockId)) };
}

/** Restores the out-of-the-box layout (including default hidden docks and column order). */
export function resetWorkbenchLayout(): WorkbenchLayout {
  return { dockWeights: null, bottomPanelHeight: null, hiddenDocks: [...DEFAULT_HIDDEN_DOCKS], dockOrder: [...DOCK_ORDER] };
}

/**
 * Whether `layout` is indistinguishable from the stock out-of-the-box layout:
 * no custom weights or panel height, only the default docks hidden, and the
 * default column order. Used to decide whether the persisted layout key can
 * be removed entirely rather than written — a layout that only differs by
 * `hiddenDocks`/`dockOrder` (e.g. the user hid or reordered a dock but never
 * resized anything) still needs to be written, not dropped just because
 * `dockWeights`/`bottomPanelHeight` are both null.
 */
export function isDefaultWorkbenchLayout(layout: WorkbenchLayout): boolean {
  return layout.dockWeights === null
    && layout.bottomPanelHeight === null
    && layout.hiddenDocks.length === DEFAULT_HIDDEN_DOCKS.length
    && layout.hiddenDocks.every((id) => DEFAULT_HIDDEN_DOCKS.includes(id))
    && layout.dockOrder.length === DOCK_ORDER.length
    && layout.dockOrder.every((id, index) => id === DOCK_ORDER[index]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Moves `id` to `targetIndex` within the full dock order (visible and hidden
 * docks alike), clamped to the list bounds. Unknown ids and a `targetIndex`
 * matching the current position both return `layout` unchanged (a new object
 * with an equal `dockOrder`).
 */
export function moveDock(layout: WorkbenchLayout, id: DockId, targetIndex: number): WorkbenchLayout {
  const order = layout.dockOrder;
  const from = order.indexOf(id);
  if (from === -1) return { ...layout };
  const target = clamp(targetIndex, 0, order.length - 1);
  if (target === from) return { ...layout };
  const next = order.filter((candidate) => candidate !== id);
  next.splice(target, 0, id);
  return { ...layout, dockOrder: next };
}

/**
 * Reorders the dock order after a pointer drop on a dock's title row.
 * `beforeId` is the dock the drop indicator sat in front of among the
 * *visible* docks, or `null` for "after the last visible dock" — mirroring
 * `reorderOnDrop` in scene-order.ts, but resolved against the full dock order
 * so hidden docks keep their relative position. Dropping a dock back into its
 * own gap, or in front of an unknown id, is a no-op.
 */
export function reorderDockOnDrop(layout: WorkbenchLayout, draggedId: DockId, beforeId: DockId | null): WorkbenchLayout {
  const order = layout.dockOrder;
  const from = order.indexOf(draggedId);
  if (from === -1) return { ...layout };
  const targetIndex = beforeId === null ? order.length : order.indexOf(beforeId);
  if (targetIndex === -1) return { ...layout };
  const insertAt = targetIndex > from ? targetIndex - 1 : targetIndex;
  if (insertAt === from) return { ...layout };
  const next = order.filter((candidate) => candidate !== draggedId);
  next.splice(insertAt, 0, draggedId);
  return { ...layout, dockOrder: next };
}

/**
 * Moves the boundary between the visible docks at `boundary` and `boundary + 1`
 * by `delta` pixels (positive grows the left dock), never shrinking either
 * below its minimum. `widths` and `minWidths` are aligned arrays over the
 * currently visible dock list.
 */
export function resizeDockWidths(widths: readonly number[], boundary: number, delta: number, minWidths: readonly number[]): number[] {
  if (!Number.isInteger(boundary) || boundary < 0 || boundary >= widths.length - 1 || !Number.isFinite(delta)) return [...widths];
  const left = widths[boundary]!;
  const right = widths[boundary + 1]!;
  const leftMin = minWidths[boundary] ?? 0;
  const rightMin = minWidths[boundary + 1] ?? 0;
  const clamped = Math.max(leftMin - left, Math.min(right - rightMin, delta));
  const next = [...widths];
  next[boundary] = left + clamped;
  next[boundary + 1] = right - clamped;
  return next;
}

/**
 * Normalizes pixel widths for the visible docks `ids` into grid weights that
 * sum to `ids.length`, merged over `current` so docks outside `ids` (i.e.
 * currently hidden ones) keep whatever weight they already had stored.
 */
export function dockWeightsFromWidths(ids: readonly DockId[], widths: readonly number[], current: Partial<Record<DockId, number>> | null): Partial<Record<DockId, number>> {
  const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0);
  const next: Partial<Record<DockId, number>> = { ...current };
  ids.forEach((id, index) => {
    const width = Math.max(0, widths[index] ?? 0);
    next[id] = total > 0 ? Math.round((width / total) * ids.length * 1000) / 1000 : DEFAULT_DOCK_WEIGHTS[id];
  });
  return next;
}

export function clampBottomPanelHeight(height: number, workbenchHeight: number): number {
  const maximum = Math.max(BOTTOM_PANEL_MIN_HEIGHT, workbenchHeight - MONITOR_MIN_HEIGHT);
  return Math.round(Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(maximum, height)));
}

/** 1-based grid column for `id` among the visible docks, or null when it's hidden. */
export function dockGridColumn(layout: WorkbenchLayout, id: DockId): number | null {
  const index = visibleDocks(layout).indexOf(id);
  return index === -1 ? null : index + 1;
}

/**
 * CSS `grid-template-columns` for the visible docks. Returns null only when
 * there are no custom weights and the visible set is the default one — the
 * exact set the stylesheet's static grid already matches — so the stylesheet
 * value applies. Any other case (custom weights, or a different visible set)
 * renders an explicit template built from the per-dock weight (falling back
 * to its default weight) and minimum width.
 */
export function dockColumnsTemplate(layout: WorkbenchLayout): string | null {
  const visible = visibleDocks(layout);
  const isDefaultVisibleSet = visible.length === DEFAULT_VISIBLE_DOCKS.length && visible.every((id, index) => id === DEFAULT_VISIBLE_DOCKS[index]);
  if (layout.dockWeights === null && isDefaultVisibleSet) return null;
  const weights = layout.dockWeights;
  return visible.map((id) => `minmax(${DOCK_MIN_WIDTHS[id]}px, ${weights?.[id] ?? DEFAULT_DOCK_WEIGHTS[id]}fr)`).join(' ');
}

/** Minimum horizontal space needed to show every visible dock at its own minimum width. */
export function dockColumnsMinWidth(layout: WorkbenchLayout): number {
  return visibleDocks(layout).reduce((width, id) => width + DOCK_MIN_WIDTHS[id], 0);
}

/**
 * CSS `grid-template-rows` for the bottom panel. Collapses to a 0px bottom
 * row when no docks are visible; returns null (stylesheet default) only when
 * the panel height has never been customized and the default dock count is
 * visible; otherwise renders an explicit row, falling back to
 * `FALLBACK_BOTTOM_PANEL_HEIGHT` when no height has been set.
 */
export function workbenchRowsTemplate(bottomPanelHeight: number | null, visibleCount: number): string | null {
  if (visibleCount === 0) return `minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 0px`;
  if (bottomPanelHeight === null && visibleCount === DEFAULT_VISIBLE_DOCKS.length) return null;
  return `minmax(${MONITOR_MIN_HEIGHT}px, 1fr) ${bottomPanelHeight ?? FALLBACK_BOTTOM_PANEL_HEIGHT}px`;
}

function isFiniteWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= DOCK_ORDER.length;
}

/** Legacy persisted order, from before provider docks had ids. */
const LEGACY_DOCK_ORDER: readonly DockId[] = ['scenes', 'sources', 'mixer', 'controls'];

function isLegacyWeightList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === LEGACY_DOCK_ORDER.length && value.every(isFiniteWeight);
}

/** Parses either the legacy 4-element array shape or the current per-dock record shape; drops unknown keys and invalid numbers. */
function parseDockWeights(value: unknown): Partial<Record<DockId, number>> | null {
  if (isLegacyWeightList(value)) {
    const record: Partial<Record<DockId, number>> = {};
    LEGACY_DOCK_ORDER.forEach((id, index) => { record[id] = value[index]; });
    return record;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: Partial<Record<DockId, number>> = {};
  for (const [key, weight] of Object.entries(value as Record<string, unknown>)) {
    if (isDockId(key) && isFiniteWeight(weight)) record[key] = weight;
  }
  return Object.keys(record).length > 0 ? record : null;
}

/** Parses the hidden-dock list, dropping unknown ids; falls back to the default hidden set when absent or malformed. */
function parseHiddenDocks(value: unknown): DockId[] {
  if (!Array.isArray(value)) return [...DEFAULT_HIDDEN_DOCKS];
  const known = value.filter(isDockId);
  return DOCK_ORDER.filter((id) => known.includes(id));
}

/** Parses the persisted dock order: drops unknown or duplicate ids, falls back to DOCK_ORDER when absent or malformed, and appends any dock ids missing from an otherwise-valid list (e.g. a dock added after the layout was saved). */
function parseDockOrder(value: unknown): DockId[] {
  if (!Array.isArray(value)) return [...DOCK_ORDER];
  const known: DockId[] = [];
  for (const entry of value) {
    if (isDockId(entry) && !known.includes(entry)) known.push(entry);
  }
  const missing = DOCK_ORDER.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

/** Restores a persisted layout, falling back to defaults for anything malformed. */
export function parseWorkbenchLayout(raw: string | null | undefined): WorkbenchLayout {
  if (!raw) return resetWorkbenchLayout();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return resetWorkbenchLayout();
    const record = value as Record<string, unknown>;
    const height = record.bottomPanelHeight;
    return {
      dockWeights: parseDockWeights(record.dockWeights),
      bottomPanelHeight: typeof height === 'number' && Number.isFinite(height) && height >= BOTTOM_PANEL_MIN_HEIGHT && height <= 4000 ? Math.round(height) : null,
      hiddenDocks: parseHiddenDocks(record.hiddenDocks),
      dockOrder: parseDockOrder(record.dockOrder),
    };
  } catch {
    return resetWorkbenchLayout();
  }
}

export function serializeWorkbenchLayout(layout: WorkbenchLayout): string {
  return JSON.stringify({ dockWeights: layout.dockWeights, bottomPanelHeight: layout.bottomPanelHeight, hiddenDocks: layout.hiddenDocks, dockOrder: layout.dockOrder });
}
