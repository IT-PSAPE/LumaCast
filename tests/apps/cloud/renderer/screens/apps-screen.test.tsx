import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMockApi } from '../../../../../apps/cloud/renderer/mock-api';
import { useSuite } from '../../../../../apps/cloud/renderer/hooks/use-suite';
import { AppsScreen } from '../../../../../apps/cloud/renderer/screens/apps-screen';
import type { CloudDesktopAPI } from '../../../../../apps/cloud/shared/desktop-api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ api }: { api: CloudDesktopAPI }) {
  const { overview, operations, refresh } = useSuite(api);
  if (!overview) return null;
  return <AppsScreen overview={overview} operations={operations} api={api} refresh={refresh} />;
}

describe('AppsScreen', () => {
  it("shows every app's card with its derived status", async () => {
    const api = createMockApi();
    render(<Harness api={api} />);

    expect(await screen.findByText('LumaCast')).toBeInTheDocument();
    expect(screen.getByText('Update available 0.1.26 → 0.1.27')).toBeInTheDocument();

    expect(screen.getByText('Lumaflux')).toBeInTheDocument();
    // Chord also ships no releases and isn't installed, so 'Not installed'
    // renders on two cards (Lumaflux and LumaChord) — scope to Lumaflux's
    // own card instead of asserting on the ambiguous shared text.
    const fluxCard = screen.getByText('Lumaflux').closest('.rounded-lg') as HTMLElement;
    expect(fluxCard).not.toBeNull();
    expect(within(fluxCard).getByText('Not installed')).toBeInTheDocument();
    expect(screen.getAllByText('Not installed')).toHaveLength(2);

    expect(screen.getByText('LumaCloud')).toBeInTheDocument();
    expect(screen.getByText('Installed 0.1.0')).toBeInTheDocument();
  });

  it("opens the permission dialog when an ungranted app's Install is clicked", async () => {
    const api = createMockApi();
    render(<Harness api={api} />);

    await screen.findByText('Lumaflux');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(await screen.findByText('Allow LumaCloud to manage Lumaflux?')).toBeInTheDocument();
    expect(screen.getByText('app.lumaflux.desktop')).toBeInTheDocument();
  });

  it('Allow grants the app and then runs the original install', async () => {
    const api = createMockApi();
    const grantSpy = vi.spyOn(api, 'grant');
    const installSpy = vi.spyOn(api, 'install');

    render(<Harness api={api} />);

    await screen.findByText('Lumaflux');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Allow LumaCloud to manage Lumaflux?');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
      // Flush the microtask queue: `onAllow` awaits `api.grant(app)` before it
      // runs the original install action.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(grantSpy).toHaveBeenCalledWith('flux');
    expect(installSpy).toHaveBeenCalledWith('flux', undefined);
    expect(grantSpy.mock.invocationCallOrder[0]).toBeLessThan(installSpy.mock.invocationCallOrder[0]);

    await waitFor(() => expect(screen.queryByText('Allow LumaCloud to manage Lumaflux?')).not.toBeInTheDocument());

    // The mock advances a queued/downloading install on a real timer; cancel
    // it so nothing keeps ticking after the test (and the suite) ends.
    const operation = await installSpy.mock.results[0]!.value;
    await api.cancel(operation.id);
  });
});
