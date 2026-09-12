import { useEffect, useId } from 'react';
import { useWorkbench } from '@renderer/contexts/workbench-context';

/**
 * The `#overlay-root` layer every overlay portals into. `undefined` lets a Base
 * UI portal fall back to `<body>` rather than rendering nothing.
 */
export function useOverlayContainer(): HTMLElement | undefined {
  const { overlayStack } = useWorkbench();
  return overlayStack.rootElement ?? document.getElementById('overlay-root') ?? undefined;
}

/**
 * Registers an open overlay with the workbench stack and reports where it sits.
 * `zIndex` paints it above whatever opened it; `isTopmost` gates Escape, because
 * separate Base UI roots (a picker and the upload dialog it spawns) are siblings
 * that only the stack can order.
 */
export function useOverlayStackEntry(isOpen: boolean): { isTopmost: boolean; zIndex: number } {
  const { overlayStack } = useWorkbench();
  const { register, unregister } = overlayStack;
  const overlayId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    register(overlayId);
    return () => unregister(overlayId);
  }, [isOpen, overlayId, register, unregister]);

  const index = overlayStack.stack.indexOf(overlayId);
  return {
    isTopmost: index >= 0 && index === overlayStack.stack.length - 1,
    zIndex: overlayStack.baseZIndex + Math.max(index, 0) * 10,
  };
}
