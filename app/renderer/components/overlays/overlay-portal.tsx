import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useWorkbench } from '@renderer/contexts/workbench-context';

type OverlayPortalProps = {
  children: ReactNode;
  isOpen: boolean;
  zIndex: number;
};

export function OverlayPortal({ children, isOpen, zIndex }: OverlayPortalProps) {
  const { overlayStack } = useWorkbench();

  if (!isOpen || !overlayStack.rootElement) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex }}>
      {children}
    </div>,
    overlayStack.rootElement,
  );
}
