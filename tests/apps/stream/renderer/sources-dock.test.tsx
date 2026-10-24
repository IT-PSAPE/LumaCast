import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SourcesDock, type SourcesDockProps } from '../../../../apps/stream/renderer/docks/sources-dock';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

// The real SourceProperties panel needs ~20 required props unrelated to this
// dock's own behavior (project, runtimes, media elements, ...). Stand in with
// a trivial marker so `selectedSource` can be non-null in these tests without
// constructing all of that, matching how other heavy child docks are stubbed
// elsewhere in this suite.
vi.mock('../../../../apps/stream/renderer/docks/source-properties', () => ({
  SourceProperties: ({ source }: { source: StreamSource }) => <div data-testid="source-properties-panel">{source.name}</div>,
}));

afterEach(cleanup);

// Base UI settles the popup's position/focus on an animation frame (mirrors
// tests/packages/ui/src/menu-entries.test.tsx and scenes-dock.test.tsx).
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function makeSource(id: string, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'display',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function renderDock(overrides: Partial<SourcesDockProps> = {}) {
  const sources = overrides.sources ?? [makeSource('src-1', { name: 'Display Capture' }), makeSource('src-2', { name: 'Webcam', kind: 'camera' })];
  const onSelectSourceRow = overrides.onSelectSourceRow ?? vi.fn();
  const onToggleSourceLock = overrides.onToggleSourceLock ?? vi.fn();
  const onMoveSource = overrides.onMoveSource ?? vi.fn();
  const onUpdateSource = overrides.onUpdateSource ?? vi.fn();
  const sourceActions: SourcesDockProps['sourceActions'] = {
    sourceClipboardAvailable: false,
    working: false,
    canGroupSelectedSources: false,
    onCopySource: vi.fn(),
    onPasteSource: vi.fn(),
    onGroupSources: vi.fn(),
    onUngroupSource: vi.fn(),
    onFitSource: vi.fn(),
    onCenterSource: vi.fn(),
    onStretchSource: vi.fn(),
    onResetTransform: vi.fn(),
    onRemoveSelectedSource: vi.fn(),
    ...overrides.sourceActions,
  };
  const addSourceMenu: SourcesDockProps['addSourceMenu'] = {
    desktopAudioMode: 'unavailable',
    applicationAudioSupported: false,
    onOpenCapturePicker: vi.fn(),
    onAddSystemAudioCapture: vi.fn(),
    onOpenApplicationAudioPicker: vi.fn(),
    onAddCamera: vi.fn(),
    onAddMicrophone: vi.fn(),
    onAddMedia: vi.fn(),
    onAddSlideshow: vi.fn(),
    onOpenBrowserDialog: vi.fn(),
    onAddText: vi.fn(),
    onAddColor: vi.fn(),
    referenceableScenes: [],
    onAddSceneReference: vi.fn(),
    ...overrides.addSourceMenu,
  };
  const props: SourcesDockProps = {
    onHide: vi.fn(),
    sources,
    selectedSource: null,
    selectedSourceIds: [],
    collapsedGroupIds: [],
    setCollapsedGroupIds: vi.fn(),
    meterLevels: {},
    onSelectSourceRow,
    onToggleSourceLock,
    onMoveSource,
    onUpdateSource,
    sourceMenuTriggerRef: { current: null },
    sourceMenuOpen: false,
    setSourceMenuOpen: vi.fn(),
    sourceActionsTriggerRef: { current: null },
    sourceActionsMenuOpen: false,
    setSourceActionsMenuOpen: vi.fn(),
    sourceActions,
    addSourceMenu,
    // `SourceProperties` is mocked above, so this stub is never actually read
    // even in tests where `selectedSource` is non-null.
    properties: {} as unknown as SourcesDockProps['properties'],
    ...overrides,
  };
  const view = render(<SourcesDock {...props} />);
  const rerender = (nextOverrides: Partial<SourcesDockProps> = {}) => view.rerender(<SourcesDock {...{ ...props, ...nextOverrides }} />);
  return { ...props, onSelectSourceRow, onToggleSourceLock, onMoveSource, onUpdateSource, sourceActions, addSourceMenu, rerender };
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('.source-row') as HTMLElement;
}

/** Stubs a row's layout geometry for the drag position math (jsdom reports all-zero rects otherwise). */
function mockRowRect(row: HTMLElement, top: number, height = 30) {
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() { return {}; },
  } as DOMRect);
}

describe('SourcesDock', () => {
  it('right-click opens the menu and selects the row', async () => {
    const { onSelectSourceRow } = renderDock();
    fireEvent.contextMenu(rowFor('Webcam'), { clientX: 20, clientY: 30 });
    await settle();

    expect(onSelectSourceRow).toHaveBeenCalledWith(expect.anything(), 'src-2');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
  });

  it('does not re-select a row that is already part of a multi-selection', async () => {
    const { onSelectSourceRow } = renderDock({ selectedSourceIds: ['src-1', 'src-2'] });
    fireEvent.contextMenu(rowFor('Webcam'), { clientX: 20, clientY: 30 });
    await settle();

    expect(onSelectSourceRow).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Remove calls the remove handler', async () => {
    const { sourceActions } = renderDock();
    fireEvent.contextMenu(rowFor('Webcam'), { clientX: 20, clientY: 30 });
    await settle();

    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }));
    await settle();

    expect(sourceActions.onRemoveSelectedSource).toHaveBeenCalledTimes(1);
  });

  it('Lock toggles via onToggleSourceLock', async () => {
    const { onToggleSourceLock } = renderDock();
    fireEvent.contextMenu(rowFor('Webcam'), { clientX: 20, clientY: 30 });
    await settle();

    // Pre-existing bug fixed in passing: the "Lock" entry has a `checked` state,
    // so it renders role="menuitemcheckbox", not "menuitem" — the old
    // `.closest('[role="menuitem"]')` selector never matched anything.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Lock' }));
    await settle();

    expect(onToggleSourceLock).toHaveBeenCalledWith('src-2');
  });

  it('F2 then Enter renames through onUpdateSource', () => {
    const { onUpdateSource } = renderDock();
    fireEvent.keyDown(rowFor('Webcam'), { key: 'F2' });

    const input = screen.getByDisplayValue('Webcam');
    fireEvent.change(input, { target: { value: 'Front Camera' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateSource).toHaveBeenCalledWith('src-2', expect.any(Function));
    const updater = vi.mocked(onUpdateSource).mock.calls[0]![1];
    expect(updater(makeSource('src-2', { name: 'Webcam' })).name).toBe('Front Camera');
    expect(screen.queryByDisplayValue('Front Camera')).toBeNull();
  });

  it('Escape cancels an inline rename without committing', () => {
    const { onUpdateSource } = renderDock();
    fireEvent.keyDown(rowFor('Webcam'), { key: 'F2' });

    const input = screen.getByDisplayValue('Webcam');
    fireEvent.change(input, { target: { value: 'Front Camera' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onUpdateSource).not.toHaveBeenCalled();
    expect(screen.getByText('Webcam')).toBeInTheDocument();
  });

  it('Ctrl+ArrowDown calls moveSource(id, -1): moving down the displayed (reversed) list is a lower index', () => {
    const { onMoveSource } = renderDock();
    fireEvent.keyDown(rowFor('Webcam'), { key: 'ArrowDown', ctrlKey: true });

    expect(onMoveSource).toHaveBeenCalledWith('src-2', -1);
  });

  it('Ctrl+ArrowUp calls moveSource(id, 1): moving up the displayed (reversed) list is a higher index', () => {
    const { onMoveSource } = renderDock();
    fireEvent.keyDown(rowFor('Display Capture'), { key: 'ArrowUp', ctrlKey: true });

    expect(onMoveSource).toHaveBeenCalledWith('src-1', 1);
  });

  it('plain ArrowDown moves focus/selection to the row below', () => {
    const { onSelectSourceRow } = renderDock();
    // Display order reverses the source array, so "Webcam" (src-2) renders above "Display Capture" (src-1).
    fireEvent.keyDown(rowFor('Webcam'), { key: 'ArrowDown' });

    expect(onSelectSourceRow).toHaveBeenCalledWith(expect.anything(), 'src-1');
  });

  it('disables the Transform submenu for a microphone source', async () => {
    renderDock({ sources: [makeSource('mic-1', { name: 'Mic', kind: 'microphone' })] });
    fireEvent.contextMenu(rowFor('Mic'), { clientX: 5, clientY: 5 });
    await settle();

    const transformTrigger = screen.getByText('Transform').closest('[role="menuitem"]') as HTMLElement;
    expect(transformTrigger.getAttribute('data-disabled')).toBe('');
  });

  it('enables the Transform submenu for a transformable source', async () => {
    renderDock();
    fireEvent.contextMenu(rowFor('Webcam'), { clientX: 5, clientY: 5 });
    await settle();

    const transformTrigger = screen.getByText('Transform').closest('[role="menuitem"]') as HTMLElement;
    expect(transformTrigger.getAttribute('data-disabled')).toBeNull();
  });

  it('no longer renders per-row move up/down buttons', () => {
    renderDock();
    expect(screen.queryByRole('button', { name: /Move source up/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move source down/ })).toBeNull();
  });

  describe('properties panel', () => {
    it('selecting a row (selectedSource set) does not open the panel on its own', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();
    });

    it('clicking the dock\'s options button opens the panel for the selected source', () => {
      renderDock({
        selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }),
        selectedSourceIds: ['src-2'],
      });
      fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));

      expect(screen.getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('double-clicking a row opens the panel', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));

      expect(screen.getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('choosing Properties from the row context menu opens the panel and calls onOpenSourceProperties', async () => {
      const onOpenSourceProperties = vi.fn();
      renderDock({
        selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }),
        selectedSourceIds: ['src-2'],
        onOpenSourceProperties,
      });
      fireEvent.contextMenu(rowFor('Webcam'), { clientX: 5, clientY: 5 });
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }));

      expect(onOpenSourceProperties).toHaveBeenCalledWith('src-2');
      expect(screen.getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('choosing Filters from the row context menu opens the panel and calls onOpenSourceFilters', async () => {
      const onOpenSourceFilters = vi.fn();
      renderDock({
        selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }),
        selectedSourceIds: ['src-2'],
        onOpenSourceFilters,
      });
      fireEvent.contextMenu(rowFor('Webcam'), { clientX: 5, clientY: 5 });
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Filters' }));

      expect(onOpenSourceFilters).toHaveBeenCalledWith('src-2');
      expect(screen.getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('closes via the panel\'s close button', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));
      expect(screen.getByTestId('source-properties-panel')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close properties' }));
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();
    });

    it('closes when the selection moves to a different source, and does not reopen on reselecting the original one', () => {
      const webcam = makeSource('src-2', { name: 'Webcam', kind: 'camera' });
      const display = makeSource('src-1', { name: 'Display Capture' });
      const { rerender } = renderDock({ selectedSource: webcam, selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));
      expect(screen.getByTestId('source-properties-panel')).toBeInTheDocument();

      rerender({ selectedSource: display, selectedSourceIds: ['src-1'] });
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();

      rerender({ selectedSource: webcam, selectedSourceIds: ['src-2'] });
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();
    });
  });

  describe('drag reordering', () => {
    it('calls onReorderSources with the new sibling order, in storage order', () => {
      const onReorderSources = vi.fn();
      renderDock({ onReorderSources });
      // Storage order is ['src-1', 'src-2'] (Display Capture, Webcam); display
      // order (top-to-bottom) is the reverse: Webcam above Display Capture.
      const webcamRow = rowFor('Webcam');
      const displayRow = rowFor('Display Capture');
      mockRowRect(webcamRow, 0);
      mockRowRect(displayRow, 30);

      // Drag "Display Capture" from the bottom to above "Webcam" at the top.
      fireEvent.pointerDown(displayRow, { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(displayRow, { clientX: 10, clientY: 5 });
      fireEvent.pointerUp(displayRow, { clientX: 10, clientY: 5 });

      expect(onReorderSources).toHaveBeenCalledWith(null, ['src-2', 'src-1']);
    });

    it('does not reorder when the pointer has not moved past the drag threshold', () => {
      const onReorderSources = vi.fn();
      renderDock({ onReorderSources });
      const webcamRow = rowFor('Webcam');
      const displayRow = rowFor('Display Capture');
      mockRowRect(webcamRow, 0);
      mockRowRect(displayRow, 30);

      fireEvent.pointerDown(displayRow, { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(displayRow, { clientX: 10, clientY: 44 });
      fireEvent.pointerUp(displayRow, { clientX: 10, clientY: 44 });

      expect(onReorderSources).not.toHaveBeenCalled();
    });

    it('falls back to repeated onMoveSource calls when onReorderSources is absent', () => {
      const { onMoveSource } = renderDock();
      const webcamRow = rowFor('Webcam');
      const displayRow = rowFor('Display Capture');
      mockRowRect(webcamRow, 0);
      mockRowRect(displayRow, 30);

      fireEvent.pointerDown(displayRow, { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(displayRow, { clientX: 10, clientY: 5 });
      fireEvent.pointerUp(displayRow, { clientX: 10, clientY: 5 });

      // src-1 moves from storage index 0 to index 1 — a single step forward.
      expect(onMoveSource).toHaveBeenCalledWith('src-1', 1);
      expect(onMoveSource).toHaveBeenCalledTimes(1);
    });

    it('Escape cancels an in-progress drag without reordering', () => {
      const onReorderSources = vi.fn();
      const { onMoveSource } = renderDock({ onReorderSources });
      const webcamRow = rowFor('Webcam');
      const displayRow = rowFor('Display Capture');
      mockRowRect(webcamRow, 0);
      mockRowRect(displayRow, 30);

      fireEvent.pointerDown(displayRow, { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(displayRow, { clientX: 10, clientY: 5 });
      fireEvent.keyDown(displayRow, { key: 'Escape' });
      fireEvent.pointerUp(displayRow, { clientX: 10, clientY: 5 });

      expect(onReorderSources).not.toHaveBeenCalled();
      expect(onMoveSource).not.toHaveBeenCalled();
    });

    it('reorders within a group\'s own children, passing the group id as parentId', async () => {
      const group = makeSource('group-1', {
        name: 'Group',
        kind: 'group',
        children: [makeSource('child-1', { name: 'Child One' }), makeSource('child-2', { name: 'Child Two' })],
      });
      const onReorderSources = vi.fn();
      renderDock({ sources: [group], onReorderSources, collapsedGroupIds: [] });

      // Group children render the same back-to-front/reversed-display convention
      // as the root list: "Child Two" (front) above "Child One" (back).
      const childTwoRow = rowFor('Child Two');
      const childOneRow = rowFor('Child One');
      mockRowRect(childTwoRow, 30);
      mockRowRect(childOneRow, 60);

      fireEvent.pointerDown(childOneRow, { clientX: 10, clientY: 75 });
      fireEvent.pointerMove(childOneRow, { clientX: 10, clientY: 35 });
      fireEvent.pointerUp(childOneRow, { clientX: 10, clientY: 35 });

      expect(onReorderSources).toHaveBeenCalledWith('group-1', ['child-2', 'child-1']);
    });

    it('shows no indicator and does not reorder when the nearest row belongs to a different parent', () => {
      const group = makeSource('group-1', {
        name: 'Group',
        kind: 'group',
        children: [makeSource('child-1', { name: 'Child One' })],
      });
      const other = makeSource('other-1', { name: 'Other Root' });
      const onReorderSources = vi.fn();
      const { onMoveSource } = renderDock({ sources: [group, other], onReorderSources });

      // Display order (top-to-bottom): "Other Root" (front root sibling), then
      // the group row, then its child "Child One" nested beneath it.
      const otherRow = rowFor('Other Root');
      const groupRow = rowFor('Group');
      const childRow = rowFor('Child One');
      mockRowRect(otherRow, 0);
      mockRowRect(groupRow, 30);
      mockRowRect(childRow, 60);

      // Drag the root-level "Other Root" row down over the group's nested child.
      fireEvent.pointerDown(otherRow, { clientX: 10, clientY: 5 });
      fireEvent.pointerMove(otherRow, { clientX: 10, clientY: 75 });
      fireEvent.pointerUp(otherRow, { clientX: 10, clientY: 75 });

      expect(onReorderSources).not.toHaveBeenCalled();
      expect(onMoveSource).not.toHaveBeenCalled();
      expect(document.querySelector('.drag-over-before, .drag-over-after')).toBeNull();
    });
  });
});
