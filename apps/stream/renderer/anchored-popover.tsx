import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPopoverIntrinsicHeight, placePopover, type PopoverAlignment, type PopoverPlacement, type PopoverSide } from './popover-layout';

interface AnchoredPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  className: string;
  side?: PopoverSide;
  alignment?: PopoverAlignment;
  role?: 'menu' | 'region';
  label?: string;
  onClose?: () => void;
  children: ReactNode;
}

function samePlacement(left: PopoverPlacement | null, right: PopoverPlacement): boolean {
  return left !== null && left.top === right.top && left.left === right.left
    && left.maxHeight === right.maxHeight && left.maxWidth === right.maxWidth && left.side === right.side;
}

export function AnchoredPopover({
  open,
  anchor,
  className,
  side = 'bottom',
  alignment = 'start',
  role,
  label,
  onClose,
  children,
}: AnchoredPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);

  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !anchor || !popover) return;

    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      if (anchorRect.bottom < 0 || anchorRect.top > window.innerHeight) {
        onCloseRef.current?.();
        return;
      }
      const popoverRect = popover.getBoundingClientRect();
      const popoverStyle = window.getComputedStyle(popover);
      const borderHeight = Number.parseFloat(popoverStyle.borderTopWidth || '0')
        + Number.parseFloat(popoverStyle.borderBottomWidth || '0');
      const intrinsicHeight = getPopoverIntrinsicHeight(popoverRect.height, popover.scrollHeight, borderHeight);
      const next = placePopover(
        anchorRect,
        popoverRect.width,
        intrinsicHeight,
        window.innerWidth,
        window.innerHeight,
        side,
        alignment,
      );
      setPlacement((current) => samePlacement(current, next) ? current : next);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (popover.contains(target) || anchor.contains(target))) return;
      onCloseRef.current?.();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onCloseRef.current?.();
      anchor.focus();
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(popover);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, anchor, side, alignment]);

  if (!open || !anchor) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={`adaptive-popover ${className}`}
      role={role}
      aria-label={label}
      style={placement
        ? { position: 'fixed', top: placement.top, left: placement.left, maxHeight: placement.maxHeight, maxWidth: placement.maxWidth }
        : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
