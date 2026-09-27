import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
} from '../../../../../../apps/cast/renderer/features/playback/audio-sync-editor';

vi.mock('../../../../../../apps/cast/renderer/contexts/workbench-context', () => ({
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

vi.mock('../../../../../../apps/cast/renderer/contexts/playback/playback-context', () => ({
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

vi.mock('../../../../../../apps/cast/renderer/contexts/playback-schedules-context', () => ({
  usePlaybackSchedules: () => ({
    schedules: [],
    saveSchedule: vi.fn(async () => undefined),
    deleteSchedule: vi.fn(async () => undefined),
    syncSuspended: false,
    resumeSync: vi.fn(),
  }),
}));

// `vi.mock` factories are hoisted above every other module-scope statement,
// so the map they close over must be created through `vi.hoisted` rather
// than a plain top-level `const` (which would still be uninitialized).
const { liveSlideElementsBySlideId } = vi.hoisted(() => ({
  liveSlideElementsBySlideId: new Map<string, unknown[]>(),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({
    lyrics: [],
    presentations: [],
    slidesForItemRef: () => [],
    liveSlideElementsBySlideId,
  }),
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

beforeEach(() => {
  liveSlideElementsBySlideId.clear();
  window.castApi = {
    exportTextFile: vi.fn(async () => ({ path: '/tmp/export.csv' })),
  } as unknown as typeof window.castApi;
});

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

  describe('export lyrics', () => {
    const itemRef = { type: 'lyric' as const, id: 'song-1' as Id };

    function makeExportableController(overrides: Partial<AudioSyncController> = {}): AudioSyncController {
      return makeController({
        itemRef,
        boundSlides: slides,
        candidateItems: [{ itemRef, title: 'My Song' }],
        markers: [makeMarker('m1', 1000, 's1'), makeMarker('m2', 3000, 's2')],
        ...overrides,
      });
    }

    it('is disabled with no markers', () => {
      render(<AudioSyncEditor controller={makeExportableController({ markers: [] })} />);
      expect(screen.getByLabelText('Export lyrics')).toBeDisabled();
    });

    it('is disabled with no bound item even when markers exist', () => {
      render(<AudioSyncEditor controller={makeExportableController({ itemRef: null, candidateItems: [] })} />);
      expect(screen.getByLabelText('Export lyrics')).toBeDisabled();
    });

    it('is enabled once markers and a bound item are both present', () => {
      render(<AudioSyncEditor controller={makeExportableController()} />);
      expect(screen.getByLabelText('Export lyrics')).not.toBeDisabled();
    });

    it('exports CSV built from marker order and each bound slide\'s text', async () => {
      liveSlideElementsBySlideId.set('s1' as Id, [{ type: 'text', payload: { text: 'Hello' } }]);
      liveSlideElementsBySlideId.set('s2' as Id, [{ type: 'text', payload: { text: 'World' } }]);
      render(<AudioSyncEditor controller={makeExportableController()} />);

      fireEvent.click(screen.getByLabelText('Export lyrics'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));

      await vi.waitFor(() => expect(window.castApi.exportTextFile).toHaveBeenCalled());
      const call = vi.mocked(window.castApi.exportTextFile).mock.calls[0]![0];
      expect(call.suggestedName).toBe('My Song');
      expect(call.extension).toBe('csv');
      expect(call.filterName).toBe('CSV');
      expect(call.text).toBe('order,timestamp,text\n1,00:00:01.000,"Hello"\n2,00:00:03.000,"World"');
    });

    it('exports LRC and SRT under their own extension and filter name', async () => {
      render(<AudioSyncEditor controller={makeExportableController()} />);

      fireEvent.click(screen.getByLabelText('Export lyrics'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'LRC' }));
      await vi.waitFor(() => expect(window.castApi.exportTextFile).toHaveBeenCalledTimes(1));
      expect(vi.mocked(window.castApi.exportTextFile).mock.calls[0]![0]).toMatchObject({ extension: 'lrc', filterName: 'LRC' });
      // The trigger disables itself for the duration of the export; wait for
      // it to re-enable before starting the next one, otherwise the second
      // click can land while `exporting` is still true and never opens the menu.
      await vi.waitFor(() => expect(screen.getByLabelText('Export lyrics')).not.toBeDisabled());

      fireEvent.click(screen.getByLabelText('Export lyrics'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'SRT' }));
      await vi.waitFor(() => expect(window.castApi.exportTextFile).toHaveBeenCalledTimes(2));
      expect(vi.mocked(window.castApi.exportTextFile).mock.calls[1]![0]).toMatchObject({ extension: 'srt', filterName: 'SRT' });
    });

    it('falls back to a generic suggested name without a matching candidate title', async () => {
      render(<AudioSyncEditor controller={makeExportableController({ candidateItems: [] })} />);
      fireEvent.click(screen.getByLabelText('Export lyrics'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
      await vi.waitFor(() => expect(window.castApi.exportTextFile).toHaveBeenCalled());
      expect(vi.mocked(window.castApi.exportTextFile).mock.calls[0]![0]).toMatchObject({ suggestedName: 'lyrics' });
    });

    it('surfaces a failed export as an inline error', async () => {
      window.castApi = {
        exportTextFile: vi.fn(async () => { throw new Error('Disk full'); }),
      } as unknown as typeof window.castApi;
      render(<AudioSyncEditor controller={makeExportableController()} />);

      fireEvent.click(screen.getByLabelText('Export lyrics'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    });
  });
});