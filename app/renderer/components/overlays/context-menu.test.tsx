import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './context-menu';

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    overlayStack: {
      rootElement: null,
      stack: [],
      baseZIndex: 1,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  }),
}));

vi.mock('./overlay-primitives', () => ({
  OverlayPortal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <>{children}</> : null),
}));

describe('ContextMenu submenu interactions', () => {
  it('allows submenu item clicks to fire onSelect handlers', () => {
    const onMove = vi.fn();

    render(
      <ContextMenu.Root open position={{ x: 40, y: 40 }}>
        <ContextMenu.Portal>
          <ContextMenu.Menu>
            <ContextMenu.Submenu label="Move to collection">
              <ContextMenu.Item onSelect={onMove}>Target collection</ContextMenu.Item>
            </ContextMenu.Submenu>
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Move to collection' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Target collection' }));

    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
