import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AppLayoutContent } from '../../../../apps/cast/renderer/shell/app-layout-content';

const mocks = vi.hoisted(() => ({
  cast: {
    snapshot: null as object | null,
    isLoadingSnapshot: false,
    snapshotLoadError: null as string | null,
    retrySnapshotLoad: vi.fn().mockResolvedValue(undefined),
  },
  useAppMenu: vi.fn(),
  openCommandPalette: vi.fn(),
}));

vi.mock('../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => mocks.cast,
}));

vi.mock('../../../../apps/cast/renderer/application/use-app-menu', () => ({
  useAppMenu: mocks.useAppMenu,
}));

vi.mock('../../../../apps/cast/renderer/contexts/command-palette-context', () => ({
  useCommandPalette: () => ({ open: mocks.openCommandPalette }),
}));

vi.mock('../../../../apps/cast/renderer/features/workbench/app-toolbar', () => ({
  AppToolbar: ({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) => (
    <button data-testid="app-toolbar" type="button" onClick={onOpenCommandPalette} />
  ),
}));

vi.mock('../../../../apps/cast/renderer/shell/status-bar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));

vi.mock('../../../../apps/cast/renderer/workbench-screen-router', () => ({
  WorkbenchScreenRouter: () => <div data-testid="workbench-screen" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cast.snapshot = null;
  mocks.cast.isLoadingSnapshot = false;
  mocks.cast.snapshotLoadError = null;
  mocks.openCommandPalette.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AppLayoutContent startup shell', () => {
  it('renders the shell while the initial snapshot is still loading', () => {
    mocks.cast.isLoadingSnapshot = true;

    const { getByTestId, getByText, queryByTestId } = render(<AppLayoutContent />);

    expect(getByTestId('app-toolbar')).not.toBeNull();
    expect(getByTestId('status-bar')).not.toBeNull();
    expect(getByText('Loading LumaCast App')).not.toBeNull();
    expect(queryByTestId('workbench-screen')).toBeNull();
  });

  it('keeps the shell mounted and swaps the loading placeholder for the workbench once the snapshot arrives', () => {
    mocks.cast.isLoadingSnapshot = true;
    const view = render(<AppLayoutContent />);

    expect(view.getByText('Loading LumaCast App')).not.toBeNull();
    expect(view.queryByTestId('workbench-screen')).toBeNull();

    mocks.cast.isLoadingSnapshot = false;
    mocks.cast.snapshot = { projectId: 'demo-project' };
    view.rerender(<AppLayoutContent />);

    expect(view.getByTestId('app-toolbar')).not.toBeNull();
    expect(view.getByTestId('status-bar')).not.toBeNull();
    expect(view.getByTestId('workbench-screen')).not.toBeNull();
    expect(view.queryByText('Loading LumaCast App')).toBeNull();
  });

  it('keeps the existing retryable startup failure panel inside the shell', () => {
    mocks.cast.snapshotLoadError = 'Database open failed';

    const { getByRole, getByTestId, getByText } = render(<AppLayoutContent />);

    expect(getByTestId('app-toolbar')).not.toBeNull();
    expect(getByTestId('status-bar')).not.toBeNull();
    expect(getByText('LumaCast could not load its project data.')).not.toBeNull();
    expect(getByText('Database open failed')).not.toBeNull();

    fireEvent.click(getByRole('button', { name: 'Retry startup' }));
    expect(mocks.cast.retrySnapshotLoad).toHaveBeenCalledTimes(1);
  });

  it('composes command-palette opening through the toolbar callback', () => {
    const { getByTestId } = render(<AppLayoutContent />);

    fireEvent.click(getByTestId('app-toolbar'));

    expect(mocks.openCommandPalette).toHaveBeenCalledTimes(1);
  });
});
