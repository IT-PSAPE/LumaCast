import { cn } from '@renderer/utils/cn';
import { type HTMLAttributes, type MouseEvent } from 'react';

type OverlayBackdropProps = HTMLAttributes<HTMLDivElement> & {
  closeOnClick?: boolean;
  onClose: () => void;
};

export function OverlayBackdrop({ className, closeOnClick = true, onClick, onClose, ...props }: OverlayBackdropProps) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    onClick?.(event);

    if (event.defaultPrevented || !closeOnClick) {
      return;
    }

    onClose();
  }

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-auto fixed inset-0 bg-black/50 backdrop-blur-sm', className)}
      onClick={handleClick}
      {...props}
    />
  );
}
