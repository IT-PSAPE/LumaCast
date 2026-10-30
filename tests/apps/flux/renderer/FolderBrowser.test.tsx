import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderBrowser } from '../../../../apps/flux/renderer/FolderBrowser';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const listing = {
  path: '/photos', parent: '/',
  folders: [{ name: 'Wedding', path: '/photos/Wedding' }],
  files: [{ name: 'portrait.jpg', path: '/photos/portrait.jpg' }],
};

function setup(onImport = vi.fn(async (_paths: string[]) => {})) {
  const chooseDirectory = vi.fn(async (): Promise<string | null> => '/photos');
  const command = vi.fn(async () => listing);
  const onError = vi.fn();
  Object.defineProperty(window, 'lumaflux', {
    configurable: true, value: { chooseDirectory, command },
  });
  render(<FolderBrowser onImport={onImport} onError={onError} />);
  return { chooseDirectory, command, onError, onImport };
}

describe('Flux folder browser operations', () => {
  it('locks navigation and imports until an import finishes', async () => {
    const pending = deferred<void>();
    const onImport = vi.fn(() => pending.promise);
    const { command } = setup(onImport);
    fireEvent.click(screen.getByRole('button', { name: 'Explore folders' }));
    const file = await screen.findByRole('button', { name: 'portrait.jpg' });
    fireEvent.click(file);
    fireEvent.click(file);
    fireEvent.click(screen.getByRole('button', { name: 'Wedding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import this folder' }));
    expect(onImport).toHaveBeenCalledExactlyOnceWith(['/photos/portrait.jpg']);
    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Explore folders' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Parent folder' })).toBeDisabled();
    pending.resolve();
    await waitFor(() => expect(file).toBeEnabled());
  });

  it('reports an import failure and allows retry without losing the listing', async () => {
    const onImport = vi.fn(async (_paths: string[]) => {});
    onImport.mockRejectedValueOnce(new Error('Import failed'));
    const { onError } = setup(onImport);
    fireEvent.click(screen.getByRole('button', { name: 'Explore folders' }));
    const file = await screen.findByRole('button', { name: 'portrait.jpg' });
    fireEvent.click(file);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Import failed'));
    await waitFor(() => expect(file).toBeEnabled());
    fireEvent.click(file);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
  });

  it('does not open overlapping directory pickers and unlocks after cancellation', async () => {
    const pending = deferred<string | null>();
    const { chooseDirectory, command } = setup();
    chooseDirectory.mockImplementationOnce(() => pending.promise);
    const explore = screen.getByRole('button', { name: 'Explore folders' });
    fireEvent.click(explore);
    fireEvent.click(explore);
    expect(chooseDirectory).toHaveBeenCalledTimes(1);
    pending.resolve(null);
    await waitFor(() => expect(explore).toBeEnabled());
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(explore);
    expect(await screen.findByRole('button', { name: 'portrait.jpg' })).toBeEnabled();
  });
});
