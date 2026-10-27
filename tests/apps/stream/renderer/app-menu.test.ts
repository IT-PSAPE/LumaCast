import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem, MenubarMenu } from '@lumacast/ui';
import {
  buildAppMenus, collectMenuActions, serializeAppMenus, shortcutToAccelerator,
  type AppMenuActions, type AppMenuContext, type SerializedMenuItem,
} from '../../../../apps/stream/renderer/chrome/app-menu';

function isItem(entry: MenuEntry): entry is MenuItem {
  return 'id' in entry;
}

function findItem(entries: MenuEntry[], id: string): MenuItem {
  for (const entry of entries) {
    if (isItem(entry)) {
      if (entry.id === id) return entry;
      if (entry.children) {
        const found = findItem(entry.children, id);
        if (found) return found;
      }
    }
  }
  throw new Error(`menu item not found: ${id}`);
}

function findMenu(menus: MenubarMenu[], id: string): MenubarMenu {
  const menu = menus.find((candidate) => candidate.id === id);
  if (!menu) throw new Error(`menu not found: ${id}`);
  return menu;
}

function makeActions(): AppMenuActions {
  return {
    openSettings: vi.fn(),
    quit: vi.fn(),
    importCollection: vi.fn(),
    exportCollection: vi.fn(),
    showRecordings: vi.fn(),
    remux: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copySource: vi.fn(),
    pasteSource: vi.fn(),
    deleteSource: vi.fn(),
    fitSource: vi.fn(),
    stretchSource: vi.fn(),
    centerSource: vi.fn(),
    resetTransform: vi.fn(),
    toggleStudioMode: vi.fn(),
    openMultiview: vi.fn(),
    openPreviewProjector: vi.fn(),
    openProgramProjector: vi.fn(),
    toggleDock: vi.fn(),
    resetUi: vi.fn(),
    activateCollection: vi.fn(),
    newCollection: vi.fn(),
    duplicateCollection: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn(),
    activateProfile: vi.fn(),
    newProfile: vi.fn(),
    duplicateProfile: vi.fn(),
    renameProfile: vi.fn(),
    deleteProfile: vi.fn(),
    importProfile: vi.fn(),
    exportProfile: vi.fn(),
    about: vi.fn(),
    shortcuts: vi.fn(),
  };
}

function makeContext(overrides: Partial<AppMenuContext> = {}): AppMenuContext {
  return {
    platform: 'darwin',
    studioMode: false,
    multiviewOpen: false,
    undoAvailable: false,
    redoAvailable: false,
    sourceSelected: false,
    clipboardAvailable: false,
    docks: [
      { id: 'scenes', label: 'Scenes', visible: true },
      { id: 'youtube', label: 'YouTube Live', visible: false },
      { id: 'zoom', label: 'Zoom', visible: false },
    ],
    collections: [
      { id: 'col-1', name: 'Default' },
      { id: 'col-2', name: 'Sunday Service' },
    ],
    activeCollectionId: 'col-1',
    profiles: [
      { id: 'prof-1', name: 'Default' },
      { id: 'prof-2', name: 'Streaming' },
    ],
    activeProfileId: 'prof-1',
    actions: makeActions(),
    ...overrides,
  };
}

describe('buildAppMenus', () => {
  it('returns the seven OBS-minimal menus, in order, with the right ids and labels', () => {
    const menus = buildAppMenus(makeContext());
    expect(menus.map((menu) => menu.id)).toEqual(['file', 'edit', 'view', 'docks', 'profile', 'sceneCollection', 'help']);
    expect(menus.map((menu) => menu.label)).toEqual(['File', 'Edit', 'View', 'Docks', 'Profile', 'Scene Collection', 'Help']);
  });

  it('shows the File menu content and quits with a darwin shortcut', () => {
    const context = makeContext({ platform: 'darwin' });
    const menus = buildAppMenus(context);
    const file = findMenu(menus, 'file');
    expect(file.entries.filter(isItem).map((item) => item.label)).toEqual([
      'Import Scene Collection…', 'Export Scene Collection…', 'Show Recordings', 'Convert to MP4…', 'Settings…', 'Quit',
    ]);

    const quit = findItem(file.entries, 'file.quit');
    expect(quit.shortcut).toBe('⌘Q');
    quit.onSelect?.();
    expect(context.actions.quit).toHaveBeenCalledTimes(1);

    const convert = findItem(file.entries, 'file.remux');
    expect(convert.label).toBe('Convert to MP4…');
    convert.onSelect?.();
    expect(context.actions.remux).toHaveBeenCalledTimes(1);
  });

  it('omits the Quit shortcut off darwin', () => {
    const menus = buildAppMenus(makeContext({ platform: 'win32' }));
    expect(findItem(findMenu(menus, 'file').entries, 'file.quit').shortcut).toBeUndefined();
  });

  describe('Edit menu', () => {
    it('disables Undo/Redo when unavailable and enables them when available', () => {
      const unavailable = buildAppMenus(makeContext({ undoAvailable: false, redoAvailable: false }));
      expect(findItem(findMenu(unavailable, 'edit').entries, 'edit.undo').disabled).toBe(true);
      expect(findItem(findMenu(unavailable, 'edit').entries, 'edit.redo').disabled).toBe(true);

      const available = buildAppMenus(makeContext({ undoAvailable: true, redoAvailable: true }));
      expect(findItem(findMenu(available, 'edit').entries, 'edit.undo').disabled).toBe(false);
      expect(findItem(findMenu(available, 'edit').entries, 'edit.redo').disabled).toBe(false);
    });

    it('disables Copy/Delete/Transform with no selection, and Paste with an empty clipboard', () => {
      const context = makeContext({ sourceSelected: false, clipboardAvailable: false });
      const edit = findMenu(buildAppMenus(context), 'edit');
      expect(findItem(edit.entries, 'edit.copy').disabled).toBe(true);
      expect(findItem(edit.entries, 'edit.delete').disabled).toBe(true);
      expect(findItem(edit.entries, 'edit.transform').disabled).toBe(true);
      expect(findItem(edit.entries, 'edit.paste').disabled).toBe(true);

      const selected = findMenu(buildAppMenus(makeContext({ sourceSelected: true, clipboardAvailable: true })), 'edit');
      expect(findItem(selected.entries, 'edit.copy').disabled).toBe(false);
      expect(findItem(selected.entries, 'edit.delete').disabled).toBe(false);
      expect(findItem(selected.entries, 'edit.transform').disabled).toBe(false);
      expect(findItem(selected.entries, 'edit.paste').disabled).toBe(false);
    });

    it('fires the Transform submenu callbacks', () => {
      const context = makeContext({ sourceSelected: true });
      const edit = findMenu(buildAppMenus(context), 'edit');
      findItem(edit.entries, 'edit.transform.fit').onSelect?.();
      findItem(edit.entries, 'edit.transform.stretch').onSelect?.();
      findItem(edit.entries, 'edit.transform.center').onSelect?.();
      findItem(edit.entries, 'edit.transform.reset').onSelect?.();
      expect(context.actions.fitSource).toHaveBeenCalledTimes(1);
      expect(context.actions.stretchSource).toHaveBeenCalledTimes(1);
      expect(context.actions.centerSource).toHaveBeenCalledTimes(1);
      expect(context.actions.resetTransform).toHaveBeenCalledTimes(1);
    });
  });

  describe('View menu', () => {
    it('checks Studio Mode from context and toggles it', () => {
      const context = makeContext({ studioMode: true });
      const view = findMenu(buildAppMenus(context), 'view');
      const studioMode = findItem(view.entries, 'view.studioMode');
      expect(studioMode.checked).toBe(true);
      studioMode.onSelect?.();
      expect(context.actions.toggleStudioMode).toHaveBeenCalledTimes(1);
    });

    it('checks Multiview (Windowed) while one is open, and fires the toggle action either way', () => {
      const openContext = makeContext({ multiviewOpen: true });
      const openItem = findItem(findMenu(buildAppMenus(openContext), 'view').entries, 'view.multiview');
      expect(openItem.checked).toBe(true);
      expect(openItem.disabled).toBeFalsy();
      openItem.onSelect?.();
      expect(openContext.actions.openMultiview).toHaveBeenCalledTimes(1);

      const closedContext = makeContext({ multiviewOpen: false });
      expect(findItem(findMenu(buildAppMenus(closedContext), 'view').entries, 'view.multiview').checked).toBe(false);
    });

    it('disables Preview Projector outside Studio Mode', () => {
      expect(findItem(findMenu(buildAppMenus(makeContext({ studioMode: false })), 'view').entries, 'view.previewProjector').disabled).toBe(true);
      expect(findItem(findMenu(buildAppMenus(makeContext({ studioMode: true })), 'view').entries, 'view.previewProjector').disabled).toBe(false);
    });

    it('fires the projector and reset-UI actions', () => {
      const context = makeContext({ studioMode: true });
      const view = findMenu(buildAppMenus(context), 'view');
      findItem(view.entries, 'view.previewProjector').onSelect?.();
      findItem(view.entries, 'view.programProjector').onSelect?.();
      findItem(view.entries, 'view.resetUi').onSelect?.();
      expect(context.actions.openPreviewProjector).toHaveBeenCalledTimes(1);
      expect(context.actions.openProgramProjector).toHaveBeenCalledTimes(1);
      expect(context.actions.resetUi).toHaveBeenCalledTimes(1);
    });
  });

  describe('Docks menu', () => {
    it('lists one checked item per dock and toggles it by id', () => {
      const context = makeContext();
      const docks = findMenu(buildAppMenus(context), 'docks');
      const scenes = findItem(docks.entries, 'docks.scenes');
      const youtube = findItem(docks.entries, 'docks.youtube');
      const zoom = findItem(docks.entries, 'docks.zoom');
      expect(scenes.label).toBe('Scenes');
      expect(scenes.checked).toBe(true);
      expect(youtube.label).toBe('YouTube Live');
      expect(youtube.checked).toBe(false);
      expect(zoom.label).toBe('Zoom');

      youtube.onSelect?.();
      expect(context.actions.toggleDock).toHaveBeenCalledWith('youtube');
    });

    it('resets via the shared resetUi action', () => {
      const context = makeContext();
      findItem(findMenu(buildAppMenus(context), 'docks').entries, 'docks.reset').onSelect?.();
      expect(context.actions.resetUi).toHaveBeenCalledTimes(1);
    });
  });

  describe('Profile menu (radio list)', () => {
    it('checks the active profile and activates another by id', () => {
      const context = makeContext({ activeProfileId: 'prof-1' });
      const profile = findMenu(buildAppMenus(context), 'profile');
      expect(findItem(profile.entries, 'profile.prof-1').checked).toBe(true);
      expect(findItem(profile.entries, 'profile.prof-2').checked).toBe(false);

      findItem(profile.entries, 'profile.prof-2').onSelect?.();
      expect(context.actions.activateProfile).toHaveBeenCalledWith('prof-2');
    });

    it('disables Duplicate/Rename/Remove with no active profile, and enables New/Import/Export regardless', () => {
      const none = findMenu(buildAppMenus(makeContext({ activeProfileId: null })), 'profile');
      expect(findItem(none.entries, 'profile.duplicate').disabled).toBe(true);
      expect(findItem(none.entries, 'profile.rename').disabled).toBe(true);
      expect(findItem(none.entries, 'profile.remove').disabled).toBe(true);
      expect(findItem(none.entries, 'profile.new').disabled).toBeFalsy();
      expect(findItem(none.entries, 'profile.import').disabled).toBeFalsy();
      expect(findItem(none.entries, 'profile.export').disabled).toBeFalsy();

      const active = findMenu(buildAppMenus(makeContext({ activeProfileId: 'prof-1' })), 'profile');
      expect(findItem(active.entries, 'profile.duplicate').disabled).toBe(false);
      expect(findItem(active.entries, 'profile.rename').disabled).toBe(false);
      expect(findItem(active.entries, 'profile.remove').disabled).toBe(false);
    });

    it('marks Remove as danger and fires the management callbacks', () => {
      const context = makeContext();
      const profile = findMenu(buildAppMenus(context), 'profile');
      expect(findItem(profile.entries, 'profile.remove').danger).toBe(true);

      findItem(profile.entries, 'profile.new').onSelect?.();
      findItem(profile.entries, 'profile.duplicate').onSelect?.();
      findItem(profile.entries, 'profile.rename').onSelect?.();
      findItem(profile.entries, 'profile.remove').onSelect?.();
      findItem(profile.entries, 'profile.import').onSelect?.();
      findItem(profile.entries, 'profile.export').onSelect?.();
      expect(context.actions.newProfile).toHaveBeenCalledTimes(1);
      expect(context.actions.duplicateProfile).toHaveBeenCalledTimes(1);
      expect(context.actions.renameProfile).toHaveBeenCalledTimes(1);
      expect(context.actions.deleteProfile).toHaveBeenCalledTimes(1);
      expect(context.actions.importProfile).toHaveBeenCalledTimes(1);
      expect(context.actions.exportProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scene Collection menu (radio list)', () => {
    it('checks the active collection and activates another by id', () => {
      const context = makeContext({ activeCollectionId: 'col-1' });
      const sceneCollection = findMenu(buildAppMenus(context), 'sceneCollection');
      expect(findItem(sceneCollection.entries, 'sceneCollection.col-1').checked).toBe(true);
      expect(findItem(sceneCollection.entries, 'sceneCollection.col-2').checked).toBe(false);

      findItem(sceneCollection.entries, 'sceneCollection.col-2').onSelect?.();
      expect(context.actions.activateCollection).toHaveBeenCalledWith('col-2');
    });

    it('disables Duplicate/Rename/Remove with no active collection', () => {
      const none = findMenu(buildAppMenus(makeContext({ activeCollectionId: null })), 'sceneCollection');
      expect(findItem(none.entries, 'sceneCollection.duplicate').disabled).toBe(true);
      expect(findItem(none.entries, 'sceneCollection.rename').disabled).toBe(true);
      expect(findItem(none.entries, 'sceneCollection.remove').disabled).toBe(true);
    });

    it('fires the management callbacks, sharing File\'s import/export actions', () => {
      const context = makeContext();
      const sceneCollection = findMenu(buildAppMenus(context), 'sceneCollection');
      findItem(sceneCollection.entries, 'sceneCollection.new').onSelect?.();
      findItem(sceneCollection.entries, 'sceneCollection.duplicate').onSelect?.();
      findItem(sceneCollection.entries, 'sceneCollection.rename').onSelect?.();
      findItem(sceneCollection.entries, 'sceneCollection.remove').onSelect?.();
      findItem(sceneCollection.entries, 'sceneCollection.import').onSelect?.();
      findItem(sceneCollection.entries, 'sceneCollection.export').onSelect?.();
      expect(context.actions.newCollection).toHaveBeenCalledTimes(1);
      expect(context.actions.duplicateCollection).toHaveBeenCalledTimes(1);
      expect(context.actions.renameCollection).toHaveBeenCalledTimes(1);
      expect(context.actions.deleteCollection).toHaveBeenCalledTimes(1);
      expect(context.actions.importCollection).toHaveBeenCalledTimes(1);
      expect(context.actions.exportCollection).toHaveBeenCalledTimes(1);
    });
  });

  describe('Help menu', () => {
    it('fires Keyboard Shortcuts and About', () => {
      const context = makeContext();
      const help = findMenu(buildAppMenus(context), 'help');
      findItem(help.entries, 'help.shortcuts').onSelect?.();
      findItem(help.entries, 'help.about').onSelect?.();
      expect(context.actions.shortcuts).toHaveBeenCalledTimes(1);
      expect(context.actions.about).toHaveBeenCalledTimes(1);
    });
  });
});

function findSerializedMenu(items: SerializedMenuItem[], id: string): SerializedMenuItem {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`serialized menu not found: ${id}`);
  return item;
}

function findSerializedItem(items: SerializedMenuItem[], id: string): SerializedMenuItem {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.submenu) {
      try {
        return findSerializedItem(item.submenu, id);
      } catch {
        // keep looking among siblings
      }
    }
  }
  throw new Error(`serialized menu item not found: ${id}`);
}

describe('shortcutToAccelerator', () => {
  it('converts darwin symbol shortcuts to CommandOrControl accelerators', () => {
    expect(shortcutToAccelerator('⌘Z')).toBe('CommandOrControl+Z');
    expect(shortcutToAccelerator('⇧⌘Z')).toBe('Shift+CommandOrControl+Z');
    expect(shortcutToAccelerator('⌘C')).toBe('CommandOrControl+C');
  });

  it('converts Windows/Linux Ctrl+-style shortcuts', () => {
    expect(shortcutToAccelerator('Ctrl+Z')).toBe('CommandOrControl+Z');
    expect(shortcutToAccelerator('Ctrl+Shift+Z')).toBe('CommandOrControl+Shift+Z');
  });

  it('passes named keys and function keys through unchanged', () => {
    expect(shortcutToAccelerator('Delete')).toBe('Delete');
    expect(shortcutToAccelerator('F2')).toBe('F2');
  });

  it('strips the Arrow prefix from arrow-key labels', () => {
    expect(shortcutToAccelerator('ArrowUp')).toBe('Up');
  });

  it('returns undefined for an empty or unparseable shortcut', () => {
    expect(shortcutToAccelerator(undefined)).toBeUndefined();
    expect(shortcutToAccelerator('')).toBeUndefined();
  });
});

describe('serializeAppMenus', () => {
  it('produces one top-level submenu per menu, in order', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext()), 'darwin');
    expect(serialized.map((item) => item.id)).toEqual(['file', 'edit', 'view', 'docks', 'profile', 'sceneCollection', 'help']);
    expect(serialized.every((item) => item.type === 'submenu' && Array.isArray(item.submenu))).toBe(true);
  });

  it('converts darwin shortcuts to accelerators and marks Transform/Delete display-only', () => {
    const context = makeContext({ platform: 'darwin', sourceSelected: true, undoAvailable: true, redoAvailable: true, clipboardAvailable: true });
    const serialized = serializeAppMenus(buildAppMenus(context), 'darwin');

    const undo = findSerializedItem(serialized, 'edit.undo');
    expect(undo.accelerator).toBe('CommandOrControl+Z');
    expect(undo.registerAccelerator).toBeUndefined(); // registers normally

    const del = findSerializedItem(serialized, 'edit.delete');
    expect(del.accelerator).toBe('Delete');
    expect(del.registerAccelerator).toBe(false);

    const fit = findSerializedItem(serialized, 'edit.transform.fit');
    expect(fit.accelerator).toBe('CommandOrControl+F');
    expect(fit.registerAccelerator).toBe(false);
  });

  it('marks File > Quit display-only on darwin (the native App menu owns Cmd+Q)', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext({ platform: 'darwin' })), 'darwin');
    const quit = findSerializedItem(serialized, 'file.quit');
    expect(quit.accelerator).toBe('CommandOrControl+Q');
    expect(quit.registerAccelerator).toBe(false);
  });

  it('serializes separators and drops checked/accelerator fields from plain items', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext()), 'darwin');
    const file = findSerializedMenu(serialized, 'file').submenu!;
    expect(file.some((item) => item.type === 'separator')).toBe(true);
    const importItem = findSerializedItem(serialized, 'file.importCollection');
    expect(importItem.checked).toBeUndefined();
    expect(importItem.type).toBeUndefined();
  });

  it('marks docks items as independent checkboxes', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext()), 'darwin');
    const scenes = findSerializedItem(serialized, 'docks.scenes');
    expect(scenes.type).toBe('checkbox');
    expect(scenes.checked).toBe(true);
  });

  it('marks profile/scene-collection list entries as a radio group, but not their action items', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext()), 'darwin');
    const activeProfile = findSerializedItem(serialized, 'profile.prof-1');
    expect(activeProfile.type).toBe('radio');
    expect(activeProfile.checked).toBe(true);
    const otherProfile = findSerializedItem(serialized, 'profile.prof-2');
    expect(otherProfile.type).toBe('radio');
    expect(otherProfile.checked).toBe(false);
    const newProfile = findSerializedItem(serialized, 'profile.new');
    expect(newProfile.type).toBeUndefined();

    const activeCollection = findSerializedItem(serialized, 'sceneCollection.col-1');
    expect(activeCollection.type).toBe('radio');
    expect(activeCollection.checked).toBe(true);
  });

  it('nests the Transform submenu', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext({ sourceSelected: true })), 'darwin');
    const transform = findSerializedItem(serialized, 'edit.transform');
    expect(transform.type).toBe('submenu');
    expect(transform.submenu?.map((item) => item.id)).toEqual([
      'edit.transform.fit', 'edit.transform.stretch', 'edit.transform.center', 'edit.transform.reset',
    ]);
  });

  it('marks disabled items', () => {
    const serialized = serializeAppMenus(buildAppMenus(makeContext({ undoAvailable: false })), 'darwin');
    expect(findSerializedItem(serialized, 'edit.undo').disabled).toBe(true);
  });
});

describe('collectMenuActions', () => {
  it('maps every actionable id (including nested submenu items) to its onSelect', () => {
    const context = makeContext({ sourceSelected: true });
    const actions = collectMenuActions(buildAppMenus(context));
    expect(actions.get('file.quit')).toBeTypeOf('function');
    expect(actions.get('edit.transform.fit')).toBeTypeOf('function');
    expect(actions.get('profile.prof-2')).toBeTypeOf('function');

    actions.get('edit.transform.fit')?.();
    expect(context.actions.fitSource).toHaveBeenCalledTimes(1);

    actions.get('profile.prof-2')?.();
    expect(context.actions.activateProfile).toHaveBeenCalledWith('prof-2');
  });

  it('omits separators, headings, and submenu containers themselves', () => {
    const actions = collectMenuActions(buildAppMenus(makeContext()));
    expect(actions.has('edit.transform')).toBe(false);
  });
});
