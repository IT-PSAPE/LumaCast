import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmProvider, OverlayStackProvider } from '@lumacast/ui';
import { neutralRecipe, type AppState, type Photo } from '@lumacast/photo-model';
import type { DesktopAPI } from '../../../../apps/flux/shared/desktop-api';
import type { AppCommand } from '../../../../apps/flux/shared/app-command';

let appState: AppState;
let getAppStateOverride: (() => Promise<AppState>) | undefined;
let onChangeListener: (() => void) | undefined;
let menuCommandListener: ((command: AppCommand) => void) | undefined;
let applyEditsOverride: ((args: any) => Promise<unknown>) | undefined;
let updatePhotosMetadataOverride: ((args: any) => Promise<unknown>) | undefined;
let importPhotosOverride: ((args: any) => Promise<{ imported: string[]; errors: any[] }>) | undefined;
const command = vi.fn(async (name: string, args?: any) => {
  if (name === 'get_app_state') {
    return getAppStateOverride
      ? getAppStateOverride()
      : structuredClone(appState);
  }
  if (name === 'set_selection') {
    appState.selection = [...args.ids];
    onChangeListener?.();
    return appState.selection;
  }
  if (name === 'remove_photos_from_library') {
    const ids = new Set<string>(args.ids);
    appState.photos = appState.photos.filter((photo) => !ids.has(photo.id));
    appState.selection = appState.selection.filter((id) => !ids.has(id));
    onChangeListener?.();
    return args.ids;
  }
  if (name === 'update_photos_metadata') {
    if (updatePhotosMetadataOverride) return updatePhotosMetadataOverride(args);
    const { ids, ...metadata } = args;
    for (const id of args.ids) {
      const photo = appState.photos.find((item) => item.id === id);
      if (photo) Object.assign(photo, metadata);
    }
    onChangeListener?.();
    return ids;
  }
  if (name === 'import_photos') {
    if (importPhotosOverride) return importPhotosOverride(args);
    return { imported: [], errors: [] };
  }
  if (name === 'apply_edits') {
    if (applyEditsOverride) return applyEditsOverride(args);
    const photo = appState.photos.find((item) => item.id === args.id);
    if (!photo || photo.revision !== args.expectedRevision) {
      throw new Error('CONFLICT');
    }
    photo.recipe = { ...photo.recipe, ...args.patch };
    photo.revision++;
    onChangeListener?.();
    return photo;
  }
  if (name === 'export_photos') return { id: 'job-1' };
  throw new Error(`Unexpected command: ${name}`);
});
const api: DesktopAPI = {
  platform: 'darwin',
  command,
  chooseImport: vi.fn(async () => []),
  chooseDirectory: vi.fn(async () => null),
  chooseRelink: vi.fn(async () => null),
  preview: vi.fn(async () => ''),
  assetUrl: (id, revision) => `lumaflux://asset/${id}?revision=${revision}`,
  pathsForFiles: () => [],
  onChange: vi.fn((callback: () => void) => {
    onChangeListener = callback;
    return vi.fn();
  }),
  onMenuCommand: vi.fn((callback: (command: AppCommand) => void) => {
    menuCommandListener = callback;
    return vi.fn();
  }),
  settings: vi.fn(async () => ({ enabled: false, roots: [], configPath: '', clientConfig: '' })),
  updateSettings: vi.fn(async () => ({ enabled: false, roots: [], configPath: '', clientConfig: '' })),
};
let AppComponent: typeof import('../../../../apps/flux/renderer/App').App;

function makePhoto(id: string, name: string): Photo {
  return {
    id,
    path: `/photos/${name}.jpg`,
    name: `${name}.jpg`,
    folder: '/photos',
    width: 32,
    height: 24,
    format: 'jpeg',
    size: 100,
    metadata: {},
    importedAt: '2026-10-01T00:00:00.000Z',
    modifiedAt: '2026-10-01T00:00:00.000Z',
    rating: 0,
    favorite: false,
    missing: false,
    recipe: neutralRecipe(),
    revision: 0,
    history: [],
    future: [],
  };
}

beforeAll(async () => {
  Object.defineProperty(window, 'lumaflux', { configurable: true, value: api });
  ({ App: AppComponent } = await import('../../../../apps/flux/renderer/App'));
});

afterEach(() => {
  cleanup();
  command.mockClear();
  getAppStateOverride = undefined;
  applyEditsOverride = undefined;
  updatePhotosMetadataOverride = undefined;
  importPhotosOverride = undefined;
  onChangeListener = undefined;
  menuCommandListener = undefined;
  vi.mocked(api.chooseImport).mockClear();
});

function renderApp() {
  return render(
    <OverlayStackProvider>
      <ConfirmProvider>
        <AppComponent />
      </ConfirmProvider>
    </OverlayStackProvider>,
  );
}

async function chooseMinimumRating(label: string) {
  const trigger = screen.getByRole('combobox', { name: 'Minimum rating' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: label });
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
  await waitFor(() => expect(trigger.textContent).toContain(label));
}

describe('Lumaflux photo selection', () => {
  it('refreshes the full app state once after a local selection mutation', async () => {
    appState = {
      photos: [makePhoto('one', 'One')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select One.jpg' });
    expect(command.mock.calls.filter(([name]) => name === 'get_app_state')).toHaveLength(1);

    fireEvent.click(one);
    await waitFor(() => expect(appState.selection).toEqual(['one']));
    await waitFor(() =>
      expect(command.mock.calls.filter(([name]) => name === 'get_app_state')).toHaveLength(2),
    );
  });

  it('keeps the workspace busy until overlapping import and metadata work both finish', async () => {
    appState = {
      photos: [makePhoto('one', 'One')],
      selection: ['one'],
      jobs: [],
      activity: [],
    };
    let resolvePicker!: (paths: string[]) => void;
    const pickerResult = new Promise<string[]>((resolve) => {
      resolvePicker = resolve;
    });
    vi.mocked(api.chooseImport).mockReturnValueOnce(pickerResult);

    let resolveMetadata!: () => void;
    const metadataResult = new Promise<void>((resolve) => {
      resolveMetadata = resolve;
    });
    updatePhotosMetadataOverride = async ({ ids, ...metadata }) => {
      await metadataResult;
      for (const id of ids) {
        const photo = appState.photos.find((item) => item.id === id);
        if (photo) Object.assign(photo, metadata);
      }
      return ids;
    };

    renderApp();
    const importButton = await screen.findByRole('button', { name: 'Import photos' });
    const photoButton = await screen.findByRole('button', { name: 'Select One.jpg' });
    fireEvent.click(importButton);
    fireEvent.keyDown(photoButton, { key: 'f' });
    expect(screen.getByText('Working…')).toBeTruthy();

    resolvePicker([]);
    await waitFor(() => expect(api.chooseImport).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Working…')).toBeTruthy();

    resolveMetadata();
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());
    expect(appState.photos[0].favorite).toBe(true);
  });

  it('ignores a repeated favorite shortcut while the first metadata update is pending', async () => {
    appState = {
      photos: [makePhoto('one', 'One')],
      selection: ['one'],
      jobs: [],
      activity: [],
    };
    let resolveMetadata!: () => void;
    const metadataResult = new Promise<void>((resolve) => {
      resolveMetadata = resolve;
    });
    updatePhotosMetadataOverride = async ({ ids, ...metadata }) => {
      await metadataResult;
      for (const id of ids) {
        const photo = appState.photos.find((item) => item.id === id);
        if (photo) Object.assign(photo, metadata);
      }
      return ids;
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select One.jpg' });

    fireEvent.keyDown(one, { key: 'f' });
    fireEvent.keyDown(one, { key: 'f' });
    expect(command.mock.calls.filter(([name]) => name === 'update_photos_metadata')).toHaveLength(1);

    resolveMetadata();
    await waitFor(() => expect(appState.photos[0].favorite).toBe(true));
  });

  it('applies favorite and rating shortcuts to visible selection when a photo tile is focused', async () => {
    appState = {
      photos: [makePhoto('one', 'One'), makePhoto('two', 'Two')],
      selection: ['one', 'two'],
      jobs: [],
      activity: [],
    };
    renderApp();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search photos' }), {
      target: { value: 'Two' },
    });
    const two = await screen.findByRole('button', { name: 'Select Two.jpg' });

    fireEvent.keyDown(two, { key: 'f' });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith('update_photos_metadata', {
        ids: ['two'],
        favorite: true,
      }),
    );
    expect(appState.photos.find((photo) => photo.id === 'two')?.favorite).toBe(true);

    fireEvent.keyDown(two, { key: '4' });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith('update_photos_metadata', {
        ids: ['two'],
        rating: 4,
      }),
    );
    expect(appState.photos.find((photo) => photo.id === 'two')?.rating).toBe(4);
  });

  it('navigates photos with arrows while a filmstrip thumbnail has focus', async () => {
    appState = {
      photos: [makePhoto('one', 'One'), makePhoto('two', 'Two')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select One.jpg' });
    fireEvent.click(one);
    await waitFor(() => expect(appState.selection).toEqual(['one']));
    fireEvent.doubleClick(one);
    const filmstripOne = await screen.findByTitle('One.jpg');

    fireEvent.keyDown(filmstripOne, { key: 'ArrowRight' });
    await waitFor(() => expect(appState.selection).toEqual(['two']));
  });

  it('allows only one file or folder picker while an import chooser is open', async () => {
    appState = {
      photos: [makePhoto('one', 'One')],
      selection: [],
      jobs: [],
      activity: [],
    };
    let resolvePicker!: (paths: string[]) => void;
    const pickerResult = new Promise<string[]>((resolve) => {
      resolvePicker = resolve;
    });
    vi.mocked(api.chooseImport).mockReturnValueOnce(pickerResult);
    renderApp();

    const importButton = await screen.findByRole('button', { name: 'Import photos' });
    fireEvent.click(importButton);
    await waitFor(() => expect(api.chooseImport).toHaveBeenCalledTimes(1));

    fireEvent.click(importButton);
    menuCommandListener?.('import-folder');
    expect(api.chooseImport).toHaveBeenCalledTimes(1);

    resolvePicker([]);
    await waitFor(() => expect(importButton).toBeEnabled());
  });

  it('clears search and rating filters after importing photos successfully', async () => {
    const existing = makePhoto('existing', 'Existing');
    existing.rating = 5;
    appState = {
      photos: [existing],
      selection: [],
      jobs: [],
      activity: [],
    };
    vi.mocked(api.chooseImport).mockResolvedValueOnce(['/photos/Existing-New.jpg']);
    importPhotosOverride = async () => {
      appState.photos.push(makePhoto('new', 'Existing New'));
      return { imported: ['new'], errors: [] };
    };
    renderApp();

    const search = await screen.findByRole('searchbox', { name: 'Search photos' });
    fireEvent.change(search, { target: { value: 'Existing' } });
    await chooseMinimumRating('3+ stars');
    expect(await screen.findByRole('button', { name: 'Select Existing.jpg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Existing New.jpg' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Import photos' }));

    expect(await screen.findByRole('button', { name: 'Select Existing New.jpg' })).toBeTruthy();
    await waitFor(() => expect(search).toHaveValue(''));
    expect(screen.getByRole('combobox', { name: 'Minimum rating' }).textContent).toContain('All ratings');
  });

  it('preserves search and rating filters when import is canceled or imports only duplicates', async () => {
    const existing = makePhoto('existing', 'Existing');
    existing.rating = 5;
    appState = {
      photos: [existing],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const search = await screen.findByRole('searchbox', { name: 'Search photos' });
    fireEvent.change(search, { target: { value: 'Existing' } });
    await chooseMinimumRating('3+ stars');

    fireEvent.click(screen.getByRole('button', { name: 'Import photos' }));
    await waitFor(() => expect(api.chooseImport).toHaveBeenCalledTimes(1));
    expect(command.mock.calls.some(([name]) => name === 'import_photos')).toBe(false);
    expect(search).toHaveValue('Existing');
    expect(screen.getByRole('combobox', { name: 'Minimum rating' }).textContent).toContain('3+ stars');

    vi.mocked(api.chooseImport).mockResolvedValueOnce(['/photos/Existing.jpg']);
    importPhotosOverride = async () => ({ imported: [], errors: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Import photos' }));

    await waitFor(() => expect(command.mock.calls.filter(([name]) => name === 'import_photos')).toHaveLength(1));
    expect(search).toHaveValue('Existing');
    expect(screen.getByRole('combobox', { name: 'Minimum rating' }).textContent).toContain('3+ stars');
    expect(screen.getByRole('button', { name: 'Select Existing.jpg' })).toBeTruthy();
  });

  it('keeps the newest app-state refresh when overlapping responses arrive out of order', async () => {
    appState = {
      photos: [],
      selection: [],
      jobs: [],
      activity: [],
    };
    let resolveOld!: (value: AppState) => void;
    let resolveNew!: (value: AppState) => void;
    const oldRequest = new Promise<AppState>((resolve) => {
      resolveOld = resolve;
    });
    const newRequest = new Promise<AppState>((resolve) => {
      resolveNew = resolve;
    });
    let request = 0;
    getAppStateOverride = () => (++request === 1 ? oldRequest : newRequest);

    renderApp();
    await waitFor(() => expect(request).toBe(1));
    onChangeListener?.();
    await waitFor(() => expect(request).toBe(2));

    resolveNew({
      photos: [makePhoto('newer', 'Newer')],
      selection: [],
      jobs: [],
      activity: [],
    });
    expect(await screen.findByRole('button', { name: 'Select Newer.jpg' })).toBeTruthy();

    resolveOld({
      photos: [makePhoto('older', 'Older')],
      selection: [],
      jobs: [],
      activity: [],
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select Older.jpg' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Select Newer.jpg' })).toBeTruthy();
  });

  it('exports the exact selection captured when the dialog opened', async () => {
    appState = {
      photos: [makePhoto('one', 'One'), makePhoto('two', 'Two')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Select One.jpg' }));
    await waitFor(() => expect(appState.selection).toEqual(['one']));

    fireEvent.click(screen.getByRole('button', { name: 'Export (1)' }));
    expect(await screen.findByRole('heading', { name: 'Export 1 photo' })).toBeTruthy();

    appState.selection = ['one', 'two'];
    onChangeListener?.();
    await waitFor(() => expect(document.body.textContent).toContain('Export (2)'));
    expect(await screen.findByRole('heading', { name: 'Export 1 photo' })).toBeTruthy();

    vi.mocked(api.chooseDirectory).mockResolvedValueOnce('/exports');
    fireEvent.click(screen.getByRole('button', { name: 'Choose export folder' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Export destination' })).toHaveValue('/exports'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export photos' }));

    await waitFor(() =>
      expect(command.mock.calls.filter(([name]) => name === 'export_photos')).toEqual([
        ['export_photos', expect.objectContaining({ ids: ['one'] })],
      ]),
    );
  });

  it('supports toggle and range selection without switching the active photo, then removes the group once', async () => {
    appState = {
      photos: [makePhoto('one', 'Alpha'), makePhoto('two', 'Bravo'), makePhoto('three', 'Charlie')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select Alpha.jpg' });
    const two = screen.getByRole('button', { name: 'Select Bravo.jpg' });
    const three = screen.getByRole('button', { name: 'Select Charlie.jpg' });

    fireEvent.click(three);
    await waitFor(() => expect(appState.selection).toEqual(['three']));
    fireEvent.click(one, { ctrlKey: true });
    await waitFor(() => expect(appState.selection).toEqual(['one', 'three']));
    expect(three.closest('.photo-tile')?.className).toContain('focused');

    fireEvent.click(two, { shiftKey: true });
    await waitFor(() => expect(appState.selection).toEqual(['one', 'two']));
    expect(one.closest('.photo-tile')?.className).toContain('selected');
    expect(two.closest('.photo-tile')?.className).toContain('selected');
    expect(three.closest('.photo-tile')?.className).toContain('focused');

    fireEvent.keyDown(two, { key: 'f' });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith('update_photos_metadata', {
        ids: ['one', 'two'],
        favorite: true,
      }),
    );
    expect(appState.photos.filter((photo) => photo.id !== 'three').every((photo) => photo.favorite)).toBe(true);
    expect(appState.photos.find((photo) => photo.id === 'three')?.favorite).toBe(false);

    fireEvent.keyDown(two, { key: 'Delete' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Original files on disk are not deleted/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from library' }));

    await waitFor(() => expect(command.mock.calls.some(([name]) => name === 'remove_photos_from_library')).toBe(true));
    expect(command.mock.calls.filter(([name]) => name === 'remove_photos_from_library')).toEqual([
      ['remove_photos_from_library', { ids: ['one', 'two'] }],
    ]);
    await waitFor(() => expect(appState.photos.map((photo) => photo.id)).toEqual(['three']));
    expect(three.closest('.photo-tile')?.className).toContain('focused');
    expect(command.mock.calls.some(([name]) => name === 'apply_edits')).toBe(false);
  });

  it('handles Select All and Escape inside the focused photo collection', async () => {
    appState = {
      photos: [makePhoto('one', 'One'), makePhoto('two', 'Two')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select One.jpg' });

    fireEvent.keyDown(one, { key: 'a', ctrlKey: true });
    await waitFor(() => expect(appState.selection).toEqual(['one', 'two']));

    fireEvent.keyDown(one, { key: 'Escape' });
    await waitFor(() => expect(appState.selection).toEqual([]));
  });

  it('preserves hidden selections across filters and removes them with one visible collection action', async () => {
    appState = {
      photos: [makePhoto('one', 'One'), makePhoto('two', 'Two'), makePhoto('three', 'Three')],
      selection: [],
      jobs: [],
      activity: [],
    };
    renderApp();
    const one = await screen.findByRole('button', { name: 'Select One.jpg' });
    const two = screen.getByRole('button', { name: 'Select Two.jpg' });

    fireEvent.click(one);
    await waitFor(() => expect(appState.selection).toEqual(['one']));
    fireEvent.click(two, { ctrlKey: true });
    await waitFor(() => expect(appState.selection).toEqual(['one', 'two']));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search photos' }), { target: { value: 'Two' } });
    expect(await screen.findByRole('button', { name: 'Select Two.jpg' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Select One.jpg' })).toBeNull();
    await waitFor(() => expect(screen.getByText(/2 selected/)).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Remove from library' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Remove 2 photos/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from library' }));

    await waitFor(() => expect(appState.photos.map((photo) => photo.id)).toEqual(['three']));
    expect(command.mock.calls.filter(([name]) => name === 'remove_photos_from_library')).toEqual([
      ['remove_photos_from_library', { ids: ['two', 'one'] }],
    ]);
  });
});
