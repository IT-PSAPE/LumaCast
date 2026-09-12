import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaAsset } from '@lumacast/composition';
import { MediaPickerDialog } from '@renderer/components/overlays/media-picker-dialog';
import { overlayStackStore } from './workbench-overlay-stack';

vi.mock('@renderer/contexts/workbench-context', () => import('./workbench-overlay-stack'));
vi.mock('@renderer/components/overlays/media-thumbnail', () => ({ MediaThumbnail: () => null }));

function asset(id: string, name: string, type: MediaAsset['type'] = 'image'): MediaAsset {
  return { id, name, type, src: `${id}.png`, width: 16, height: 9, duration: null, codec: null, order: 0, createdAt: '', updatedAt: '' };
}

const assets = [asset('a1', 'Logo'), asset('a2', 'Backdrop'), asset('a3', 'Clip', 'video')];

afterEach(() => {
  cleanup();
  overlayStackStore.reset();
});

describe('MediaPickerDialog', () => {
  it('offers the matching assets as pressable tiles and confirms the selection', async () => {
    const onConfirm = vi.fn();
    render(<MediaPickerDialog assets={assets} kind="image" onConfirm={onConfirm} onClose={() => {}} onImportAssets={async () => {}} />);

    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /Clip/ })).toBeNull();

    const tile = screen.getByRole('button', { name: /Logo/ });
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add (1)' }));
    expect(onConfirm).toHaveBeenCalledWith([assets[0]]);
  });

  it('nests the upload dialog inside the picker, so Escape dismisses only the top one', async () => {
    const onClose = vi.fn();
    render(<MediaPickerDialog assets={assets} kind="image" onConfirm={() => {}} onClose={onClose} onImportAssets={async () => {}} />);
    await screen.findByRole('heading', { name: 'Add Image Element' });

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByRole('heading', { name: 'Upload Images' });
    expect(overlayStackStore.entries).toHaveLength(2);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Upload Images' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Add Image Element' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
