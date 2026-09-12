import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@lumacast/kernel';
import type { Slide } from '@lumacast/composition';
import type { AudioSlideMarker } from '@lumacast/automation';
import {
  assignUnassignedMarkers,
  AudioSyncEditor,
  MarkerRow,
  canEnableAudioSync,
  reassignMarkersForSlides,
  type AudioSyncController,
} from '../../../../../app/renderer/features/playback/audio-sync-editor';

vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: { workbenchMode: 'show' },
    actions: {},
    overlayStack: {
      rootElement: null as HTMLElement | null,
      stack: [] as string[],
      baseZIndex: 100,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback/playback-context', () => ({
  useAudio: () => ({
    currentAudioAsset: null,
    currentAudioAssetId: null,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    loopEnabled: false,
    muted: false,
    getCurrentTime: () => 0,
    armAudio: vi.fn(),
    clearAudio: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn(),
    seekTo: vi.fn(),
    selectAudio: vi.fn(),
    toggleLoop: vi.fn(),
    toggleMuted: vi.fn(),
    togglePlayback: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback-schedules-context', () => ({
  usePlaybackSchedules: () => ({
    schedules: [],
    saveSchedule: vi.fn(async () => undefined),
    deleteSchedule: vi.fn(async () => undefined),
    syncSuspended: false,
    resumeSync: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ lyrics: [], presentations: [], slidesForItemRef: () => [] }),
}));

function makeMarker(id: string, timeMs: number, slideId: string | null = null): AudioSlideMarker {
  return { id: id as Id, timeMs, slideId: slideId as Id | null };
}

const slides = [{ id: 's1' as Id, order: 0 }, { id: 's2' as Id, order: 1 }] as Slide[];

function makeController(overrides: Partial<AudioSyncController> = {}): AudioSyncController {
  return {
    assetId: 'audio-1' as Id,
    enabled: false,
    itemRef: null,
    markers: [],
    error: null,
    syncSuspended: false,
    candidateItems: [],
    boundSlides: [],
    hasSavedSchedule: false,
    record: vi.fn(),
    setEnabled: vi.fn(),
    setItemRef: vi.fn(),
    setMarkerSlide: vi.fn(),
    setMarkerTime: vi.fn(),
    removeMarker: vi.fn(),
    seekToMarker: vi.fn(),
    removeSchedule: vi.fn(),
    resumeSync: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('assignUnassignedMarkers', () => {
  it('assigns unassigned markers sequentially in slide order', () => {
    const markers = [makeMarker('m1', 1000), makeMarker('m2', 2000), makeMarker('m3', 3000)];
    const assigned = assignUnassignedMarkers(markers, ['s1' as Id, 's2' as Id]);
    expect(assigned.map((marker) => marker.slideId)).toEqual(['s1', 's2', 's1']);
  });

  it('wraps to allow repeats when there are more markers than slides', () => {
    const assigned = assignUnassignedMarkers([makeMarker('m1', 1000)], ['s1' as Id]);
    expect(assigned[0]?.slideId).toBe('s1');
  });

  it('leaves already-assigned markers untouched and assigns the unassigned one by position', () => {
    const markers = [makeMarker('m1', 1000, 's2'), makeMarker('m2', 2000)];
    const assigned = assignUnassignedMarkers(markers, ['s1' as Id, 's2' as Id]);
    expect(assigned.map((marker) => marker.slideId)).toEqual(['s2', 's2']);
  });

  it('assigns a lone new marker by its chronological position, not the first slide', () => {
    const markers = [makeMarker('m1', 1000, 's1'), makeMarker('m2', 2000)];
    const assigned = assignUnassignedMarkers(markers, ['s1' as Id, 's2' as Id]);
    expect(assigned.map((marker) => marker.slideId)).toEqual(['s1', 's2']);
  });

  it('keeps markers unassigned when no slides exist', () => {
    const assigned = assignUnassignedMarkers([makeMarker('m1', 1000)], []);
    expect(assigned.map((marker) => marker.slideId)).toEqual([null]);
  });
});

describe('reassignMarkersForSlides', () => {
  it('clears stale ids and reassigns every marker by chronological position', () => {
    const markers = [makeMarker('m1', 1000, 'old-1'), makeMarker('m2', 2000, 'old-2')];
    const reassigned = reassignMarkersForSlides(markers, ['s3' as Id, 's4' as Id]);
    expect(reassigned.map((marker) => marker.slideId)).toEqual(['s3', 's4']);
  });

  it('clears every slide id when the new item has no slides', () => {
    const markers = [makeMarker('m1', 1000, 'old-1')];
    expect(reassignMarkersForSlides(markers, []).map((marker) => marker.slideId)).toEqual([null]);
  });
});

describe('canEnableAudioSync', () => {
  const itemRef = { type: 'lyric' as const, id: 'song-1' as Id };
  it('requires an item, markers, and all-valid destinations', () => {
    expect(canEnableAudioSync({ enabled: false, itemRef: null, markers: [makeMarker('m1', 1000, 's1')] }, slides)).toBe(false);
    expect(canEnableAudioSync({ enabled: false, itemRef, markers: [] }, slides)).toBe(false);
    expect(canEnableAudioSync({ enabled: false, itemRef, markers: [makeMarker('m1', 1000)] }, slides)).toBe(false);
    expect(canEnableAudioSync({ enabled: false, itemRef, markers: [makeMarker('m1', 1000, 'missing' as Id)] }, slides)).toBe(false);
    expect(canEnableAudioSync({ enabled: false, itemRef, markers: [makeMarker('m1', 1000, 's1')] }, slides)).toBe(true);
  });
});

describe('AudioSyncEditor', () => {
  it('renders nothing without an asset', () => {
    const { container } = render(<AudioSyncEditor controller={makeController({ assetId: null })} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps an empty schedule compact without a permanent marker list', () => {
    render(<AudioSyncEditor controller={makeController()} />);
    expect(screen.queryByText('No markers')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Audio sync' })).not.toBeNull();
  });

  it('toggles the sync switch and reflects aria-checked, as a real focusable button', () => {
    const controller = makeController({ enabled: false });
    const { rerender } = render(<AudioSyncEditor controller={controller} />);
    const toggle = screen.getByRole('switch', { name: 'Audio sync' });
    // A native <button> gets Space/Enter activation for free from the browser
    // (jsdom does not simulate that default action), so this confirms the
    // element keyboard users would actually operate is a real, focusable button.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).not.toBeDisabled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(controller.setEnabled).toHaveBeenCalledWith(true);

    const enabledController = makeController({ enabled: true });
    rerender(<AudioSyncEditor controller={enabledController} />);
    const enabledToggle = screen.getByRole('switch', { name: 'Audio sync' });
    expect(enabledToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(enabledToggle);
    expect(enabledController.setEnabled).toHaveBeenCalledWith(false);
  });

  it('renders each marker with editable time, formatted label, seek and remove controls', () => {
    const controller = makeController({
      itemRef: { type: 'lyric', id: 'song-1' },
      boundSlides: slides,
      markers: [
        makeMarker('m1', 1000, 's1'),
        makeMarker('m2', 3000, 's2'),
      ],
    });
    render(<>{controller.markers.map((marker, index) => <MarkerRow key={marker.id} marker={marker} index={index} controller={controller} />)}</>);

    const timeInput = screen.getByLabelText('Marker 1 time in seconds') as HTMLInputElement;
    expect(timeInput.value).toBe('1');
    expect(screen.getByLabelText('Marker 1 slide').textContent).toContain('Slide 1');
    expect(screen.getByLabelText('Marker 2 slide').textContent).toContain('Slide 2');
    expect(screen.getByText('0:01')).not.toBeNull();
    expect(screen.getByText('0:03')).not.toBeNull();

    fireEvent.change(timeInput, { target: { value: '2.5' } });
    expect(controller.setMarkerTime).toHaveBeenCalledWith('m1', 2.5);

    const seekButtons = screen.getAllByRole('button', { name: 'Seek to marker' });
    fireEvent.click(seekButtons[0]!);
    expect(controller.seekToMarker).toHaveBeenCalledWith(1000);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove marker' })[0]!);
    expect(controller.removeMarker).toHaveBeenCalledWith('m1');
  });

  it('keeps an editable raw time value so clearing the field never commits zero', () => {
    const controller = makeController({ markers: [makeMarker('m1', 1000, 's1')] });
    render(<>{controller.markers.map((marker, index) => <MarkerRow key={marker.id} marker={marker} index={index} controller={controller} />)}</>);
    const timeInput = screen.getByLabelText('Marker 1 time in seconds') as HTMLInputElement;
    fireEvent.change(timeInput, { target: { value: '' } });
    expect(controller.setMarkerTime).not.toHaveBeenCalled();
    expect(timeInput.value).toBe('');

    fireEvent.change(timeInput, { target: { value: '2.' } });
    expect(controller.setMarkerTime).toHaveBeenCalledWith('m1', 2);
    expect(timeInput.value).toBe('2.');
  });

  it('ignores negative or non-numeric time edits', () => {
    const controller = makeController({ markers: [makeMarker('m1', 1000, 's1')] });
    render(<>{controller.markers.map((marker, index) => <MarkerRow key={marker.id} marker={marker} index={index} controller={controller} />)}</>);
    const timeInput = screen.getByLabelText('Marker 1 time in seconds') as HTMLInputElement;
    fireEvent.change(timeInput, { target: { value: '-1' } });
    fireEvent.change(timeInput, { target: { value: 'abc' } });
    expect(controller.setMarkerTime).not.toHaveBeenCalled();
  });

  it('labels unassigned markers and lets the slide dropdown reassign with repeats', () => {
    const controller = makeController({
      itemRef: { type: 'presentation', id: 'deck-1' },
      boundSlides: slides,
      markers: [
        makeMarker('m1', 1000, 's2'),
        makeMarker('m2', 3000),
      ],
    });
    render(<>{controller.markers.map((marker, index) => <MarkerRow key={marker.id} marker={marker} index={index} controller={controller} />)}</>);

    expect(screen.getByLabelText('Marker 1 slide').textContent).toContain('Slide 2');
    expect(screen.getByLabelText('Marker 2 slide').textContent).toContain('Unassigned');

    fireEvent.click(screen.getByLabelText('Marker 2 slide'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Slide 1' }));
    expect(controller.setMarkerSlide).toHaveBeenCalledWith('m2', 's1');
  });

  it('shows the bound item in the bind trigger', () => {
    const controller = makeController({
      itemRef: { type: 'lyric', id: 'song-1' },
      candidateItems: [
        { itemRef: { type: 'lyric', id: 'song-1' }, title: 'Song' },
        { itemRef: { type: 'presentation', id: 'deck-1' }, title: 'Deck' },
      ],
    });
    render(<AudioSyncEditor controller={controller} />);
    expect(screen.getByLabelText('Bind item').textContent).toContain('Song');

    fireEvent.click(screen.getByLabelText('Bind item'));
    expect(screen.getByRole('menuitem', { name: 'No item' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Deck' })).not.toBeNull();
  });

  it('still shows the bind trigger without an item selected', () => {
    render(<AudioSyncEditor controller={makeController()} />);
    expect(screen.getByLabelText('Bind item').textContent).toContain('No item');
  });

  it('surfaces a resume affordance while sync is suspended', () => {
    const controller = makeController({ syncSuspended: true });
    render(<AudioSyncEditor controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume sync' }));
    expect(controller.resumeSync).toHaveBeenCalled();
  });

  it('shows a plain label without a slide dropdown until an item with slides is bound', () => {
    const controller = makeController({ markers: [makeMarker('m1', 1000)] });
    render(<>{controller.markers.map((marker, index) => <MarkerRow key={marker.id} marker={marker} index={index} controller={controller} />)}</>);
    expect(screen.queryByLabelText('Marker 1 slide')).toBeNull();
    expect(screen.getByText('Unassigned')).not.toBeNull();
  });
});