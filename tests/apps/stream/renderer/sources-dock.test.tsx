import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Modal, OverlayStackProvider } from '@lumacast/ui';
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
afterEach(() => vi.unstubAllGlobals());

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

function makeDockProps(overrides: Partial<SourcesDockProps> = {}): SourcesDockProps {
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
    onAddPresentation: vi.fn(),
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
  return props;
}

function InteractiveMenus(props: SourcesDockProps) {
  const [addOpen, setAddOpen] = useState(props.sourceMenuOpen);
  const [actionsOpen, setActionsOpen] = useState(props.sourceActionsMenuOpen);
  return <SourcesDock {...props}
    sourceMenuOpen={addOpen} setSourceMenuOpen={(next) => { props.setSourceMenuOpen(next); setAddOpen(next); }}
    sourceActionsMenuOpen={actionsOpen} setSourceActionsMenuOpen={(next) => { props.setSourceActionsMenuOpen(next); setActionsOpen(next); }}
  />;
}

function renderDock(overrides: Partial<SourcesDockProps> = {}, interactiveMenus = false) {
  const props = makeDockProps(overrides);
  const component = (next: SourcesDockProps) => interactiveMenus ? <OverlayStackProvider><InteractiveMenus {...next} /></OverlayStackProvider> : <SourcesDock {...next} />;
  const view = render(component(props));
  const rerender = (nextOverrides: Partial<SourcesDockProps> = {}) => view.rerender(component({ ...props, ...nextOverrides }));
  return { ...props, rerender };
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
  it('places status, visibility and lock after the source name, with lock furthest right', () => {
    renderDock({ sourceStatuses: { 'src-2': { state: 'unavailable' } } });
    const row = rowFor('Webcam');
    const name = within(row).getByText('Webcam');
    const status = within(row).getByRole('img');
    const visible = within(row).getByRole('button', { name: 'Visible Webcam' });
    const lock = within(row).getByRole('button', { name: 'Lock Webcam' });
    expect(name.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.compareDocumentPosition(visible) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visible.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lock.parentElement?.lastElementChild).toBe(lock);
  });

  it('exposes multi-selection and hierarchy through tree accessibility state', () => {
    const group = makeSource('group-1', {
      name: 'Group',
      kind: 'group',
      children: [makeSource('child-1', { name: 'Child' })],
    });
    renderDock({ sources: [group], selectedSourceIds: ['child-1'] });

    expect(screen.getByRole('tree', { name: 'Sources' })).toHaveAttribute('aria-multiselectable', 'true');
    expect(rowFor('Group')).toHaveAttribute('role', 'treeitem');
    expect(rowFor('Group')).toHaveAttribute('aria-level', '1');
    expect(rowFor('Group')).toHaveAttribute('aria-expanded', 'true');
    expect(rowFor('Child')).toHaveAttribute('role', 'treeitem');
    expect(rowFor('Child')).toHaveAttribute('aria-level', '2');
    expect(rowFor('Child')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows icon-only unavailable status with a tooltip and accessible description, including audio', () => {
    const microphone = makeSource('mic-1', { name: 'Room mic', kind: 'microphone' });
    renderDock({
      sources: [microphone],
      sourceStatuses: { 'mic-1': { state: 'unavailable', message: 'Device disconnected' } },
    });

    const status = rowFor('Room mic').querySelector('.source-availability');
    expect(status?.textContent).toBe('');
    expect(screen.getByRole('img', { name: 'Room mic: Unavailable — Device disconnected' })).toBe(status);
    expect(status).toHaveAttribute('title', 'Room mic: Unavailable — Device disconnected');
    expect(status?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(rowFor('Room mic')).toHaveAttribute('aria-description', 'Room mic: Unavailable — Device disconnected');
  });

  it('reserves status icons for warnings and errors while retaining accessible startup status', () => {
    renderDock({
      sourceStatuses: {
        'src-1': { state: 'starting' },
        'src-2': { state: 'ready' },
      },
    });

    expect(rowFor('Display Capture').querySelector('.source-availability')).toBeNull();
    expect(rowFor('Display Capture')).toHaveAttribute('aria-description', 'Display Capture: Starting');
    expect(rowFor('Webcam').querySelector('.source-availability')).toBeNull();
  });

  it('shows a compact warning icon for partial capture failures', () => {
    renderDock({ sourceStatuses: { 'src-2': { state: 'warning', message: 'Video is live; audio could not start.' } } });
    const warning = screen.getByRole('img', { name: 'Webcam: Warning — Video is live; audio could not start.' });
    expect(warning.textContent).toBe('');
    expect(warning.querySelector('svg')).toHaveClass('lucide-triangle-alert');
    expect(warning).toHaveAttribute('title', 'Webcam: Warning — Video is live; audio could not start.');
  });

  it('updates the status icon and description as a source recovers', () => {
    const { rerender } = renderDock({
      sourceStatuses: { 'src-1': { state: 'unavailable', message: 'Display disconnected' } },
    });
    expect(screen.getByRole('img', { name: 'Display Capture: Unavailable — Display disconnected' }).querySelector('svg')).toHaveClass('lucide-circle-alert');

    rerender({ sourceStatuses: { 'src-1': { state: 'starting' } } });
    expect(rowFor('Display Capture').querySelector('.source-availability')).toBeNull();
    expect(rowFor('Display Capture')).toHaveAttribute('aria-description', 'Display Capture: Starting');
    expect(screen.queryByTitle(/Display disconnected/)).toBeNull();

    rerender({ sourceStatuses: { 'src-1': { state: 'ready' } } });
    expect(rowFor('Display Capture').querySelector('.source-availability')).toBeNull();
    expect(rowFor('Display Capture')).not.toHaveAttribute('aria-description');
  });

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

  it('passes the clicked selected row to its context Copy and Ungroup actions', async () => {
    const groupA = makeSource('group-a', { name: 'Group A', kind: 'group', children: [makeSource('child-a')] });
    const groupB = makeSource('group-b', { name: 'Group B', kind: 'group', children: [makeSource('child-b')] });
    const onCopySource = vi.fn();
    const onUngroupSource = vi.fn();
    renderDock({
      sources: [groupA, groupB],
      selectedSource: groupA,
      selectedSourceIds: ['group-a', 'group-b'],
      sourceActions: {
        sourceClipboardAvailable: false,
        working: false,
        canGroupSelectedSources: false,
        onCopySource,
        onPasteSource: vi.fn(),
        onGroupSources: vi.fn(),
        onUngroupSource,
        onFitSource: vi.fn(),
        onCenterSource: vi.fn(),
        onStretchSource: vi.fn(),
        onResetTransform: vi.fn(),
        onRemoveSelectedSource: vi.fn(),
      },
    });

    fireEvent.contextMenu(rowFor('Group B'), { clientX: 20, clientY: 30 });
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy/ }));
    await settle();

    expect(onCopySource).toHaveBeenCalledWith('group-b');

    fireEvent.contextMenu(rowFor('Group B'), { clientX: 20, clientY: 30 });
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ungroup' }));
    await settle();

    expect(onUngroupSource).toHaveBeenCalledWith('group-b');
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

  it('Ctrl+Arrow moves selected siblings together', () => {
    const onReorderSources = vi.fn();
    renderDock({
      sources: [makeSource('src-1'), makeSource('src-2'), makeSource('src-3')],
      selectedSourceIds: ['src-1', 'src-2'],
      onReorderSources,
    });
    fireEvent.keyDown(rowFor('src-1'), { key: 'ArrowUp', ctrlKey: true });

    expect(onReorderSources).toHaveBeenCalledWith(null, ['src-3', 'src-1', 'src-2']);
  });

  it('plain ArrowDown moves focus/selection to the row below', () => {
    const { onSelectSourceRow } = renderDock();
    // Display order reverses the source array, so "Webcam" (src-2) renders above "Display Capture" (src-1).
    fireEvent.keyDown(rowFor('Webcam'), { key: 'ArrowDown' });

    expect(onSelectSourceRow).toHaveBeenCalledWith(expect.anything(), 'src-1');
  });

  it('Shift+Arrow extends selection without activating source properties', () => {
    const { onSelectSourceRow, onOpenSourceProperties } = renderDock({ onOpenSourceProperties: vi.fn() });
    fireEvent.keyDown(rowFor('Webcam'), { key: 'ArrowDown', shiftKey: true });
    fireEvent.doubleClick(rowFor('Webcam'), { shiftKey: true });

    expect(onSelectSourceRow).toHaveBeenCalledWith(expect.objectContaining({ shiftKey: true }), 'src-1');
    expect(onOpenSourceProperties).not.toHaveBeenCalled();
  });

  it('Ctrl+A selects all visible source rows and Escape clears the selection', () => {
    const onSelectAllSources = vi.fn();
    const onClearSourceSelection = vi.fn();
    renderDock({ selectedSourceIds: ['src-1'], onSelectAllSources, onClearSourceSelection });

    fireEvent.keyDown(rowFor('Webcam'), { key: 'a', ctrlKey: true });
    fireEvent.keyDown(rowFor('Webcam'), { key: 'Escape' });

    expect(onSelectAllSources).toHaveBeenCalledTimes(1);
    expect(onClearSourceSelection).toHaveBeenCalledTimes(1);
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

  describe('header menus', () => {
    it.each([
      ['Add source', 'Add source', 'Display Capture', 'Color Source', 'Text'],
      ['More source actions', 'Source actions', 'Properties', 'Hide Sources', 'Copy Source'],
    ])('opens %s from the keyboard and navigates its enabled commands', async (triggerName, menuName, first, last, typed) => {
      const dock = renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }) }, true);
      const trigger = screen.getByRole('button', { name: triggerName });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await settle();
      const menu = screen.getByRole('menu', { name: menuName });
      expect(within(menu).getByRole('menuitem', { name: first })).toHaveFocus();
      expect(triggerName === 'Add source' ? dock.sourceMenuTriggerRef.current : dock.sourceActionsTriggerRef.current).toBe(trigger);
      fireEvent.keyDown(document.activeElement!, { key: 'End' });
      await settle();
      expect(within(menu).getByRole('menuitem', { name: last })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      await settle();
      expect(within(menu).getByRole('menuitem', { name: first })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: typed[0].toLowerCase() });
      await settle();
      expect(within(menu).getByRole('menuitem', { name: typed })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await settle();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it('updates selected-source, clipboard and working eligibility while open', async () => {
      const locked = makeSource('src-2', { name: 'Webcam', kind: 'camera', locked: true });
      const dock = renderDock({ selectedSource: locked }, true);
      fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));
      await settle();
      const fit = () => screen.getByRole('menuitem', { name: 'Fit to Canvas' });
      const paste = () => screen.getByRole('menuitem', { name: 'Paste Source' });
      expect(fit()).toHaveAttribute('aria-disabled', 'true');
      expect(paste()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(fit());
      expect(dock.sourceActions.onFitSource).not.toHaveBeenCalled();
      expect(screen.getByRole('menu', { name: 'Source actions' })).toBeInTheDocument();
      dock.rerender({ selectedSource: { ...locked, locked: false }, sourceActions: { ...dock.sourceActions, sourceClipboardAvailable: true, working: true } });
      expect(fit()).not.toHaveAttribute('aria-disabled', 'true');
      expect(paste()).toHaveAttribute('aria-disabled', 'true');
      dock.rerender({ selectedSource: null, sourceActions: { ...dock.sourceActions, sourceClipboardAvailable: true, working: false } });
      expect(screen.getByRole('menuitem', { name: 'Properties' })).toHaveAttribute('aria-disabled', 'true');
      expect(fit()).toHaveAttribute('aria-disabled', 'true');
      expect(paste()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('preserves conditional add categories and routes audio and scene commands once', async () => {
      const base = makeDockProps();
      const scene = { id: 'other-scene', name: 'Other scene', sources: [] };
      const addSourceMenu = { ...base.addSourceMenu, desktopAudioMode: 'system-tap' as const, applicationAudioSupported: true, onAddNdi: vi.fn(), referenceableScenes: [scene] };
      const dock = renderDock({ addSourceMenu }, true);
      const trigger = screen.getByRole('button', { name: 'Add source' });
      fireEvent.click(trigger);
      await settle();
      const menu = screen.getByRole('menu', { name: 'Add source' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Display Capture', 'Window Capture', 'Audio Output Capture', 'Application Audio Capture', 'Video Capture Device', 'Audio Input Capture', 'NDI Source',
        'Image', 'Image Slideshow', 'Presentation', 'Media Source', 'Audio File', 'Browser Source', 'Text', 'Color Source', 'Other scene',
      ]);
      for (const category of ['Capture', 'Media', 'Graphics', 'Composition']) {
        expect(within(menu).getByText(category)).not.toHaveAttribute('role', 'menuitem');
      }
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Audio Output Capture' }));
      await settle();
      expect(addSourceMenu.onAddSystemAudioCapture).toHaveBeenCalledOnce();
      expect(addSourceMenu.onOpenCapturePicker).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();
      dock.rerender({ addSourceMenu: { ...addSourceMenu, desktopAudioMode: 'display-loopback' } });
      fireEvent.click(trigger);
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Audio Output Capture' }));
      await settle();
      expect(addSourceMenu.onOpenCapturePicker).toHaveBeenCalledExactlyOnceWith('audio');
      fireEvent.click(trigger);
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Other scene' }));
      await settle();
      expect(addSourceMenu.onAddSceneReference).toHaveBeenCalledExactlyOnceWith(scene);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps only the active header menu open and dismisses outside', async () => {
      renderDock({}, true);
      fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
      await settle();
      expect(screen.getByRole('menu', { name: 'Add source' })).toBeInTheDocument();
      const nextTrigger = screen.getByRole('button', { name: 'More source actions' });
      fireEvent.pointerDown(nextTrigger, { pointerType: 'mouse', button: 0 });
      fireEvent.mouseDown(nextTrigger, { button: 0 });
      nextTrigger.focus();
      fireEvent.pointerUp(nextTrigger, { pointerType: 'mouse', button: 0 });
      fireEvent.mouseUp(nextTrigger, { button: 0 });
      fireEvent.click(nextTrigger);
      await settle();
      expect(screen.queryByRole('menu', { name: 'Add source' })).toBeNull();
      expect(screen.getByRole('menu', { name: 'Source actions' })).toBeInTheDocument();
      fireEvent.pointerDown(document.body, { pointerType: 'mouse', button: 0 });
      await settle();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it.each([
      ['Fit to Canvas', 'onFitSource'],
      ['Center', 'onCenterSource'],
      ['Stretch to Canvas', 'onStretchSource'],
      ['Reset Transform', 'onResetTransform'],
      ['Delete Source', 'onRemoveSelectedSource'],
    ] as const)('activates %s once and dismisses the menu', async (label, action) => {
      const dock = renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }) }, true);
      const trigger = screen.getByRole('button', { name: 'More source actions' });
      fireEvent.click(trigger);
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      await settle();
      expect(dock.sourceActions[action]).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it('dismisses before an asynchronous add completes or reports a handled failure', async () => {
      let reject!: (error: Error) => void;
      const operation = new Promise<void>((_, fail) => { reject = fail; });
      const reportFailure = vi.fn();
      const onAddMedia = vi.fn(() => { void operation.catch(reportFailure); });
      const base = makeDockProps();
      renderDock({ addSourceMenu: { ...base.addSourceMenu, onAddMedia } }, true);
      fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Image' }));
      await settle();
      expect(onAddMedia).toHaveBeenCalledExactlyOnceWith('image');
      expect(screen.queryByRole('menu')).toBeNull();
      reject(new Error('Import cancelled by fixture'));
      await settle();
      expect(reportFailure).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('hands focus to the source properties dialog without returning it to the menu trigger', async () => {
      const onOpenSourceProperties = vi.fn();
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), onOpenSourceProperties }, true);
      fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }));
      await settle();
      const dialog = screen.getByRole('dialog', { name: 'Source Properties' });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(onOpenSourceProperties).toHaveBeenCalledExactlyOnceWith('src-2');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('hands focus to a picker opened by an add command', async () => {
      const base = makeDockProps();
      const onAddCamera = vi.fn();
      function PickerJourney() {
        const [open, setOpen] = useState(false);
        return <>
          <InteractiveMenus {...base} addSourceMenu={{ ...base.addSourceMenu, onAddCamera: () => { onAddCamera(); setOpen(true); } }} />
          <Modal open={open} onClose={() => setOpen(false)} title="Video capture device"><button type="button">Choose camera</button></Modal>
        </>;
      }
      render(<OverlayStackProvider><PickerJourney /></OverlayStackProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
      await settle();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Video Capture Device' }));
      await settle();
      expect(onAddCamera).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Video capture device' })).toContainElement(document.activeElement as HTMLElement);
    });
  });

  describe('properties dialog', () => {
    it('selecting a row (selectedSource set) does not open the dialog on its own', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();
    });

    it('clicking the dock\'s options button only opens its actions menu', () => {
      renderDock({
        selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }),
        selectedSourceIds: ['src-2'],
      });
      fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps Hide Sources in the source actions menu', async () => {
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      const dock = renderDock();
      fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));
      dock.rerender({ sourceActionsMenuOpen: true });
      await settle();

      expect(screen.getByRole('menu', { name: 'Source actions' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Hide Sources' }));

      expect(dock.onHide).toHaveBeenCalledOnce();
      expect(dock.setSourceActionsMenuOpen).toHaveBeenLastCalledWith(false);
    });

    it('double-clicking a row opens a dialog outside the sources dock', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));

      expect(screen.getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
      const dialog = screen.getByRole('dialog', { name: 'Source Properties' });
      expect(within(dialog).getByTestId('source-properties-panel')).toBeInTheDocument();
      expect(dialog.closest('.sources-dock')).toBeNull();
      expect(document.querySelector('.sources-dock .source-properties-bar')).toBeNull();
    });

    it('choosing Properties from the row context menu opens the dialog and calls onOpenSourceProperties', async () => {
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
      expect(within(screen.getByRole('dialog', { name: 'Source Properties' })).getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('choosing Filters from the row context menu opens the dialog and calls onOpenSourceFilters', async () => {
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
      expect(within(screen.getByRole('dialog', { name: 'Source Properties' })).getByTestId('source-properties-panel')).toHaveTextContent('Webcam');
    });

    it('closes via the dialog\'s close button', () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));
      expect(screen.getByTestId('source-properties-panel')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(screen.queryByTestId('source-properties-panel')).toBeNull();
    });

    it('closes with Escape and restores focus to the source row', async () => {
      renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      const row = rowFor('Webcam');
      row.focus();
      fireEvent.doubleClick(row);
      await settle();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await settle();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(row).toHaveFocus();
    });

    it('closes when the selected source is removed', () => {
      const { rerender } = renderDock({ selectedSource: makeSource('src-2', { name: 'Webcam', kind: 'camera' }), selectedSourceIds: ['src-2'] });
      fireEvent.doubleClick(rowFor('Webcam'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      rerender({ sources: [], selectedSource: null, selectedSourceIds: [] });
      expect(screen.queryByRole('dialog')).toBeNull();
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

    it('reorders selected sibling rows as one block', () => {
      const onReorderSources = vi.fn();
      renderDock({
        sources: [makeSource('src-1'), makeSource('src-2'), makeSource('src-3')],
        selectedSourceIds: ['src-1', 'src-2'],
        onReorderSources,
      });
      const first = rowFor('src-3');
      const second = rowFor('src-2');
      const third = rowFor('src-1');
      mockRowRect(first, 0);
      mockRowRect(second, 30);
      mockRowRect(third, 60);

      fireEvent.pointerDown(second, { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(second, { clientX: 10, clientY: 5 });
      fireEvent.pointerUp(second, { clientX: 10, clientY: 5 });

      expect(onReorderSources).toHaveBeenCalledWith(null, ['src-3', 'src-1', 'src-2']);
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

    it('leaves a selected block in place when dropped at the gap before its next row', () => {
      const onReorderSources = vi.fn();
      renderDock({
        sources: [makeSource('D'), makeSource('C'), makeSource('B'), makeSource('A')],
        selectedSourceIds: ['B', 'C'],
        onReorderSources,
      });
      const rows = ['A', 'B', 'C', 'D'].map((name, index) => {
        const row = rowFor(name);
        mockRowRect(row, index * 30);
        return row;
      });

      fireEvent.pointerDown(rows[1], { clientX: 10, clientY: 45 });
      fireEvent.pointerMove(rows[1], { clientX: 10, clientY: 90 });
      fireEvent.pointerUp(rows[1], { clientX: 10, clientY: 90 });

      expect(onReorderSources).not.toHaveBeenCalled();
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
