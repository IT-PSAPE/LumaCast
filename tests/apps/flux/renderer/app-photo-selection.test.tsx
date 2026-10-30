import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmProvider, OverlayStackProvider } from '@lumacast/ui';
import { neutralRecipe, type AppState, type Photo } from '@lumacast/photo-model';
import type { DesktopAPI } from '../../../../apps/flux/shared/desktop-api';

let appState: AppState;
const command = vi.fn(async (name: string, args?: any) => {
  if (name === 'get_app_state') return structuredClone(appState);
  if (name === 'set_selection') {
    appState.selection = [...args.ids];
    return appState.selection;
  }
  if (name === 'remove_photos_from_library') {
    const ids = new Set<string>(args.ids);
    appState.photos = appState.photos.filter((photo) => !ids.has(photo.id));
    appState.selection = appState.selection.filter((id) => !ids.has(id));
    return args.ids;
  }
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
  onChange: vi.fn(() => vi.fn()),
  onMenuCommand: vi.fn(() => vi.fn()),
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

describe('Lumaflux photo selection', () => {
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
    expect(command.mock.calls.some(([name]) => name === 'update_metadata')).toBe(false);

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
