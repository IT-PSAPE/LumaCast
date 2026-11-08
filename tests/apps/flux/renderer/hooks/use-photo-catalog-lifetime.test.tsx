import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppState } from '@lumacast/photo-model';
import type { DesktopAPI } from '../../../../../apps/flux/shared/desktop-api';
import type { PhotoCommand } from '../../../../../apps/flux/shared/photo-command';

const publication = vi.hoisted(() => ({ delayed: false, pending: [] as Array<() => void> }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    // Hold only the hook's state publication to test authority independently
    // of when React commits effect updates. Its effects and transport run normally.
    useState: (initial: unknown) => {
      const [value, setValue] = actual.useState(initial);
      return [value, (next: unknown) => {
        if (publication.delayed) publication.pending.push(() => setValue(next));
        else setValue(next);
      }];
    },
  };
});
import { usePhotoCatalog } from '../../../../../apps/flux/renderer/hooks/use-photo-catalog';

function snapshot(...selection: string[]): AppState {
  return { photos: [], selection, jobs: [], activity: [] };
}

function fakeApi(state: AppState) {
  const command = vi.fn<PhotoCommand>().mockResolvedValue(state);
  const settings = { enabled: false, roots: [], configPath: '', clientConfig: '' };
  const api: DesktopAPI = {
    platform: 'darwin',
    command,
    chooseImport: async () => [],
    chooseDirectory: async () => null,
    chooseRelink: async () => null,
    preview: async () => '',
    assetUrl: () => '',
    pathsForFiles: () => [],
    onChange: () => () => {},
    onMenuCommand: () => () => {},
    settings: async () => settings,
    updateSettings: async () => settings,
  };
  return { api, command };
}

afterEach(() => {
  publication.delayed = false;
  publication.pending = [];
  cleanup();
});

it('hides a retired same-API snapshot while replacement effect updates wait to publish', async () => {
  const first = fakeApi(snapshot('retired-A'));
  const replacement = fakeApi(snapshot('B'));
  const { result, rerender } = renderHook(({ api }) => usePhotoCatalog(api), { initialProps: { api: first.api } });
  await waitFor(() => expect(result.current.state.selection).toEqual(['retired-A']));
  const retired = result.current;
  publication.delayed = true;
  rerender({ api: replacement.api });
  first.command.mockReturnValueOnce(new Promise<AppState>(() => {}));
  rerender({ api: first.api });

  expect(retired.getSnapshot()).toBeNull();
  expect(result.current.getSnapshot()).toBeNull();
  expect(result.current.status).toBe('loading');
  expect(result.current.state.selection).toEqual([]);
  await expect(result.current.run('set_selection', { ids: ['obsolete'] })).rejects.toThrow('no longer active');

  publication.delayed = false;
  await act(async () => { for (const apply of publication.pending.splice(0)) apply(); });
  expect(result.current.status).toBe('loading');
  expect(result.current.state.selection).toEqual([]);
});
