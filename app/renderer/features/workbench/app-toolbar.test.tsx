import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { WorkbenchMode } from '../../types/ui';

// Covers the "Application views" switcher narrowing: the workbench shows the
// first three screens (Show / Edit / Themes) as segments and hides the
// remaining three (Overlay / Stage / Macros) behind an icon-only overflow
// trigger that must stay inside the same group, look like a real segment, and
// report its pressed state when the current mode lives behind it.

const mocks = vi.hoisted(() => {
  const workbenchState = { workbenchMode: 'show' as WorkbenchMode };
  return {
    workbenchState,
    workbenchActions: {
      setWorkbenchMode: vi.fn((mode: WorkbenchMode) => { workbenchState.workbenchMode = mode; }),
    },
    overlayStack: {
      rootElement: null as HTMLElement | null,
      stack: [] as string[],
      baseZIndex: 100,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  };
});

vi.mock('../../contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: mocks.workbenchState,
    actions: mocks.workbenchActions,
    overlayStack: mocks.overlayStack,
  }),
}));

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: { outputState: {} },
    actions: { toggleAudienceOutput: vi.fn(), toggleStageOutput: vi.fn() },
  }),
}));

vi.mock('../command-palette/command-palette-context', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));

vi.mock('./use-workbench-panel-toggles', () => ({
  useWorkbenchPanelToggles: () => [],
}));

// app-toolbar reads window.castApi.platform at module load for the search
// shortcut label, so the global must exist before the component module loads.
(window as unknown as { castApi: { platform: string } }).castApi = { platform: 'darwin' };
const { AppToolbar } = await import('./app-toolbar');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workbenchState.workbenchMode = 'show';
});

afterEach(() => {
  cleanup();
});

function applicationViewsGroup() {
  return render(<AppToolbar />).getByRole('group', { name: 'Application views' });
}

describe('AppToolbar "Application views" switcher', () => {
  it('shows only Show, Edit, and Themes as group segments, with the rest behind the overflow trigger', () => {
    const { getByRole } = render(<AppToolbar />);
    const group = within(getByRole('group', { name: 'Application views' }));

    for (const name of ['Show', 'Edit', 'Themes']) {
      expect(group.getByRole('button', { name })).not.toBeNull();
    }
    for (const name of ['Overlay', 'Stage', 'Macros']) {
      expect(group.queryByRole('button', { name })).toBeNull();
    }
    expect(group.getByRole('button', { name: 'More views' })).not.toBeNull();
  });

  it('still switches the workbench mode from the visible segments', () => {
    const { getByRole, rerender } = render(<AppToolbar />);
    const group = within(getByRole('group', { name: 'Application views' }));

    fireEvent.click(group.getByRole('button', { name: 'Edit' }));
    expect(mocks.workbenchActions.setWorkbenchMode).toHaveBeenCalledWith('item-editor');

    rerender(<AppToolbar />);
    const updated = within(getByRole('group', { name: 'Application views' }));
    expect(updated.getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('true');
    expect(updated.getByRole('button', { name: 'More views' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('gives the overflow trigger a menu affordance and an accessible name', () => {
    const group = within(applicationViewsGroup());
    const trigger = group.getByRole('button', { name: 'More views' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the overflow trigger as pressed when the current mode is a hidden screen', () => {
    mocks.workbenchState.workbenchMode = 'stage-editor';
    const group = within(applicationViewsGroup());
    const trigger = group.getByRole('button', { name: 'More views' });
    expect(trigger.getAttribute('aria-pressed')).toBe('true');
    expect(trigger.className).toContain('bg-primary');
  });

  it('lists the hidden screens in the overflow menu and switching from it moves the pressed state to the trigger', () => {
    const { getByRole, rerender } = render(<AppToolbar />);
    const group = within(getByRole('group', { name: 'Application views' }));

    fireEvent.pointerDown(group.getByRole('button', { name: 'More views' }));
    expect(getByRole('menuitem', { name: 'Overlay' })).not.toBeNull();
    expect(getByRole('menuitem', { name: 'Stage' })).not.toBeNull();
    expect(getByRole('menuitem', { name: 'Macros' })).not.toBeNull();

    fireEvent.click(getByRole('menuitem', { name: 'Macros' }));
    expect(mocks.workbenchActions.setWorkbenchMode).toHaveBeenCalledWith('macro-editor');

    rerender(<AppToolbar />);
    const updated = within(getByRole('group', { name: 'Application views' }));
    expect(updated.getByRole('button', { name: 'More views' }).getAttribute('aria-pressed')).toBe('true');
  });
});