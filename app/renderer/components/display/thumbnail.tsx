import { Children, isValidElement, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

const thumbnailStyles = cv({
  base: 'group relative w-full min-w-0 overflow-hidden rounded-xs border bg-primary text-left transition-colors',
  variants: {
    selected: {
      true: ['border-brand-400/70 bg-brand-400/15'],
      false: ['border-primary hover:border-secondary'],
    },
    variant: {
      slide: ['ring-1 ring-transparent transition-[color,background-color,border-color,box-shadow]'],
      default: [],
    },
  },
  compoundVariants: [
    {
      variant: 'slide',
      selected: true,
      className: ['border-transparent bg-primary ring-2 ring-brand-400'],
    },
    {
      variant: 'slide',
      selected: false,
      className: ['border-secondary hover:ring-border-secondary'],
    },
  ],
  defaultVariants: {
    selected: false,
    variant: 'default',
  },
});

type ThumbnailOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'cover';

interface ThumbnailRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onDoubleClick'> {
  children: ReactNode;
  onDoubleClick?: () => void;
  selected?: boolean;
  variant?: 'default' | 'slide';
  aspectRatio?: number;
  ref?: Ref<HTMLDivElement>;
}

interface ThumbnailSlotProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

interface ThumbnailOverlayProps extends ThumbnailSlotProps {
  position?: ThumbnailOverlayPosition;
}

interface ThumbnailSlots {
  body: ReactElement<ThumbnailSlotProps> | null;
  caption: ReactElement<ThumbnailSlotProps> | null;
  overlays: ReactElement<ThumbnailOverlayProps>[];
  preview: ReactElement<ThumbnailSlotProps> | null;
}

function Preview(_props: ThumbnailSlotProps) {
  return null;
}

function Body(_props: ThumbnailSlotProps) {
  return null;
}

function Caption(_props: ThumbnailSlotProps) {
  return null;
}

function Overlay(_props: ThumbnailOverlayProps) {
  return null;
}

function Row({ children, className, onClick, onDoubleClick, selected = false, variant = 'default', ref, ...rest }: ThumbnailRootProps) {
  const slots = collectThumbnailSlots(children);

  return (
    <div
      ref={ref}
      {...rest}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(thumbnailStyles({ selected, variant }), 'flex', className)}
    >
      <div className={cn('relative min-w-0 max-w-3xs flex-1 overflow-hidden border-r border-primary bg-tertiary', slots.preview?.props.className)}>
        {slots.preview?.props.children ?? null}
      </div>
      <div className={cn('grid min-h-[84px] min-w-0 content-center gap-1 px-2.5 py-2', slots.body?.props.className)}>
        {slots.body?.props.children ?? null}
      </div>
      {slots.overlays.map(renderOverlay)}
    </div>
  );
}

function Tile({ children, className, onClick, onDoubleClick, selected = false, variant = 'default', aspectRatio, ref, style, ...rest }: ThumbnailRootProps) {
  const slots = collectThumbnailSlots(children);
  const bodyStyle = aspectRatio
    ? { ...style, '--thumbnail-aspect-ratio': String(aspectRatio) } as CSSProperties
    : style;

  return (
    <div
      ref={ref}
      {...rest}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(thumbnailStyles({ selected, variant }), className)}
    >
      <div
        className={cn(
          'relative min-w-0 overflow-hidden bg-primary',
          aspectRatio ? '[aspect-ratio:var(--thumbnail-aspect-ratio)]' : 'aspect-video',
          slots.body?.props.className,
        )}
        style={bodyStyle}
      >
        {slots.body?.props.children ?? null}
      </div>
      {slots.overlays.map(renderOverlay)}
      {slots.caption ? (
        <div className={cn('min-w-0 truncate border-t border-primary bg-tertiary px-2 py-1 text-sm text-secondary transition-colors group-hover:text-primary', slots.caption.props.className)}>
          {slots.caption.props.children}
        </div>
      ) : null}
    </div>
  );
}

function collectThumbnailSlots(children: ReactNode): ThumbnailSlots {
  const slots: ThumbnailSlots = { body: null, caption: null, overlays: [], preview: null };

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Preview) {
      slots.preview = child as ReactElement<ThumbnailSlotProps>;
      return;
    }
    if (child.type === Body) {
      slots.body = child as ReactElement<ThumbnailSlotProps>;
      return;
    }
    if (child.type === Caption) {
      slots.caption = child as ReactElement<ThumbnailSlotProps>;
      return;
    }
    if (child.type === Overlay) {
      slots.overlays.push(child as ReactElement<ThumbnailOverlayProps>);
    }
  });

  return slots;
}

function renderOverlay(overlay: ReactElement<ThumbnailOverlayProps>) {
  const position = overlay.props.position ?? 'top-right';
  const positionClassName = getOverlayPositionClassName(position);
  const overlayKey = overlay.key ?? `${position}:${overlay.props.className ?? ''}:${getOverlayChildKey(overlay.props.children)}`;

  return (
    <div
      key={overlayKey}
      className={cn('absolute z-10', positionClassName, overlay.props.className)}
    >
      {overlay.props.children}
    </div>
  );
}

function getOverlayChildKey(children: ReactNode): string {
  if (!isValidElement(children)) return typeof children === 'string' ? children : 'overlay';
  const childType = typeof children.type === 'string'
    ? children.type
    : ('displayName' in children.type && typeof children.type.displayName === 'string')
      ? children.type.displayName
      : ('name' in children.type && typeof children.type.name === 'string')
        ? children.type.name
        : 'component';
  return `${childType}:${children.key ?? ''}`;
}

function getOverlayPositionClassName(position: ThumbnailOverlayPosition): string {
  if (position === 'top-left') return 'left-1 top-1';
  if (position === 'bottom-left') return 'bottom-1 left-1';
  if (position === 'bottom-right') return 'bottom-1 right-1';
  if (position === 'cover') return 'inset-0';
  return 'right-1 top-1';
}

export const Thumbnail = { Row, Tile, Preview, Body, Caption, Overlay };
