import { useRef } from 'react';

export function usePointerCapture(resolve: (event: PointerEvent | React.PointerEvent) => void) {
  const ref = useRef<HTMLDivElement>(null);

  function handlePointerDown(event: React.PointerEvent) {
    event.preventDefault();
    ref.current!.setPointerCapture(event.pointerId);
    resolve(event);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!ref.current!.hasPointerCapture(event.pointerId)) return;
    resolve(event);
  }

  function handlePointerUp(event: React.PointerEvent) {
    ref.current!.releasePointerCapture(event.pointerId);
  }

  return { ref, handlePointerDown, handlePointerMove, handlePointerUp };
}
