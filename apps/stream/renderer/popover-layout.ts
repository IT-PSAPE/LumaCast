export type PopoverSide = 'top' | 'bottom';
export type PopoverAlignment = 'start' | 'end';

export interface PopoverAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PopoverPlacement {
  top: number;
  left: number;
  side: PopoverSide;
  maxHeight: number;
  maxWidth: number;
}

export function getPopoverIntrinsicHeight(renderedHeight: number, scrollHeight: number, borderHeight = 0): number {
  const rendered = Number.isFinite(renderedHeight) ? renderedHeight : 0;
  const scrollable = Number.isFinite(scrollHeight) ? scrollHeight : 0;
  const border = Number.isFinite(borderHeight) ? Math.max(0, borderHeight) : 0;
  return Math.max(rendered, scrollable + border);
}

export function placePopover(
  anchor: PopoverAnchorRect,
  popoverWidth: number,
  popoverHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  preferredSide: PopoverSide = 'bottom',
  alignment: PopoverAlignment = 'start',
  gap = 6,
  padding = 8,
): PopoverPlacement {
  const maxWidth = Math.max(0, viewportWidth - padding * 2);
  const width = Math.min(popoverWidth, maxWidth);
  const spaceAbove = Math.max(0, anchor.top - gap - padding);
  const spaceBelow = Math.max(0, viewportHeight - padding - anchor.bottom - gap);
  const oppositeSide: PopoverSide = preferredSide === 'bottom' ? 'top' : 'bottom';
  const preferredSpace = preferredSide === 'bottom' ? spaceBelow : spaceAbove;
  const oppositeSpace = oppositeSide === 'bottom' ? spaceBelow : spaceAbove;
  const side = preferredSpace >= popoverHeight || preferredSpace >= oppositeSpace
    ? preferredSide
    : oppositeSide;
  const availableHeight = side === 'bottom' ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(0, Math.min(availableHeight, viewportHeight - padding * 2));
  const height = Math.min(popoverHeight, maxHeight);
  const unclampedLeft = alignment === 'end' ? anchor.right - width : anchor.left;
  const left = Math.min(Math.max(padding, unclampedLeft), Math.max(padding, viewportWidth - padding - width));
  const unclampedTop = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - height;
  const top = Math.min(Math.max(padding, unclampedTop), Math.max(padding, viewportHeight - padding - height));

  return { top, left, side, maxHeight, maxWidth };
}
