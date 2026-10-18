import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AdvancedAudioDialog } from '../../../../apps/stream/renderer/dialogs/advanced-audio-dialog';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

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

// Base UI's Select settles its floating position/open state asynchronously
// (mirrors tests/packages/ui/src/select.test.tsx).
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('AdvancedAudioDialog', () => {
  it('renders a row per audio source with its name', () => {
    render(
      <AdvancedAudioDialog
        sources={[makeSource('Mic'), makeSource('Desktop Audio')]}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Advanced Audio Properties' })).toBeInTheDocument();
    expect(screen.getByText('Mic')).toBeInTheDocument();
    expect(screen.getByText('Desktop Audio')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 sources
  });

  it('shows an empty state when there are no audio sources', () => {
    render(<AdvancedAudioDialog sources={[]} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('No audio sources')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reports a volume change as a 0..2 multiplier (150% -> 1.5)', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic')]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const volumeInput = screen.getByRole('spinbutton', { name: 'Mic volume' });
    fireEvent.change(volumeInput, { target: { value: '150' } });
    expect(onUpdate).toHaveBeenCalledWith('Mic', { volume: 1.5 });
  });

  it('clamps volume input to the 0..200% range', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic')]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const volumeInput = screen.getByRole('spinbutton', { name: 'Mic volume' });
    fireEvent.change(volumeInput, { target: { value: '500' } });
    expect(onUpdate).toHaveBeenCalledWith('Mic', { volume: 2 });
  });

  it('toggles mute from the row-start icon button', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic', { muted: false })]} onUpdate={onUpdate} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute Mic' }));
    expect(onUpdate).toHaveBeenCalledWith('Mic', { muted: true });
  });

  it('snaps balance to dead centre near 0 and otherwise reports a -1..1 value', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic')]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const balanceInput = screen.getByRole('slider', { name: 'Mic balance' });

    fireEvent.change(balanceInput, { target: { value: '50' } });
    expect(onUpdate).toHaveBeenLastCalledWith('Mic', { balance: 0.5 });

    fireEvent.change(balanceInput, { target: { value: '2' } });
    expect(onUpdate).toHaveBeenLastCalledWith('Mic', { balance: 0 });
  });

  it('patches audioTracks when a track checkbox is toggled', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic', { audioTracks: [1] })]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const row = screen.getByText('Mic').closest('tr')!;
    fireEvent.click(within(row).getByRole('checkbox', { name: '2' }));
    expect(onUpdate).toHaveBeenCalledWith('Mic', { audioTracks: [1, 2] });
  });

  it('removes a track from audioTracks when unchecked', () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic', { audioTracks: [1, 2] })]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const row = screen.getByText('Mic').closest('tr')!;
    fireEvent.click(within(row).getByRole('checkbox', { name: '2' }));
    expect(onUpdate).toHaveBeenCalledWith('Mic', { audioTracks: [1] });
  });

  it('patches audioMonitoring when a new option is selected', async () => {
    const onUpdate = vi.fn();
    render(<AdvancedAudioDialog sources={[makeSource('Mic', { audioMonitoring: 'off' })]} onUpdate={onUpdate} onClose={vi.fn()} />);
    const trigger = screen.getByRole('combobox', { name: 'Mic audio monitoring' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await settle();

    // Highlight moves from "Monitor Off" (current value) to "Monitor Only".
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'ArrowDown' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Enter' });
    await settle();

    expect(onUpdate).toHaveBeenCalledWith('Mic', { audioMonitoring: 'monitor-only' });
  });

  it('restores focus to the opener control on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const openerRef = { current: opener };

    const { unmount } = render(
      <AdvancedAudioDialog sources={[makeSource('Mic')]} onUpdate={vi.fn()} onClose={vi.fn()} openerRef={openerRef} />,
    );
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
