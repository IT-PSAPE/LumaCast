import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OverlayStackProvider } from '@lumacast/ui';
import { NdiDialog } from '../../../../apps/stream/renderer/dialogs/ndi-dialog';
import type { StreamNdiAPI } from '../../../../apps/stream/shared/ndi';

afterEach(cleanup);
const props = () => ({ onClose: vi.fn(), onSelect: vi.fn(), sending: false, starting: false,
  onStart: vi.fn(async () => {}), onStop: vi.fn(async () => {}) });
function apiMock(): StreamNdiAPI {
  return { discover: vi.fn(async () => [{ name: 'Camera A', urlAddress: '127.0.0.1:5961' }]),
    startReceive: vi.fn(), readFrame: vi.fn(), stopReceive: vi.fn(), startSend: vi.fn(),
    sendVideo: vi.fn(), sendAudio: vi.fn(), stopSend: vi.fn() };
}

describe('NDI controls', () => {
  it('discovers a source and forwards its exact identity under StrictMode', async () => {
    const api = apiMock(); const callbacks = props();
    render(<StrictMode><OverlayStackProvider><NdiDialog {...callbacks} api={api} mode="input" /></OverlayStackProvider></StrictMode>);
    fireEvent.click(await screen.findByRole('button', { name: 'Camera A' }));
    expect(callbacks.onSelect).toHaveBeenCalledWith({ name: 'Camera A', urlAddress: '127.0.0.1:5961' });
    expect(screen.getByRole('button', { name: 'Refresh sources' })).toBeEnabled();
  });

  it('reports a missing runtime and allows discovery to be retried', async () => {
    const api = apiMock();
    vi.mocked(api.discover).mockRejectedValueOnce(new Error('NDI runtime is not installed'));
    render(<OverlayStackProvider><NdiDialog {...props()} api={api} mode="input" /></OverlayStackProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('NDI runtime is not installed');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
    expect(await screen.findByRole('button', { name: 'Camera A' })).toBeTruthy();
  });

  it('does not start output automatically and provides an independent stop action', async () => {
    const api = apiMock(); const callbacks = props();
    const view = render(<OverlayStackProvider><NdiDialog {...callbacks} api={api} mode="output" /></OverlayStackProvider>);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start NDI output' })).toBeDisabled();
    view.rerender(<OverlayStackProvider><NdiDialog {...callbacks} sending api={api} mode="output" /></OverlayStackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Stop NDI output' }));
    await waitFor(() => expect(callbacks.onStop).toHaveBeenCalledTimes(1));
  });
});
