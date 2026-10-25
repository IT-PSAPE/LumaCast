import {
  Children,
  isValidElement,
  useCallback,
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

export type SplitChangeReason = 'drag' | 'keyboard' | 'collapse' | 'expand' | 'reset';

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

/** Apply a cumulative handle delta to `base`; collapsed panes are locked. */
function applyHandleDelta(panes: readonly SplitPaneConfig[], base: SplitLayout, handleIndex: number, delta: number): SplitLayout {
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
}

export interface SplitController {
  panes: readonly SplitPaneConfig[];
  layout: SplitLayout;
  collapse: (id: string) => void;
  expand: (id: string) => void;
  toggle: (id: string) => void;
  reset: () => void;
  /** Gesture API used by Split's handles; exposed for custom handle placement. */
  beginResize: (source: ResizeSource) => void;
  resizeBy: (handleIndex: number, delta: number) => void;
  endResize: () => void;
}

export function useSplitController({ panes, layout, defaultLayout, onLayoutChange }: UseSplitControllerOptions): SplitController {
  const [internal, setInternal] = useState(() => normalizeSplitLayout(panes, defaultLayout));
  const controlled = layout !== undefined;
  const current = normalizeSplitLayout(panes, layout ?? internal);

  // Always-fresh refs so a gesture composes against what it last emitted even
  // when a controlled parent has not re-rendered yet.
  const latest = useRef(current);
  latest.current = current;
  const panesRef = useRef(panes);
  panesRef.current = panes;
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
  const beginResize = useCallback((source: ResizeSource) => {
    gesture.current = { base: latest.current, reason: source === 'pointer' ? 'drag' : 'keyboard' };
  }, []);
  const resizeBy = useCallback(
    (handleIndex: number, delta: number) => {
      const g = gesture.current;
      if (!g) return;
      commit(applyHandleDelta(panesRef.current, g.base, handleIndex, delta), { phase: 'live', reason: g.reason });
    },
    [commit],
  );
  const endResize = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (g) commit(latest.current, { phase: 'commit', reason: g.reason });
  }, [commit]);

  return { panes, layout: current, collapse, expand, toggle, reset, beginResize, resizeBy, endResize };
}

export interface SplitProps {
  orientation: 'horizontal' | 'vertical';
  layout?: SplitLayout;
  defaultLayout?: SplitLayout;
  onLayoutChange?: (layout: SplitLayout, meta: SplitChangeMeta) => void;
  /** Share a controller (from useSplitController) to drive collapse from outside. */
  controller?: SplitController;
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

function SplitRoot({
  orientation,
  layout,
  defaultLayout,
  onLayoutChange,
  controller,
  variant = 'hairline',
  className,
  children,
}: SplitProps) {
  const elements = Children.toArray(children).filter(isPane);
  const own = useSplitController({
    panes: elements.map((el) => {
      const { children: _children, className: _className, ...config } = el.props;
      return config;
    }),
    layout,
    defaultLayout,
    onLayoutChange,
  });
  const ctl = controller ?? own;
  const horizontal = orientation === 'horizontal';

  return (
    <div className={cn('flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}>
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
        return (
          <FragmentKey key={config.id}>
            <div
              data-pane-id={config.id}
              data-collapsed={entry?.collapsed ? 'true' : undefined}
              className={cn('relative min-h-0 min-w-0 overflow-hidden', el.props.className)}
              style={style}
            >
              {el.props.children}
            </div>
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
