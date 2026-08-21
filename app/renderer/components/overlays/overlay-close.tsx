import { type HTMLAttributes, type MouseEvent } from 'react';

type OverlayCloseProps = HTMLAttributes<HTMLSpanElement> & {
  onClose: () => void;
};

export function OverlayClose({ children, onClick, onClose, ...props }: OverlayCloseProps) {
  function handleClick(event: MouseEvent<HTMLSpanElement>) {
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    onClose();
  }

  return (
    <span onClick={handleClick} {...props} role="button">
      {children}
    </span>
  );
}
