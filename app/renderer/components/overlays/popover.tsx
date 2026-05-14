import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { clamp } from '../../utils/math';

// ── Types ──────────────────────────────────────────────────

type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
type PopoverAlign = 'start' | 'center' | 'end';

export type PopoverPlacement =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'left' | 'left-start' | 'left-end'
  | 'right' | 'right-start' | 'right-end';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  placement?: PopoverPlacement;
  offset?: number;
  className?: string;
  children: ReactNode;
  // When true, only fall back along the main axis (e.g., bottom→top) and never
  // to cross-axis sides. Dropdowns want this so the menu never appears beside
  // its trigger — that's confusing for menu UX.
  axisLock?: boolean;
}

interface ResolvedPosition {
  top: number;
  left: number;
  placement: PopoverPlacement;
}

// ── Constants ──────────────────────────────────────────────

const VIEWPORT_PADDING = 8;

function getOverlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}

// ── Component ──────────────────────────────────────────────

export function Popover({ anchor, open, onClose, placement = 'bottom', offset = 4, className = '', children, axisLock = false }: PopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ResolvedPosition | null>(null);

  // Participate in the global overlay stack so nested popovers (e.g. a select
  // opened inside a dialog) layer above whatever opened them. Without this the
  // popover's wrapper has `z-index: auto` and gets painted behind any sibling
  // overlay (like a Dialog) that has an explicit z-index.
  // NB: depend on the stable `register`/`unregister` callbacks, not the whole
  // `overlayStack` object — that object's reference changes every time the
  // stack entries change, which would cause a register → state-change → ref-change
  // → effect re-run → unregister → register loop.
  const { overlayStack } = useWorkbench();
  const { register, unregister } = overlayStack;
  const popoverId = useId();
  useEffect(() => {
    if (!open) return undefined;
    register(popoverId);
    return () => unregister(popoverId);
  }, [open, popoverId, register, unregister]);
  const stackIndex = overlayStack.stack.indexOf(popoverId);
  const zIndex = overlayStack.baseZIndex + Math.max(stackIndex, 0) * 10;

  // Compute position after content renders so we can measure it
  useLayoutEffect(() => {
    if (!open || !anchor || !contentRef.current) return;
    const pos = resolvePosition(anchor, contentRef.current, placement, offset, axisLock);
    setPosition(pos);
  }, [open, anchor, placement, offset, axisLock]);

  // Close on outside pointer. We also skip when the target lives inside any
  // popover content or context-menu-owned surface — without this, clicking
  // an item in a nested submenu (e.g. context menu → submenu A → submenu B
  // → item) closes ancestor popovers between pointerdown and click, so the
  // item unmounts before its click fires and the action never runs.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-popover-content="true"],[data-context-menu-owned="true"]')) return;
      onClose();
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, anchor, onClose]);

  // Re-position on scroll/resize while open
  useEffect(() => {
    if (!open || !anchor || !contentRef.current) return;
    const content = contentRef.current;
    function reposition() {
      if (!anchor || !content) return;
      const pos = resolvePosition(anchor, content, placement, offset, axisLock);
      setPosition(pos);
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, anchor, placement, offset, axisLock]);

  if (!open) return null;

  // First render: invisible until measured
  const isPositioned = position !== null;

  return createPortal(
    <div
      ref={contentRef}
      className={`pointer-events-auto ${className}`}
      style={{
        position: 'fixed',
        top: isPositioned ? position.top : -9999,
        left: isPositioned ? position.left : -9999,
        visibility: isPositioned ? 'visible' : 'hidden',
        zIndex,
      }}
      data-popover-content="true"
      data-popover-placement={isPositioned ? position.placement : undefined}
    >
      {children}
    </div>,
    overlayStack.rootElement ?? getOverlayRoot(),
  );
}

// ── Parsing ───────────────────────────────────────────────

function parsePlacement(p: PopoverPlacement): { side: PopoverSide; align: PopoverAlign } {
  const idx = p.indexOf('-');
  if (idx === -1) return { side: p as PopoverSide, align: 'center' };
  return { side: p.slice(0, idx) as PopoverSide, align: p.slice(idx + 1) as PopoverAlign };
}

function buildPlacement(side: PopoverSide, align: PopoverAlign): PopoverPlacement {
  return (align === 'center' ? side : `${side}-${align}`) as PopoverPlacement;
}

// ── Positioning logic ──────────────────────────────────────

function resolvePosition(
  anchor: HTMLElement,
  content: HTMLElement,
  preferred: PopoverPlacement,
  offset: number,
  axisLock: boolean,
): ResolvedPosition {
  const anchorRect = anchor.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Try preferred placement first, then fallbacks
  const fallbackOrder = getFallbackOrder(preferred, axisLock);

  for (const candidate of fallbackOrder) {
    const pos = computePosition(anchorRect, contentRect, candidate, offset);
    if (fitsInViewport(pos, contentRect, vw, vh)) {
      return { ...pos, placement: candidate };
    }
  }

  // Nothing fits perfectly — use preferred and clamp to viewport
  const pos = computePosition(anchorRect, contentRect, preferred, offset);
  return {
    top: clamp(pos.top, VIEWPORT_PADDING, vh - contentRect.height - VIEWPORT_PADDING),
    left: clamp(pos.left, VIEWPORT_PADDING, vw - contentRect.width - VIEWPORT_PADDING),
    placement: preferred,
  };
}

function alignOnAxis(anchorStart: number, anchorSize: number, contentSize: number, align: PopoverAlign): number {
  switch (align) {
    case 'start': return anchorStart;
    case 'center': return anchorStart + (anchorSize - contentSize) / 2;
    case 'end': return anchorStart + anchorSize - contentSize;
  }
}

function computePosition(
  anchor: DOMRect,
  content: DOMRect,
  placement: PopoverPlacement,
  offset: number,
): { top: number; left: number } {
  const { side, align } = parsePlacement(placement);

  switch (side) {
    case 'bottom':
      return {
        top: anchor.bottom + offset,
        left: alignOnAxis(anchor.left, anchor.width, content.width, align),
      };
    case 'top':
      return {
        top: anchor.top - content.height - offset,
        left: alignOnAxis(anchor.left, anchor.width, content.width, align),
      };
    case 'right':
      return {
        top: alignOnAxis(anchor.top, anchor.height, content.height, align),
        left: anchor.right + offset,
      };
    case 'left':
      return {
        top: alignOnAxis(anchor.top, anchor.height, content.height, align),
        left: anchor.left - content.width - offset,
      };
  }
}

function fitsInViewport(
  pos: { top: number; left: number },
  content: DOMRect,
  vw: number,
  vh: number,
): boolean {
  return (
    pos.top >= VIEWPORT_PADDING &&
    pos.left >= VIEWPORT_PADDING &&
    pos.top + content.height <= vh - VIEWPORT_PADDING &&
    pos.left + content.width <= vw - VIEWPORT_PADDING
  );
}

function getFallbackOrder(preferred: PopoverPlacement, axisLock: boolean): PopoverPlacement[] {
  const { side, align } = parsePlacement(preferred);

  const oppositeSide: Record<PopoverSide, PopoverSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };

  const crossAxis: Record<PopoverSide, [PopoverSide, PopoverSide]> = {
    top: ['left', 'right'],
    bottom: ['left', 'right'],
    left: ['top', 'bottom'],
    right: ['top', 'bottom'],
  };

  if (axisLock) {
    return [
      preferred,
      buildPlacement(oppositeSide[side], align),
    ];
  }

  return [
    preferred,
    buildPlacement(oppositeSide[side], align),
    buildPlacement(crossAxis[side][0], 'center'),
    buildPlacement(crossAxis[side][1], 'center'),
  ];
}
