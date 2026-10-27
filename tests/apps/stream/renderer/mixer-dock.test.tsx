import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MixerDock, type MixerDockProps } from '../../../../apps/stream/renderer/docks/mixer-dock';
import { MIXER_LAYOUT_STORAGE_KEY } from '../../../../apps/stream/renderer/docks/mixer-menu';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);
beforeEach(() => { window.localStorage.clear(); });

// Base UI's menu settles its floating position/open state asynchronously
// (mirrors tests/packages/ui/src/menu-entries.test.tsx).
async function settle() {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  });
}

function makeSource(id: string, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'microphone',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function renderDock(overrides: Partial<MixerDockProps> = {}) {
  const mic = makeSource('mic', { name: 'Mic' });
  const desktop = makeSource('desktop', { name: 'Desktop Audio', kind: 'desktop-audio' });
  const sources = overrides.sources ?? [mic, desktop];
  const meterLevels = overrides.meterLevels ?? { mic: 0.5, desktop: 0.1 };
  const onHide = vi.fn();
  const onOpenSettings = vi.fn();
  const onUpdateSourceSettings = vi.fn();
  render(
    <MixerDock
      onHide={onHide}
      onOpenSettings={onOpenSettings}
      sources={sources}
      meterLevels={meterLevels}
      onUpdateSourceSettings={onUpdateSourceSettings}
      {...overrides}
    />,
  );
  return { sources, meterLevels, onHide, onOpenSettings, onUpdateSourceSettings };
}

async function openTitleMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Audio Mixer options' }));
  await settle();
}

describe('MixerDock', () => {
  it('marks mixer changes as staged only in Preview mode', () => {
    renderDock({ staged: true });
    expect(screen.getByText('STAGED').closest('.mixer-stage-badge')).toHaveAttribute('title', 'Mixer changes are staged until this scene transitions to Program');

    cleanup();
    renderDock({ staged: false });
    expect(screen.queryByText('STAGED')).toBeNull();
  });

  it('renders an audio meter (role="meter") for each metered source', () => {
    renderDock();
    expect(screen.getAllByRole('meter')).toHaveLength(2);
  });

  it('skips sources with no entry in meterLevels', () => {
    renderDock({ meterLevels: { mic: 0.2 } });
    expect(screen.getAllByRole('meter')).toHaveLength(1);
  });

  it('shows the empty state when no sources have a meter level', () => {
    renderDock({ meterLevels: {} });
    expect(screen.queryAllByRole('meter')).toHaveLength(0);
    expect(screen.getByText(/microphone or capture source/i)).toBeInTheDocument();
  });

  it('opens the mixer options menu from the title-row button without calling onOpenSettings', async () => {
    const { onOpenSettings } = renderDock();
    await openTitleMenu();

    expect(screen.getByRole('menu', { name: 'Audio Mixer options' })).toBeInTheDocument();
    expect(screen.getByText('Advanced Audio Properties…')).toBeInTheDocument();
    expect(screen.getByText('Vertical Layout')).toBeInTheDocument();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('opens Advanced Audio Properties from the options menu', async () => {
    renderDock();
    await openTitleMenu();

    fireEvent.click(screen.getByText('Advanced Audio Properties…'));
    await settle();

    expect(screen.getByRole('dialog', { name: 'Advanced Audio Properties' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Mic')).toBeInTheDocument();
  });

  it('passes allAudioSources to Advanced Audio Properties when provided, falling back to the active-scene sources otherwise', async () => {
    const hiddenSceneMic = makeSource('other-mic', { name: 'Other Scene Mic' });
    renderDock({ allAudioSources: [makeSource('mic', { name: 'Mic' }), hiddenSceneMic] });
    await openTitleMenu();
    fireEvent.click(screen.getByText('Advanced Audio Properties…'));
    await settle();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Mic')).toBeInTheDocument();
    expect(within(dialog).getByText('Other Scene Mic')).toBeInTheDocument();
  });

  it('toggles Vertical Layout, persists it to localStorage, and switches the strip layout', async () => {
    renderDock();
    await openTitleMenu();

    fireEvent.click(screen.getByText('Vertical Layout'));
    await settle();

    expect(window.localStorage.getItem(MIXER_LAYOUT_STORAGE_KEY)).toBe('vertical');
    expect(document.querySelector('.mixer-strips--vertical')).not.toBeNull();

    await openTitleMenu();
    fireEvent.click(screen.getByText('Vertical Layout'));
    await settle();

    expect(window.localStorage.getItem(MIXER_LAYOUT_STORAGE_KEY)).toBe('horizontal');
    expect(document.querySelector('.mixer-strips--horizontal')).not.toBeNull();
  });

  it('restores a persisted vertical layout on mount', () => {
    window.localStorage.setItem(MIXER_LAYOUT_STORAGE_KEY, 'vertical');
    renderDock();
    expect(document.querySelector('.mixer-strips--vertical')).not.toBeNull();
  });

  it('toggles mute through onUpdateSourceSettings when onUpdateSourceAudio is absent', () => {
    const { onUpdateSourceSettings } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Mute Mic' }));
    expect(onUpdateSourceSettings).toHaveBeenCalledWith('mic', { volume: 1, muted: true });
  });

  it('prefers onUpdateSourceAudio over onUpdateSourceSettings when provided', () => {
    const onUpdateSourceAudio = vi.fn();
    const { onUpdateSourceSettings } = renderDock({ onUpdateSourceAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Mute Mic' }));
    expect(onUpdateSourceAudio).toHaveBeenCalledWith('mic', { volume: 1, muted: true });
    expect(onUpdateSourceSettings).not.toHaveBeenCalled();
  });

  it('opens a per-channel menu with Monitoring and Tracks submenus reflecting current state', async () => {
    renderDock({ sources: [makeSource('mic', { name: 'Mic', audioMonitoring: 'monitor-only', audioTracks: [1, 2] })] });
    fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    await settle();

    expect(screen.getByRole('menu', { name: 'Mic options' })).toBeInTheDocument();
    expect(screen.queryByText('Filters')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Monitoring'));
    await settle();
    const monitorOnly = screen.getByRole('menuitemcheckbox', { name: 'Monitor Only', checked: true });
    expect(monitorOnly.querySelector('svg')).not.toBeNull();
  });

  it('includes Filters in the per-channel menu only when onOpenSourceProperties is provided', async () => {
    const onOpenSourceProperties = vi.fn();
    renderDock({ onOpenSourceProperties });
    fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    await settle();

    fireEvent.click(screen.getByText('Filters'));
    await settle();
    expect(onOpenSourceProperties).toHaveBeenCalledWith('mic');
  });

  it('includes Hide in the per-channel menu only when onHideSource is provided', async () => {
    const onHideSource = vi.fn();
    renderDock({ onHideSource });
    fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    await settle();

    fireEvent.click(screen.getByText('Hide'));
    await settle();
    expect(onHideSource).toHaveBeenCalledWith('mic');
  });

  it('does not render Hide in the per-channel menu when onHideSource is absent', async () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Mic options' }));
    await settle();
    expect(screen.queryByText('Hide')).not.toBeInTheDocument();
  });
});
