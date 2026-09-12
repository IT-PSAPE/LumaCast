import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { WorkbenchScreenRouter } from '../../../app/renderer/workbench-screen-router';

// Covers the router composition refactor: each workbench mode maps to exactly
// one screen. Show stays eagerly mounted; every editor/settings screen mounts
// lazily under Suspense.

const mocks = vi.hoisted(() => ({
  workbenchMode: 'show' as string,
}));

vi.mock('../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ state: { workbenchMode: mocks.workbenchMode } }),
}));

vi.mock('../../../app/renderer/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: () => {},
}));

vi.mock('../../../app/renderer/screens/show/page', () => ({
  ShowScreen: () => <div data-testid="screen-show" />,
}));

vi.mock('../../../app/renderer/screens/item-editor/page', () => ({
  ItemEditorScreen: () => <div data-testid="screen-item-editor" />,
}));

vi.mock('../../../app/renderer/screens/overlay-editor/page', () => ({
  OverlayEditorScreen: () => <div data-testid="screen-overlay-editor" />,
}));

vi.mock('../../../app/renderer/screens/theme-editor/page', () => ({
  ThemeEditorScreen: () => <div data-testid="screen-theme-editor" />,
}));

vi.mock('../../../app/renderer/screens/stage-editor/page', () => ({
  StageEditorScreen: () => <div data-testid="screen-stage-editor" />,
}));

vi.mock('../../../app/renderer/screens/macro-editor/page', () => ({
  MacroEditorScreen: () => <div data-testid="screen-macro-editor" />,
}));

vi.mock('../../../app/renderer/screens/settings/page', () => ({
  SettingsScreen: () => <div data-testid="screen-settings" />,
}));

const EDITOR_MODES = ['item-editor', 'overlay-editor', 'theme-editor', 'stage-editor', 'macro-editor', 'settings'] as const;

afterEach(() => {
  cleanup();
  mocks.workbenchMode = 'show';
});

describe('WorkbenchScreenRouter', () => {
  it('renders ShowScreen eagerly and no editor screen for show mode', () => {
    const { getByTestId, queryByTestId } = render(<WorkbenchScreenRouter />);
    expect(getByTestId('screen-show')).not.toBeNull();
    expect(queryByTestId('screen-item-editor')).toBeNull();
    expect(queryByTestId('screen-settings')).toBeNull();
  });

  it.each(EDITOR_MODES)('renders exactly the %s screen lazily under Suspense', async (mode) => {
    mocks.workbenchMode = mode;
    const { queryByTestId } = render(<WorkbenchScreenRouter />);

    await waitFor(() => expect(queryByTestId(`screen-${mode}`)).not.toBeNull());
    expect(queryByTestId('screen-show')).toBeNull();
    for (const other of EDITOR_MODES) {
      if (other !== mode) expect(queryByTestId(`screen-${other}`)).toBeNull();
    }
  });
});