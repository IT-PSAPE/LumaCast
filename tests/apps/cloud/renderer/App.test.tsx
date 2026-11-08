import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../../../apps/cloud/renderer/App';
import { createMockApi } from '../../../../apps/cloud/renderer/mock-api';
import type { OperationSnapshot, SuiteOverview } from '../../../../apps/cloud/shared/desktop-api';

afterEach(() => {
  cleanup();
  delete window.lumacloud;
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Cloud startup and recovery', () => {
  it('keeps window chrome and announces loading until an overview arrives', async () => {
    const api = createMockApi();
    const overview = await api.overview();
    const pending = deferred<SuiteOverview>();
    vi.spyOn(api, 'overview').mockReturnValueOnce(pending.promise);
    window.lumacloud = api;

    render(<App />);

    expect(screen.getByText('LumaCloud')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading apps…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    await act(async () => pending.resolve(overview));
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.queryByText('Loading apps…')).not.toBeInTheDocument();
  });

  it('shows an actionable startup error and retries the local snapshots', async () => {
    const api = createMockApi();
    const overview = vi.spyOn(api, 'overview').mockRejectedValueOnce(new Error('Bridge unavailable'));
    const refresh = vi.spyOn(api, 'refresh');
    window.lumacloud = api;
    render(<App />);

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Could not load LumaCloud');
    expect(error).toHaveTextContent('Bridge unavailable');
    expect(screen.getByText('LumaCloud')).toBeInTheDocument();
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(overview).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the app list usable when activity history fails and clears the warning after retry', async () => {
    const api = createMockApi();
    const operations = vi.spyOn(api, 'operations').mockRejectedValueOnce(new Error('History unavailable'));
    window.lumacloud = api;
    render(<App />);

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Could not load activity. History unavailable');
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Activity unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(operations).toHaveBeenCalledTimes(2);
  });

  it('keeps activity unavailable when both snapshot retries fail with a usable overview retained', async () => {
    const api = createMockApi();
    const initialOverview = await api.overview();
    vi.spyOn(api, 'overview')
      .mockResolvedValueOnce(initialOverview)
      .mockRejectedValueOnce(new Error('App status unavailable'));
    vi.spyOn(api, 'operations').mockRejectedValue(new Error('History unavailable'));
    window.lumacloud = api;
    render(<App />);
    const firstError = await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Activity unavailable')).toBeInTheDocument();

    fireEvent.click(within(firstError).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load apps. App status unavailable'));
    expect(screen.getByText('Activity unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apps' }));
    expect(screen.getByText('Installed 0.1.0')).toBeInTheDocument();
  });

  it('distinguishes pending activity history from an empty history', async () => {
    const api = createMockApi();
    const pending = deferred<OperationSnapshot[]>();
    vi.spyOn(api, 'operations').mockReturnValueOnce(pending.promise);
    window.lumacloud = api;
    render(<App />);
    await screen.findByRole('heading', { name: 'Apps' });

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(screen.getByText('Loading activity…')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
    await act(async () => pending.resolve([]));
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByText('Loading activity…')).not.toBeInTheDocument();
  });

  it('keeps the current screen on refresh failure and retries the catalog action', async () => {
    const api = createMockApi();
    const overview = await api.overview();
    const refresh = vi.spyOn(api, 'refresh')
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(overview);
    window.lumacloud = api;
    render(<App />);
    await screen.findByRole('heading', { name: 'Apps' });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Could not refresh apps. Network unavailable');
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getByText('Installed 0.1.0')).toBeInTheDocument();
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
  });
});
