import { type HTMLAttributes, type MouseEvent } from 'react';

type OverlayTriggerProps = HTMLAttributes<HTMLSpanElement> & {
  onOpen: () => void;
};

export function OverlayTrigger({ children, onClick, onOpen, ...props }: OverlayTriggerProps) {
  function handleClick(event: MouseEvent<HTMLSpanElement>) {
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    onOpen();
  }

  return (
    <span onClick={handleClick} {...props} role="button">
      {children}
    </span>
  );
}
