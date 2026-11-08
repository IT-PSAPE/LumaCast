import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChordDesktopAPI, MenuCommand } from '../../../../../apps/chord/shared/desktop-api';

const mocks = vi.hoisted(() => ({ api: null as ChordDesktopAPI | null, store: null as any, toast: vi.fn() }));
vi.mock('../../../../../apps/chord/renderer/api', () => ({ getApi: () => mocks.api }));
vi.mock('../../../../../apps/chord/renderer/store', () => ({ useChordStore: Object.assign((selector: (state: any) => any) => mocks.store(selector), {
  getState: () => mocks.store.getState(), subscribe: (...args: any[]) => mocks.store.subscribe(...args),
}) }));
vi.mock('@lumacast/ui', async (importOriginal) => ({ ...await importOriginal<typeof import('@lumacast/ui')>(), useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../../../../../apps/chord/renderer/shell/media-import', () => ({ importAudio: vi.fn(), importBackground: vi.fn(), importLyrics: vi.fn() }));
vi.mock('../../../../../apps/chord/renderer/features/timeline', () => ({ isEditableTarget: () => false,
  deleteSelectedCues: vi.fn(), duplicateSelectedCue: vi.fn(), trimSelectedCueToPlayhead: vi.fn() }));

import { createChordStore } from '../../../../../apps/chord/renderer/store/create-store';
import { createMockApi } from '../../../../../apps/chord/renderer/mock-api';
import { createEmptyProject } from '../../../../../apps/chord/shared/project-schema';
import { ConfirmHost } from '../../../../../apps/chord/renderer/components/confirm-dialog';
import { useDocumentNavigation } from '../../../../../apps/chord/renderer/shell/document-navigation';
import { useMenuCommands } from '../../../../../apps/chord/renderer/shell/menu-commands';

let command: ((command: MenuCommand) => void) | null;
let open: ((path: string) => void) | null;
let api: ChordDesktopAPI;
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
function Harness() {
  const navigation = useDocumentNavigation();
  useMenuCommands(navigation);
  return <><button onClick={() => void navigation.saveDocument()}>Toolbar Save</button><ConfirmHost /></>;
}
beforeEach(() => {
  command = null; open = null;
  const target = { project: createEmptyProject('2026-11-08T00:00:00Z', 'target'), path: '/synthetic/target.lumachord' };
  api = { ...createMockApi(), newProject: vi.fn(async () => target), openProject: vi.fn(async () => target),
    saveProject: vi.fn(async () => '/synthetic/saved.lumachord'), requestWindowClose: vi.fn(async () => false),
    onMenuCommand: vi.fn((callback) => { command = callback; return () => { command = null; }; }),
    onOpenProjectRequest: vi.fn((callback) => { open = callback; return () => { open = null; }; }),
    documentNavigationReady: vi.fn(async () => { expect(command).not.toBeNull(); expect(open).not.toBeNull(); }),
  };
  mocks.api = api;
  mocks.store = createChordStore(api);
  mocks.store.getState().setTitle('Unsaved source');
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('actual Chord mounted menu/navigation bridge', () => {
  it.each(['new', 'open', 'os-recent'] as const)('%s uses the shared visible unsaved prompt before replacing', async (route) => {
    render(<Harness />);
    act(() => { if (route === 'os-recent') open!('/synthetic/recent.lumachord'); else command!(route); });
    await flush();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.store.getState().document.project.title).toBe('Unsaved source');
    if (route === 'os-recent') expect(api.openProject).toHaveBeenCalledWith('/synthetic/recent.lumachord');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(mocks.store.getState().document.project.title).toBe('Unsaved source');
  });

  it('native Save and toolbar Save share the guarded save owner', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Toolbar Save' }));
    act(() => command!('save'));
    await flush();
    expect(api.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.store.getState().dirty).toBe(false);
    mocks.store.getState().setTitle('New edit');
    act(() => command!('save-as'));
    await flush();
    expect(api.saveProject).toHaveBeenLastCalledWith(expect.anything(), { saveAs: true });
  });

  it('an immediate dirty native close prompts before a debounced state report', async () => {
    render(<Harness />);
    act(() => command!('close'));
    await flush();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Save changes to this project before closing?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(api.requestWindowClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('reports readiness failures, then retries once through the next native close before consent', async () => {
    api.documentNavigationReady = vi.fn().mockRejectedValueOnce(new Error('initial cleanup'))
      .mockRejectedValueOnce(new Error('retry cleanup')).mockResolvedValue(undefined);
    render(<Harness />);
    await flush();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: expect.stringContaining('Close the window to retry') }));
    act(() => command!('close'));
    await flush();
    expect(api.documentNavigationReady).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenLastCalledWith({ description: 'Could not close this window.', tone: 'error' });
    expect(api.requestWindowClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.store.getState().document.project.title).toBe('Unsaved source');
    act(() => command!('close'));
    await flush();
    expect(api.documentNavigationReady).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
  });

  it('does not report a stale readiness failure after its bridge unmounts', async () => {
    let rejectReady!: (error: Error) => void;
    api.documentNavigationReady = () => new Promise<void>((_resolve, reject) => { rejectReady = reject; });
    const old = render(<Harness />);
    old.unmount();
    api.documentNavigationReady = async () => {};
    render(<Harness />);
    rejectReady(new Error('obsolete cleanup'));
    await flush();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('unmount removes listeners and aborts the visible stale prompt', async () => {
    const view = render(<Harness />);
    act(() => command!('new'));
    await flush();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.unmount();
    await flush();
    expect(command).toBeNull();
    expect(open).toBeNull();
    render(<ConfirmHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.store.getState().document.project.title).toBe('Unsaved source');
  });

  it('an unmounted held picker cannot leave an unload veto on its authorized successor', async () => {
    let finishPicker!: (value: null) => void;
    api.openProject = () => new Promise<null>((resolve) => { finishPicker = resolve; });
    const old = render(<Harness />);
    act(() => command!('open'));
    await flush();
    old.unmount();
    const unloads: boolean[] = [];
    api.requestWindowClose = vi.fn(async (approved) => {
      if (!approved) return false;
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      unloads.push(event.defaultPrevented);
      return !event.defaultPrevented;
    });
    render(<Harness />);
    act(() => command!('close'));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: "Don't Save" }));
    await flush();
    expect(unloads).toEqual([false]);
    expect(api.requestWindowClose).toHaveBeenCalledExactlyOnceWith(true);
    finishPicker(null);
    await flush();
  });
});
