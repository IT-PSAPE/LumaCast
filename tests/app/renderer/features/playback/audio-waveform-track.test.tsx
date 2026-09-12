import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AudioWaveformTrack } from '../../../../../app/renderer/features/playback/audio-waveform-track';
import type { AudioSyncController } from '../../../../../app/renderer/features/playback/audio-sync-editor';
vi.mock('../../../../../app/renderer/features/playback/use-audio-waveform', () => ({ useAudioWaveform: () => ({ peaks: [.25, 1, .5], status: 'ready' }) }));
vi.mock('../../../../../app/renderer/components/overlays/popover', () => ({ Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
afterEach(cleanup);
it('shows markers on the waveform and opens only the selected marker editor', () => {
  const controller: AudioSyncController = {
    assetId: 'a', enabled: false, itemRef: null, markers: [{ id: 'm', timeMs: 1000, slideId: null }], error: null,
    syncSuspended: false, candidateItems: [], boundSlides: [], hasSavedSchedule: true,
    record: vi.fn(), setEnabled: vi.fn(), setItemRef: vi.fn(), setMarkerSlide: vi.fn(), setMarkerTime: vi.fn(), removeMarker: vi.fn(),
    seekToMarker: vi.fn(), removeSchedule: vi.fn(), resumeSync: vi.fn(),
  };
  const seek = vi.fn();
  const view = render(<AudioWaveformTrack duration={10} currentTime={0} disabled={false} controller={controller} onSeek={seek} onScrubStart={vi.fn()} onScrubEnd={vi.fn()} />);
  expect(view.container.querySelector('svg path')?.getAttribute('d')).toContain('M');
  expect(screen.queryByLabelText('Marker 1 time in seconds')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Marker 1, 0:01, Unassigned' }));
  expect(controller.seekToMarker).toHaveBeenCalledWith(1000);
  expect(screen.getByLabelText('Marker 1 time in seconds')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove marker' }));
  expect(controller.removeMarker).toHaveBeenCalledWith('m');
  fireEvent.change(screen.getByLabelText('Audio scrubber'), { target: { value: '3.25' } });
  expect(seek).toHaveBeenCalledWith(3.25);
});
