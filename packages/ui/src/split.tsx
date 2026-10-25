import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { ResizeHandle, type ResizeSource } from './resize-handle';

// Split is an N-pane flex container with a ResizeHandle between each pair.
//
// It is controlled-first and does NOT persist anything: pass `layout` +
// `onLayoutChange`, or `defaultLayout` for uncontrolled use, and let the app
// store the layout wherever it already stores things. `onLayoutChange` reports
// `phase: 'live'` while a drag or key press is in flight and `phase: 'commit'`
// once it settles (persist on commit, not on live). Sizes are pixels. A `fill`
// pane absorbs the remaining space; its stored size is nominal.

export interface SplitPaneLayout {
  size: number;
  collapsed: boolean;
  /** Size to return to when expanding. Preserved across collapse/expand. */
  restoreSize: number;
}

export type SplitLayout = Record<string, SplitPaneLayout>;

export type SplitChangeReason = 'drag' | 'keyboard' | 'collapse' | 'expand' | 'reset' | 'fit';

/**
 * How a handle drag distributes space. `adjacent` moves the two panes beside
 * the handle (a fill pane absorbs the rest). `cascade` spills the delta
 * nearest-first through every pane on each side, caps it by the total slack on
 * both sides, and enables snap-collapse.
 */
export type SplitResizeMode = 'adjacent' | 'cascade';

export interface SplitChangeMeta {
  phase: 'live' | 'commit';
  reason: SplitChangeReason;
}

export interface SplitPaneProps {
  id: string;
  defaultSize: number;
  minSize: number;
  maxSize?: number;
  collapsible?: boolean;
  /** Size while collapsed. Default 0. */
  collapsedSize?: number;
  /** Takes the remaining space instead of a fixed size. */
  fill?: boolean;
  /**
   * Cascade mode only: collapse when dragged more than half of `minSize` below
   * it, and restore when dragged back. Default: same as `collapsible`.
   */
  snap?: boolean;
  /** Render nothing for this pane while collapsed (frees heavy subtrees). Default false: stays mounted. */
  unmountWhenCollapsed?: boolean;
  /** Accessible name fragment for the handle after this pane. Default: id. */
  label?: string;
  className?: string;
  children?: ReactNode;
}

export type SplitPaneConfig = Omit<SplitPaneProps, 'children' | 'className'>;

export interface SplitLimits {
  min: number;
  max: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Move the boundary between `sizes[index]` and `sizes[index + 1]` by `delta`.
 * The pair's total is conserved and both stay within their limits; the delta is
 * reduced to whatever fits. Pure; returns a new array.
 */
export function resizeAdjacent(sizes: readonly number[], limits: readonly SplitLimits[], index: number, delta: number): number[] {
  const next = [...sizes];
  const a = sizes[index];
  const b = sizes[index + 1];
  const limitA = limits[index];
  const limitB = limits[index + 1];
  if (a === undefined || b === undefined || !limitA || !limitB) return next;
  const lo = Math.max(limitA.min - a, b - limitB.max);
  const hi = Math.min(limitA.max - a, b - limitB.min);
  if (lo > hi) return next;
  const applied = clamp(delta, lo, hi);
  next[index] = a + applied;
  next[index + 1] = b - applied;
  return next;
}

function paneLimits(pane: SplitPaneConfig): SplitLimits {
  return { min: pane.minSize, max: pane.maxSize ?? Number.POSITIVE_INFINITY };
}

function collapsedSizeOf(pane: SplitPaneConfig) {
  return pane.collapsedSize ?? 0;
}

/** Fill in missing panes, drop unknown ones, and clamp every size to its limits. */
export function normalizeSplitLayout(panes: readonly SplitPaneConfig[], input?: SplitLayout): SplitLayout {
  const layout: SplitLayout = {};
  for (const pane of panes) {
    const { min, max } = paneLimits(pane);
    const entry = input?.[pane.id];
    const collapsed = pane.collapsible ? entry?.collapsed === true : false;
    const restoreSize = clamp(entry?.restoreSize ?? pane.defaultSize, min, max);
    const size = collapsed ? collapsedSizeOf(pane) : clamp(entry?.size ?? pane.defaultSize, min, max);
    layout[pane.id] = { size, collapsed, restoreSize };
  }
  return layout;
}

export function createSplitLayout(panes: readonly SplitPaneConfig[]): SplitLayout {
  return normalizeSplitLayout(panes);
}

export function collapseSplitPane(panes: readonly SplitPaneConfig[], layout: SplitLayout, id: string): SplitLayout {
  const pane = panes.find((p) => p.id === id);
  const entry = layout[id];
  if (!pane || !pane.collapsible || !entry || entry.collapsed) return layout;
  const { min, max } = paneLimits(pane);
  return { ...layout, [id]: { size: collapsedSizeOf(pane), collapsed: true, restoreSize: clamp(entry.size, min, max) } };
}

export function expandSplitPane(panes: readonly SplitPaneConfig[], layout: SplitLayout, id: string): SplitLayout {
  const pane = panes.find((p) => p.id === id);
  const entry = layout[id];
  if (!pane || !entry || !entry.collapsed) return layout;
  const { min, max } = paneLimits(pane);
  const size = clamp(entry.restoreSize, min, max);
  return { ...layout, [id]: { size, collapsed: false, restoreSize: size } };
}

interface CascadeItem {
  min: number;
  max: number;
  viewMin: number;
  viewMax: number;
  snap: boolean;
  visible: boolean;
  size: number;
  restoreSize: number;
}

function cascadeUp(handleIndex: number) {
  const indexes: number[] = [];
  for (let i = handleIndex; i >= 0; i--) indexes.push(i);
  return indexes;
}

function cascadeDown(handleIndex: number, length: number) {
  const indexes: number[] = [];
  for (let i = handleIndex + 1; i < length; i++) indexes.push(i);
  return indexes;
}

function setItemVisible(item: CascadeItem, visible: boolean, sizeAtStart: number) {
  if (visible === item.visible) return;
  if (visible) {
    const size = clamp(item.restoreSize, item.viewMin, item.viewMax);
    Object.assign(item, { size, restoreSize: size, visible: true, min: item.viewMin, max: item.viewMax });
    return;
  }
  // restoreSize is the size at drag start, not the size reached when it collapsed.
  Object.assign(item, { restoreSize: sizeAtStart > 0 ? sizeAtStart : item.size, size: 0, visible: false, min: 0, max: 0 });
}

// A visible snap pane is the nearest one that can collapse; a hidden one is the
// nearest that can come back. A resizable visible pane in between shields the rest.
function firstSnapIndex(items: readonly CascadeItem[], indexes: readonly number[]): number | undefined {
  for (const i of indexes) {
    const item = items[i];
    if (item?.visible && item.snap) return i;
  }
  for (const i of indexes) {
    const item = items[i];
    if (!item) continue;
    if (item.visible && item.viewMax - item.viewMin > 0) return undefined;
    if (!item.visible && item.snap) return i;
  }
  return undefined;
}

export interface SplitResizeResult {
  layout: SplitLayout;
  /** The part of `delta` that was applied after clamping. */
  appliedDelta: number;
}

/**
 * Cascading resize of the boundary after pane `handleIndex`. Pure.
 *
 * The delta spills nearest-first through all panes on each side and is capped
 * by the total slack of both sides, so the visible total is conserved. Collapsed
 * panes contribute no slack. A snap pane dragged more than half of its `minSize`
 * past its limit collapses (boundary is strict and mirrored on both sides:
 * overshoot > half collapses, overshoot <= half stays; a collapsed pane returns
 * once dragged back to half of `minSize`). `layout` is the state at drag start.
 */
export function resizeSplitFromDelta(
  panes: readonly SplitPaneConfig[],
  layout: SplitLayout,
  handleIndex: number,
  delta: number,
): SplitResizeResult {
  if (!Number.isInteger(handleIndex) || handleIndex < 0 || handleIndex >= panes.length - 1) {
    return { layout, appliedDelta: 0 };
  }
  const items: CascadeItem[] = panes.map((pane) => {
    const entry = layout[pane.id];
    const { min, max } = paneLimits(pane);
    const visible = !(pane.collapsible && entry?.collapsed);
    return {
      min: visible ? min : 0,
      max: visible ? max : 0,
      viewMin: min,
      viewMax: max,
      snap: Boolean(pane.collapsible && (pane.snap ?? true)),
      visible,
      size: visible ? (entry?.size ?? pane.defaultSize) : 0,
      restoreSize: entry?.restoreSize ?? pane.defaultSize,
    };
  });
  const sizes = items.map((item) => item.size);
  const up = cascadeUp(handleIndex);
  const down = cascadeDown(handleIndex, items.length);
  const sum = (indexes: number[], pick: (i: number) => number) => indexes.reduce((total, i) => total + pick(i), 0);
  const slack = {
    minUp: () => sum(up, (i) => items[i]!.min - sizes[i]!),
    maxUp: () => sum(up, (i) => items[i]!.max - sizes[i]!),
    maxDown: () => sum(down, (i) => sizes[i]! - items[i]!.min),
    minDown: () => sum(down, (i) => sizes[i]! - items[i]!.max),
  };

  const snapBeforeIndex = firstSnapIndex(items, up);
  const snapAfterIndex = firstSnapIndex(items, down);
  const snapBefore = snapBeforeIndex;
  const snapAfter = snapAfterIndex;
  const half = (i: number) => Math.floor(items[i]!.viewMin / 2);
  const startSizes = [...sizes];

  // Snap thresholds are fixed from the drag-start state; evaluate them before any pane changes.
  const beforeLimit = snapBefore === undefined ? 0 : items[snapBefore]!.visible ? slack.minUp() - half(snapBefore) : slack.minUp() + half(snapBefore);
  const afterLimit = snapAfter === undefined ? 0 : items[snapAfter]!.visible ? slack.maxDown() + half(snapAfter) : slack.maxDown() - half(snapAfter);

  const snapPass = () => {
    if (snapBefore !== undefined) {
      const target = items[snapBefore]!;
      const shouldBeVisible = delta >= beforeLimit;
      const changed = shouldBeVisible !== target.visible;
      setItemVisible(target, shouldBeVisible, startSizes[snapBefore]!);
      if (changed) return true;
    }
    if (snapAfter !== undefined) {
      const target = items[snapAfter]!;
      const shouldBeVisible = delta <= afterLimit;
      const changed = shouldBeVisible !== target.visible;
      setItemVisible(target, shouldBeVisible, startSizes[snapAfter]!);
      if (changed) return true;
    }
    return false;
  };
  // One snap can unlock the other side, so settle before measuring slack.
  if (snapPass()) snapPass();

  const minDelta = Math.max(slack.minUp(), down.length === 0 ? Number.NEGATIVE_INFINITY : slack.minDown());
  const maxDelta = Math.min(slack.maxUp(), down.length === 0 ? Number.POSITIVE_INFINITY : slack.maxDown());
  const applied = clamp(delta, minDelta, maxDelta);

  let upDelta = applied;
  for (const i of up) {
    const item = items[i]!;
    const target = clamp(sizes[i]! + upDelta, item.min, item.max);
    upDelta -= target - sizes[i]!;
    item.size = target;
  }
  let downDelta = applied;
  for (const i of down) {
    const item = items[i]!;
    const target = clamp(sizes[i]! - downDelta, item.min, item.max);
    downDelta += target - sizes[i]!;
    item.size = target;
  }

  const next: SplitLayout = {};
  panes.forEach((pane, i) => {
    const item = items[i]!;
    next[pane.id] = item.visible
      ? { size: item.size, collapsed: false, restoreSize: item.size }
      : { size: collapsedSizeOf(pane), collapsed: true, restoreSize: item.restoreSize };
  });
  return { layout: next, appliedDelta: applied };
}

/**
 * Rewrite stored sizes so the visible panes sum to `containerSize`. Pure.
 *
 * Each visible size is clamped first, then the difference (rounded to whole
 * pixels) goes to the `fill` pane, then the panes before it, then the panes
 * after it, each within its limits. Collapsed panes keep their `collapsedSize`
 * and take their space off the container. Non-positive or non-finite
 * containers return an unchanged copy; if limits make an exact fit impossible
 * the result overflows or underfills.
 */
export function fitSplitLayoutToContainer(panes: readonly SplitPaneConfig[], layout: SplitLayout, containerSize: number): SplitLayout {
  const next: SplitLayout = {};
  for (const pane of panes) {
    const entry = layout[pane.id];
    if (entry) next[pane.id] = { ...entry };
  }
  if (!Number.isFinite(containerSize) || containerSize <= 0) return next;

  const visible = panes.filter((pane) => next[pane.id] && !next[pane.id]!.collapsed);
  if (visible.length === 0) return next;
  for (const pane of visible) {
    const entry = next[pane.id]!;
    const { min, max } = paneLimits(pane);
    entry.size = clamp(entry.size, min, max);
    entry.restoreSize = entry.size;
  }

  const occupied = panes.reduce((total, pane) => {
    const entry = next[pane.id];
    return entry?.collapsed ? total + collapsedSizeOf(pane) : total;
  }, 0);
  const total = visible.reduce((sum, pane) => sum + next[pane.id]!.size, 0);
  const delta = Math.round(containerSize - occupied - total);
  if (delta === 0) return next;

  const fillIndex = visible.findIndex((pane) => pane.fill);
  const order = fillIndex === -1 ? visible : [visible[fillIndex]!, ...visible.slice(0, fillIndex), ...visible.slice(fillIndex + 1)];
  let remaining = Math.abs(delta);
  for (const pane of order) {
    const entry = next[pane.id]!;
    const { min, max } = paneLimits(pane);
    const capacity = delta > 0 ? max - entry.size : entry.size - min;
    if (capacity <= 0) continue;
    const applied = Math.min(remaining, capacity);
    entry.size += delta > 0 ? applied : -applied;
    entry.restoreSize = entry.size;
    remaining -= applied;
    if (remaining <= 0) break;
  }
  return next;
}

/** Apply a cumulative handle delta to `base`; in adjacent mode collapsed panes are locked. */
function applyHandleDelta(
  panes: readonly SplitPaneConfig[],
  base: SplitLayout,
  handleIndex: number,
  delta: number,
  mode: SplitResizeMode,
): SplitLayout {
  if (mode === 'cascade') return resizeSplitFromDelta(panes, base, handleIndex, delta).layout;
  const a = panes[handleIndex];
  const b = panes[handleIndex + 1];
  if (!a || !b) return base;
  const entryA = base[a.id];
  const entryB = base[b.id];
  if (!entryA || !entryB || entryA.collapsed || entryB.collapsed) return base;
  if (a.fill && b.fill) return base;

  let sizeA = entryA.size;
  let sizeB = entryB.size;
  if (b.fill) {
    const { min, max } = paneLimits(a);
    sizeA = clamp(entryA.size + delta, min, max);
  } else if (a.fill) {
    const { min, max } = paneLimits(b);
    sizeB = clamp(entryB.size - delta, min, max);
  } else {
    [sizeA, sizeB] = resizeAdjacent([entryA.size, entryB.size], [paneLimits(a), paneLimits(b)], 0, delta) as [number, number];
  }
  return {
    ...base,
    [a.id]: { ...entryA, size: sizeA, restoreSize: sizeA },
    [b.id]: { ...entryB, size: sizeB, restoreSize: sizeB },
  };
}

export interface UseSplitControllerOptions {
  panes: readonly SplitPaneConfig[];
  layout?: SplitLayout;
  defaultLayout?: SplitLayout;
  onLayoutChange?: (layout: SplitLayout, meta: SplitChangeMeta) => void;
  /** Default 'adjacent'. */
  resize?: SplitResizeMode;
}

export interface SplitController {
  panes: readonly SplitPaneConfig[];
  layout: SplitLayout;
  collapse: (id: string) => void;
  expand: (id: string) => void;
  toggle: (id: string) => void;
  reset: () => void;
  /** Fit visible panes to a container size in px (see fitSplitLayoutToContainer); commits only if sizes change. */
  fit: (containerSize: number) => void;
  /** Gesture API used by Split's handles; exposed for custom handle placement. */
  beginResize: (source: ResizeSource) => void;
  resizeBy: (handleIndex: number, delta: number) => void;
  endResize: () => void;
}

export function useSplitController({ panes, layout, defaultLayout, onLayoutChange, resize = 'adjacent' }: UseSplitControllerOptions): SplitController {
  const [internal, setInternal] = useState(() => normalizeSplitLayout(panes, defaultLayout));
  const controlled = layout !== undefined;
  const current = normalizeSplitLayout(panes, layout ?? internal);

  // Always-fresh refs so a gesture composes against what it last emitted even
  // when a controlled parent has not re-rendered yet.
  const latest = useRef(current);
  latest.current = current;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const modeRef = useRef(resize);
  modeRef.current = resize;
  const onChangeRef = useRef(onLayoutChange);
  onChangeRef.current = onLayoutChange;
  const gesture = useRef<{ base: SplitLayout; reason: SplitChangeReason } | null>(null);

  const commit = useCallback(
    (next: SplitLayout, meta: SplitChangeMeta) => {
      latest.current = next;
      if (!controlled) setInternal(next);
      onChangeRef.current?.(next, meta);
    },
    [controlled],
  );

  const collapse = useCallback(
    (id: string) => {
      const next = collapseSplitPane(panesRef.current, latest.current, id);
      if (next !== latest.current) commit(next, { phase: 'commit', reason: 'collapse' });
    },
    [commit],
  );
  const expand = useCallback(
    (id: string) => {
      const next = expandSplitPane(panesRef.current, latest.current, id);
      if (next !== latest.current) commit(next, { phase: 'commit', reason: 'expand' });
    },
    [commit],
  );
  const toggle = useCallback(
    (id: string) => (latest.current[id]?.collapsed ? expand(id) : collapse(id)),
    [collapse, expand],
  );
  const reset = useCallback(
    () => commit(createSplitLayout(panesRef.current), { phase: 'commit', reason: 'reset' }),
    [commit],
  );
  const fit = useCallback(
    (containerSize: number) => {
      const fitted = fitSplitLayoutToContainer(panesRef.current, latest.current, containerSize);
      const changed = panesRef.current.some((p) => fitted[p.id]?.size !== latest.current[p.id]?.size);
      if (changed) commit(normalizeSplitLayout(panesRef.current, fitted), { phase: 'commit', reason: 'fit' });
    },
    [commit],
  );
  const beginResize = useCallback((source: ResizeSource) => {
    gesture.current = { base: latest.current, reason: source === 'pointer' ? 'drag' : 'keyboard' };
  }, []);
  const resizeBy = useCallback(
    (handleIndex: number, delta: number) => {
      const g = gesture.current;
      if (!g) return;
      commit(applyHandleDelta(panesRef.current, g.base, handleIndex, delta, modeRef.current), { phase: 'live', reason: g.reason });
    },
    [commit],
  );
  const endResize = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (g) commit(latest.current, { phase: 'commit', reason: g.reason });
  }, [commit]);

  return { panes, layout: current, collapse, expand, toggle, reset, fit, beginResize, resizeBy, endResize };
}

export interface SplitProps {
  orientation: 'horizontal' | 'vertical';
  layout?: SplitLayout;
  defaultLayout?: SplitLayout;
  onLayoutChange?: (layout: SplitLayout, meta: SplitChangeMeta) => void;
  /** Share a controller (from useSplitController) to drive collapse from outside. */
  controller?: SplitController;
  /** Default 'adjacent'. Ignored when `controller` is given (its mode applies). */
  resize?: SplitResizeMode;
  /**
   * Keep visible pane sizes summing to the container along the split axis,
   * re-fitting on resize. Fires onLayoutChange with reason 'fit'. Default false.
   */
  fitToContainer?: boolean;
  variant?: 'rule' | 'hairline' | 'bar';
  className?: string;
  children: ReactNode;
}

// Marker element: Split reads its props and renders the pane wrapper itself.
function SplitPane({ children }: SplitPaneProps) {
  return <>{children}</>;
}

function isPane(node: ReactNode): node is ReactElement<SplitPaneProps> {
  return isValidElement(node) && node.type === SplitPane;
}

// Children.toArray does not look inside Fragments, so unwrap them ourselves.
function collectPanes(children: ReactNode): ReactElement<SplitPaneProps>[] {
  return Children.toArray(children).flatMap((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return collectPanes(child.props.children);
    return isPane(child) ? [child] : [];
  });
}

function SplitRoot({
  orientation,
  layout,
  defaultLayout,
  onLayoutChange,
  controller,
  resize,
  fitToContainer = false,
  variant = 'hairline',
  className,
  children,
}: SplitProps) {
  const elements = collectPanes(children);
  const own = useSplitController({
    panes: elements.map((el) => {
      const { children: _children, className: _className, ...config } = el.props;
      return config;
    }),
    layout,
    defaultLayout,
    onLayoutChange,
    resize,
  });
  const ctl = controller ?? own;
  const horizontal = orientation === 'horizontal';
  const rootRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef(ctl.fit);
  fitRef.current = ctl.fit;

  useEffect(() => {
    const root = rootRef.current;
    if (!fitToContainer || !root || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // Handles sit between panes and are not part of any pane's size.
      let handles = 0;
      for (const handle of root.querySelectorAll<HTMLElement>(':scope > [role="separator"]')) {
        handles += horizontal ? handle.offsetWidth : handle.offsetHeight;
      }
      fitRef.current((horizontal ? root.clientWidth : root.clientHeight) - handles);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitToContainer, horizontal]);

  return (
    <div ref={rootRef} className={cn('flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}>
      {elements.map((el, index) => {
        const config = ctl.panes.find((p) => p.id === el.props.id) ?? el.props;
        const entry = ctl.layout[config.id];
        const size = entry?.size ?? config.defaultSize;
        const next = ctl.panes[ctl.panes.findIndex((p) => p.id === config.id) + 1];
        const nextEl = elements[index + 1];
        const style: CSSProperties = config.fill
          ? { flex: '1 1 0%', [horizontal ? 'minWidth' : 'minHeight']: config.minSize }
          : { flex: `0 0 ${size}px` };
        const toggleTarget = config.collapsible ? config : next?.collapsible ? next : undefined;
        const unmounted = Boolean(entry?.collapsed && config.unmountWhenCollapsed);
        return (
          <FragmentKey key={config.id}>
            {unmounted && collapsedSizeOf(config) === 0 ? null : (
              <div
                data-pane-id={config.id}
                data-collapsed={entry?.collapsed ? 'true' : undefined}
                className={cn('relative min-h-0 min-w-0 overflow-hidden', el.props.className)}
                style={style}
              >
                {unmounted ? null : el.props.children}
              </div>
            )}
            {nextEl ? (
              <ResizeHandle
                orientation={orientation}
                variant={variant}
                label={`Resize ${config.label ?? config.id}`}
                value={size}
                min={config.minSize}
                max={config.maxSize}
                onResizeStart={ctl.beginResize}
                onResizeMove={(delta) => ctl.resizeBy(index, delta)}
                onResizeEnd={ctl.endResize}
                onReset={toggleTarget ? () => ctl.toggle(toggleTarget.id) : undefined}
              />
            ) : null}
          </FragmentKey>
        );
      })}
    </div>
  );
}

function FragmentKey({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const Split = Object.assign(SplitRoot, { Pane: SplitPane });
