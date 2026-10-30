import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMockApi } from '../../../../../apps/cloud/renderer/mock-api';
import { SettingsScreen } from '../../../../../apps/cloud/renderer/screens/settings-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Cloud SettingsScreen', () => {
  it('lets the user disable background update checks', async () => {
    const api = createMockApi();
    const overview = await api.overview();
    const updateSettings = vi.spyOn(api, 'updateSettings');
    render(<SettingsScreen overview={overview} api={api} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Check for updates in background' }));

    expect(updateSettings).toHaveBeenCalledWith({ checkInBackground: false });
  });
});
