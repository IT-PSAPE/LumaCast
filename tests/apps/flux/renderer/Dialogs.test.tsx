import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OverlayStackProvider } from '@lumacast/ui';
import type { AgentSettings } from '@lumacast/photo-model';
import type { DesktopAPI } from '../../../../apps/flux/shared/desktop-api';
import { AgentDialog, ExportDialog } from '../../../../apps/flux/renderer/Dialogs';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settings: AgentSettings = {
  enabled: true, roots: ['/photos'], configPath: '/config', clientConfig: '{}',
};
function apiMock(): DesktopAPI {
  return {
    platform: 'win32', command: vi.fn(), preview: vi.fn(),
    assetUrl: vi.fn(), pathsForFiles: vi.fn(),
    chooseImport: vi.fn(async () => []), chooseDirectory: vi.fn(async () => null),
    chooseRelink: vi.fn(async () => null),
    onChange: vi.fn(() => vi.fn()), onMenuCommand: vi.fn(() => vi.fn()),
    settings: vi.fn(async () => settings), updateSettings: vi.fn(async () => settings),
  };
}

describe('Flux dialog failure and concurrency flows', () => {
  it('recovers from a failed folder picker and a failed export without closing', async () => {
    const api = apiMock();
    vi.mocked(api.chooseDirectory).mockRejectedValueOnce(new Error('Folder unavailable'));
    const onClose = vi.fn();
    const onExport = vi.fn().mockRejectedValueOnce(new Error('Not writable')).mockResolvedValueOnce(undefined);
    render(<OverlayStackProvider><ExportDialog open count={2} api={api} onClose={onClose} onExport={onExport} /></OverlayStackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Choose export folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder unavailable');
    fireEvent.change(screen.getByRole('textbox', { name: 'Export destination' }), { target: { value: '/exports' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export photos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not writable');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export photos' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onExport).toHaveBeenCalledTimes(2);
  });

  it('starts a batch once and blocks dismissal while the request is pending', async () => {
    const api = apiMock();
    const pending = deferred<void>();
    const onClose = vi.fn();
    const onExport = vi.fn(() => pending.promise);
    render(<OverlayStackProvider><ExportDialog open count={1} api={api} onClose={onClose} onExport={onExport} /></OverlayStackProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Export destination' }), { target: { value: '/exports' } });
    const submit = screen.getByRole('button', { name: 'Export photos' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Export destination' })).toBeDisabled();
    await act(async () => pending.resolve());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks duplicate folder pickers and recovers when the picker is cancelled', async () => {
    const api = apiMock();
    const pending = deferred<string | null>();
    vi.mocked(api.chooseDirectory).mockReturnValueOnce(pending.promise);
    render(<OverlayStackProvider><ExportDialog open count={1} api={api} onClose={vi.fn()} onExport={vi.fn()} /></OverlayStackProvider>);
    const choose = screen.getByRole('button', { name: 'Choose export folder' });
    fireEvent.click(choose);
    fireEvent.click(choose);
    expect(api.chooseDirectory).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(null));
    expect(choose).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export photos' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserves the settings-update error when recovery also fails, and permits retry', async () => {
    const api = apiMock();
    vi.mocked(api.settings).mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('Refresh unavailable'));
    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('Grant rejected'));
    vi.mocked(api.chooseDirectory).mockResolvedValue('/new-photos');
    render(<OverlayStackProvider><AgentDialog open api={api} onClose={vi.fn()} /></OverlayStackProvider>);
    const add = await screen.findByRole('button', { name: 'Add folder' });
    fireEvent.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('Grant rejected');
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
    expect(api.updateSettings).toHaveBeenLastCalledWith(true, ['/photos', '/new-photos']);
  });

  it('ignores an obsolete settings response after the dialog is reopened', async () => {
    const api = apiMock();
    const stale = deferred<AgentSettings>();
    vi.mocked(api.settings).mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ ...settings, roots: ['/current'] });
    const onClose = vi.fn();
    const view = render(<OverlayStackProvider><AgentDialog open api={api} onClose={onClose} /></OverlayStackProvider>);
    view.rerender(<OverlayStackProvider><AgentDialog open={false} api={api} onClose={onClose} /></OverlayStackProvider>);
    view.rerender(<OverlayStackProvider><AgentDialog open api={api} onClose={onClose} /></OverlayStackProvider>);
    expect(await screen.findByRole('button', { name: 'Remove /current' })).toBeTruthy();
    await act(async () => stale.resolve({ ...settings, roots: ['/obsolete'] }));
    expect(screen.queryByRole('button', { name: 'Remove /obsolete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove /current' })).toBeTruthy();
  });
});
