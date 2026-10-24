import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from './cn';
import { useOverlayContainer, useOverlayStackEntry } from './overlay';

const DEFAULT_DELAY = 400;
// Once a tooltip has shown, a neighbour within this window opens immediately.
const GROUP_TIMEOUT = 300;
const VIEWPORT_PADDING = 8;

const TooltipDelayContext = createContext<number>(DEFAULT_DELAY);

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** Milliseconds before showing. Defaults to the nearest `TooltipProvider`'s delay, else 400. */
  delay?: number;
  /** Renders `children` untouched. */
  disabled?: boolean;
  className?: string;
  /** The trigger. Cloned with the tooltip's props, never wrapped in an extra box. */
  children: ReactElement;
}

export interface TooltipProviderProps {
  children: ReactNode;
  /** Default delay for all descendant tooltips. */
  delay?: number;
}

// Shares one delay group across descendants: after one tooltip has shown,
// moving to a neighbouring trigger opens it with no delay.
export function TooltipProvider({ children, delay = DEFAULT_DELAY }: TooltipProviderProps): ReactElement {
  return (
    <TooltipDelayContext.Provider value={delay}>
      <BaseTooltip.Provider delay={delay} closeDelay={0} timeout={GROUP_TIMEOUT}>
        {children}
      </BaseTooltip.Provider>
    </TooltipDelayContext.Provider>
  );
}

function isEmptyContent(content: ReactNode): boolean {
  return content === undefined || content === null || content === false || content === '';
}

export function Tooltip({ content, side = 'top', align = 'center', delay, disabled = false, className, children }: TooltipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const providerDelay = useContext(TooltipDelayContext);
  const container = useOverlayContainer();
  // Layers above whatever is open beneath it (a tooltip on a dialog button).
  const { zIndex } = useOverlayStackEntry(open);

  if (disabled || isEmptyContent(content)) return children;

  return (
    <BaseTooltip.Root open={open} onOpenChange={setOpen} disableHoverablePopup>
      {/* `render` merges trigger props and ref into the existing element. */}
      <BaseTooltip.Trigger render={children} delay={delay ?? providerDelay} closeDelay={0} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={6}
          positionMethod="fixed"
          collisionPadding={VIEWPORT_PADDING}
          className="pointer-events-none"
          style={{ zIndex }}
        >
          <BaseTooltip.Popup
            className={cn(
              'pointer-events-none max-w-64 select-none rounded border border-primary bg-primary px-2 py-1 text-xs font-medium text-primary shadow-md outline-hidden',
              'origin-(--transform-origin) transition-opacity duration-100 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none',
              className,
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
