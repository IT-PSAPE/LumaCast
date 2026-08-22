import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MediaLibrarySettingsPanel } from './media-library-settings-panel';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('@renderer/components/overlays/confirm-dialog', () => ({
  useConfirm: () => confirm,
}));

function stubCastApi(reclaim: () => Promise<{ removedFiles: number; freedBytes: number; keptFiles: number }>) {
  Object.defineProperty(window, 'castApi', {
    configurable: true,
    value: { reclaimMediaLibrary: vi.fn(reclaim) },
  });
  return (window as unknown as { castApi: { reclaimMediaLibrary: ReturnType<typeof vi.fn> } }).castApi;
}

describe('MediaLibrarySettingsPanel', () => {
  afterEach(() => {
    cleanup();
    confirm.mockReset();
    vi.restoreAllMocks();
  });

  it('reclaims only after the destructive consequence is confirmed', async () => {
    const api = stubCastApi(async () => ({ removedFiles: 0, freedBytes: 0, keptFiles: 0 }));
    confirm.mockResolvedValue(false);
    render(<MediaLibrarySettingsPanel />);

    screen.getByRole('button', { name: 'Reclaim unused media' }).click();

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ destructive: true });
    expect(api.reclaimMediaLibrary).not.toHaveBeenCalled();
  });

  it('reports what was removed and how much was freed', async () => {
    stubCastApi(async () => ({ removedFiles: 2, freedBytes: 3 * 1024 * 1024, keptFiles: 5 }));
    confirm.mockResolvedValue(true);
    render(<MediaLibrarySettingsPanel />);

    screen.getByRole('button', { name: 'Reclaim unused media' }).click();

    await waitFor(() => expect(screen.getByText('Removed 2 files, freed 3.0 MB')).not.toBeNull());
  });

  it('says so plainly when there was nothing to reclaim', async () => {
    stubCastApi(async () => ({ removedFiles: 0, freedBytes: 0, keptFiles: 9 }));
    confirm.mockResolvedValue(true);
    render(<MediaLibrarySettingsPanel />);

    screen.getByRole('button', { name: 'Reclaim unused media' }).click();

    await waitFor(() => expect(screen.getByText('Nothing to reclaim')).not.toBeNull());
  });

  it('surfaces a failure instead of leaving the button spinning', async () => {
    stubCastApi(async () => {
      throw new Error('denied');
    });
    confirm.mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MediaLibrarySettingsPanel />);

    screen.getByRole('button', { name: 'Reclaim unused media' }).click();

    await waitFor(() => expect(screen.getByText('Could not reclaim unused media.')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Reclaim unused media' })).not.toBeNull();
  });
});
