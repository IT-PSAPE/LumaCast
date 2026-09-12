import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioTransportControls } from '../../../../../app/renderer/features/playback/audio-transport-controls';

const mocks = vi.hoisted(() => {
  const audioState = {
    currentAudioAsset: { id: 'audio-1', name: 'Intro.mp3' } as { id: string; name: string } | null,
    currentTime: 12,
    duration: 60,
    isPlaying: false,
    loopEnabled: false,
    muted: false,
  };
  const getCurrentTime = vi.fn<() => number>(() => 0);
  const saveSchedule = vi.fn<(schedule: any) => Promise<void>>(async () => undefined);
  const deleteSchedule = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  const schedules: any[] = [];
  const slidesForItemRef = vi.fn<() => Array<{ id: string; order: number }>>(() => []);
  return {
    audioState,
    getCurrentTime,
    saveSchedule,
    deleteSchedule,
    resumeSync: vi.fn(),
    schedules,
    slidesForItemRef,
    lyrics: [] as any[],
    presentations: [] as any[],
    overlayStack: [] as string[],
    seekTo: vi.fn(),
  };
});

// Controller regressions use exposed marker editors; the actual track/popover
// presentation is covered independently in audio-waveform-track.test.tsx.
vi.mock('../../../../../app/renderer/features/playback/audio-waveform-track', async () => {
  const { MarkerRow } = await import('../../../../../app/renderer/features/playback/audio-sync-editor');
  return { AudioWaveformTrack: ({ controller, duration }: { controller: import('../../../../../app/renderer/features/playback/audio-sync-editor').AudioSyncController; duration: number }) => <div>
    {controller.markers.length === 0 ? <span>No markers</span> : null}
    {controller.markers.map((marker, index) => <div key={marker.id}>
      <span data-marker-dot style={{ left: `${Math.min(100, marker.timeMs / 1000 / duration * 100)}%` }} />
      <MarkerRow marker={marker} index={index} controller={controller} />
    </div>)}
    {controller.hasSavedSchedule ? <button onClick={controller.removeSchedule}>Remove schedule</button> : null}
  </div> };
});

vi.mock('../../../../../app/renderer/contexts/playback/playback-context', () => ({
  useAudio: () => ({
    audioAssets: [],
    currentAudioAsset: mocks.audioState.currentAudioAsset as never,
    currentAudioAssetId: mocks.audioState.currentAudioAsset?.id ?? null,
    currentTime: mocks.audioState.currentTime,
    duration: mocks.audioState.duration,
    isPlaying: mocks.audioState.isPlaying,
    loopEnabled: mocks.audioState.loopEnabled,
    muted: mocks.audioState.muted,
    getCurrentTime: mocks.getCurrentTime,
    armAudio: vi.fn(),
    clearAudio: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn(),
    seekTo: mocks.seekTo,
    selectAudio: vi.fn(),
    toggleLoop: vi.fn(),
    toggleMuted: vi.fn(),
    togglePlayback: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/playback-schedules-context', () => ({
  usePlaybackSchedules: () => ({
    schedules: mocks.schedules,
    saveSchedule: mocks.saveSchedule,
    deleteSchedule: mocks.deleteSchedule,
    syncSuspended: false,
    resumeSync: mocks.resumeSync,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({
    lyrics: mocks.lyrics,
    presentations: mocks.presentations,
    slidesForItemRef: mocks.slidesForItemRef,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: { workbenchMode: 'show' },
    actions: {},
    overlayStack: {
      rootElement: null as HTMLElement | null,
      stack: mocks.overlayStack,
      baseZIndex: 100,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  }),
}));

function lastSavedSchedule(): any {
  const calls = mocks.saveSchedule.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audioState.currentAudioAsset = { id: 'audio-1', name: 'Intro.mp3' };
  mocks.audioState.currentTime = 12;
  mocks.audioState.duration = 60;
  mocks.audioState.isPlaying = false;
  mocks.audioState.loopEnabled = false;
  mocks.audioState.muted = false;
  mocks.lyrics = [];
  mocks.presentations = [];
  mocks.schedules.length = 0;
  mocks.overlayStack.length = 0;
  mocks.getCurrentTime.mockReset().mockReturnValue(0);
  mocks.slidesForItemRef.mockReset().mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  mocks.saveSchedule.mockReset().mockResolvedValue(undefined);
  mocks.deleteSchedule.mockReset().mockResolvedValue(undefined);
});

describe('AudioTransportControls audio markers', () => {
  it('records a marker schedule at the current playhead from the M button', async () => {
    mocks.getCurrentTime.mockReturnValue(12);
    render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledWith(expect.objectContaining({
      id: 'audio:audio-1',
      kind: 'audio-sync',
      audioAssetId: 'audio-1',
      itemRef: null,
      enabled: false,
      markers: [expect.objectContaining({ timeMs: 12000, slideId: null })],
    })));
  });

  it('renders a far-right M text marker button after the track name', () => {
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    expect(markerButton.textContent).toBe('M');
    expect(markerButton.querySelector('svg')).toBeNull();
    const row = markerButton.parentElement!;
    expect(row.lastElementChild).toBe(markerButton);
  });

  it('records with the M shortcut only inside the audio focus scope, outside editable inputs, without modifiers, unconsumed, without overlays, and without auto-repeat', async () => {
    const { rerender } = render(<AudioTransportControls />);
    const play = screen.getByRole('button', { name: 'Play' });

    expect(fireEvent.keyDown(play, { key: 'm' })).toBe(false);
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(1));

    expect(fireEvent.keyDown(document.body, { key: 'm' })).toBe(true);
    expect(fireEvent.keyDown(play, { key: 'm', metaKey: true })).toBe(true);
    const repeatEvent = new KeyboardEvent('keydown', { key: 'm', repeat: true, bubbles: true });
    expect(fireEvent(play, repeatEvent)).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText('Audio scrubber'), { key: 'm' })).toBe(true);
    const consumed = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
    consumed.preventDefault();
    expect(fireEvent(play, consumed)).toBe(false);
    mocks.overlayStack.push('some-dialog');
    rerender(<AudioTransportControls />);
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Play' }), { key: 'm' })).toBe(true);
    mocks.overlayStack.length = 0;
    rerender(<AudioTransportControls />);
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(1));

    const scope = document.createElement('div');
    scope.setAttribute('data-shortcuts-scope', 'audio-focus');
    document.body.appendChild(scope);
    expect(fireEvent.keyDown(scope, { key: 'm' })).toBe(false);
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(2));
    scope.remove();
  });

  it('records while playing, at the playhead position', async () => {
    mocks.audioState.isPlaying = true;
    mocks.getCurrentTime.mockReturnValue(42.5);
    render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(mocks.saveSchedule.mock.calls[0]?.[0].markers[0].timeMs).toBe(42500));
  });

  it('records from the M button without arming the sync, refuses to enable until bound with valid markers, then stays enabled', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }, { id: 's2', order: 1 }]);
    render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(lastSavedSchedule().enabled).toBe(false));

    fireEvent.click(screen.getByRole('switch', { name: 'Audio sync' }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(lastSavedSchedule().enabled).toBe(false);

    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Audio sync' }));
    await waitFor(() => expect(lastSavedSchedule().enabled).toBe(true));
    expect(lastSavedSchedule().markers).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(lastSavedSchedule().markers).toHaveLength(2));
    expect(lastSavedSchedule().enabled).toBe(true);
  });

  it('assigns each new record by chronological position instead of restarting at the first slide', async () => {
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }, { id: 's2', order: 1 }]);
    mocks.getCurrentTime.mockReturnValueOnce(1).mockReturnValueOnce(2);
    render(<AudioTransportControls />);
    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);
    await waitFor(() => expect(lastSavedSchedule().markers).toHaveLength(2));
    expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's2']);
  });

  it('preserves an explicitly reassigned marker when recording the next one', async () => {
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }, { id: 's2', order: 1 }, { id: 's3', order: 2 }]);
    mocks.getCurrentTime.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValue(3);
    render(<AudioTransportControls />);
    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);
    await waitFor(() => expect(lastSavedSchedule().markers).toHaveLength(2));

    fireEvent.pointerDown(screen.getByLabelText('Marker 2 slide'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Slide 3' }));
    await waitFor(() => expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's3']));

    fireEvent.click(markerButton);
    await waitFor(() => expect(lastSavedSchedule().markers).toHaveLength(3));
    expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's3', 's3']);
  });

  it('rebinding clears stale slide ids with valid new ones, and unbinding disables', async () => {
    mocks.getCurrentTime.mockReturnValueOnce(1).mockReturnValue(2);
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.presentations = [{ id: 'deck-1', title: 'Deck' }];
    mocks.slidesForItemRef.mockImplementation((...args: any[]) => {
      const ref = args[0] as { id: string } | undefined;
      return ref?.id === 'song-1'
        ? [{ id: 's1', order: 0 }, { id: 's2', order: 1 }]
        : [{ id: 's3', order: 0 }, { id: 's4', order: 1 }];
    });
    render(<AudioTransportControls />);
    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);
    await waitFor(() => expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's2']));

    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deck' }));
    await waitFor(() => expect(lastSavedSchedule().itemRef).toEqual({ type: 'presentation', id: 'deck-1' }));
    expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s3', 's4']);

    fireEvent.click(screen.getByRole('switch', { name: 'Audio sync' }));
    await waitFor(() => expect(lastSavedSchedule().enabled).toBe(true));

    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'No item' }));
    await waitFor(() => expect(lastSavedSchedule().itemRef).toBeNull());
    expect(lastSavedSchedule().enabled).toBe(false);
  });

  it('serializes rapid records so every marker reaches the persisted schedule', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(2));
    expect(lastSavedSchedule().markers).toHaveLength(2);
  });

  it('assigns unassigned markers in slide order when an item is bound', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }, { id: 's2', order: 1 }]);
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);

    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));

    await waitFor(() => expect(lastSavedSchedule().itemRef).toEqual({ type: 'lyric', id: 'song-1' }));
    expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's2']);
  });

  it('allows per-marker slide reassignment including repeats', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
    mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }, { id: 's2', order: 1 }]);
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);
    fireEvent.pointerDown(screen.getByLabelText('Bind item'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Song' }));

    fireEvent.pointerDown(screen.getByLabelText('Marker 2 slide'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Slide 1' }));

    await waitFor(() => expect(lastSavedSchedule().markers.map((marker: any) => marker.slideId)).toEqual(['s1', 's1']));
  });

  it('resorts markers by edited time and seeks to them', async () => {
    mocks.getCurrentTime.mockReturnValueOnce(1).mockReturnValueOnce(3);
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);

    fireEvent.change(screen.getByLabelText('Marker 2 time in seconds'), { target: { value: '0.5' } });
    await waitFor(() => expect(lastSavedSchedule().markers.map((marker: any) => marker.timeMs)).toEqual([500, 1000]));

    fireEvent.click(screen.getAllByRole('button', { name: 'Seek to marker' })[0]!);
    expect(mocks.seekTo).toHaveBeenCalledWith(0.5);
  });

  it('removing a marker persists the remaining ones', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove marker' })[0]!);
    await waitFor(() => expect(lastSavedSchedule().markers).toHaveLength(1));
  });

  it('removing the schedule clears the draft and deletes the persisted schedule', async () => {
    mocks.schedules.push({
      id: 'audio:audio-1',
      kind: 'audio-sync',
      enabled: false,
      itemRef: null,
      audioAssetId: 'audio-1',
      markers: [{ id: 'm1', timeMs: 1000, slideId: null }],
    });
    mocks.deleteSchedule.mockImplementation(async (id: string) => {
      const index = mocks.schedules.findIndex((entry: any) => entry.id === id);
      if (index >= 0) mocks.schedules.splice(index, 1);
    });
    render(<AudioTransportControls />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove schedule' })).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Remove schedule' }));
    await waitFor(() => expect(mocks.deleteSchedule).toHaveBeenCalledWith('audio:audio-1'));
    await waitFor(() => expect(screen.getByText('No markers')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Remove schedule' })).toBeNull();
  });

  it('loads the draft from the persisted snapshot (undo/redo) when no saves are pending', async () => {
    mocks.schedules.push({
      id: 'audio:audio-1',
      kind: 'audio-sync',
      enabled: false,
      itemRef: null,
      audioAssetId: 'audio-1',
      markers: [{ id: 'm1', timeMs: 1000, slideId: null }],
    });
    const { rerender } = render(<AudioTransportControls />);
    await waitFor(() => expect(screen.getByLabelText('Marker 1 time in seconds')).not.toBeNull());

    mocks.schedules = [
      {
        id: 'audio:audio-1',
        kind: 'audio-sync',
        enabled: false,
        itemRef: null,
        audioAssetId: 'audio-1',
        markers: [
          { id: 'm1', timeMs: 1000, slideId: null },
          { id: 'm2', timeMs: 2000, slideId: null },
        ],
      },
    ];
    rerender(<AudioTransportControls />);
    await waitFor(() => expect(screen.getByLabelText('Marker 2 time in seconds')).not.toBeNull());
  });

  it('keeps each asset on its stable schedule id when switching assets mid-queue', async () => {
    mocks.getCurrentTime.mockReturnValue(1);
    const { rerender } = render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(1));
    expect(lastSavedSchedule().id).toBe('audio:audio-1');

    mocks.audioState.currentAudioAsset = { id: 'audio-2', name: 'Outro.mp3' };
    mocks.getCurrentTime.mockReturnValue(5);
    rerender(<AudioTransportControls />);
    await waitFor(() => expect(screen.getByText('No markers')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(2));
    expect(lastSavedSchedule().id).toBe('audio:audio-2');
    expect(lastSavedSchedule().markers).toHaveLength(1);
  });

  it('scopes queued errors to their asset and clears them on switch', async () => {
    mocks.saveSchedule.mockRejectedValueOnce(new Error('Save failed'));
    mocks.getCurrentTime.mockReturnValue(1);
    const { rerender } = render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    expect(await screen.findByRole('alert')).not.toBeNull();

    mocks.audioState.currentAudioAsset = { id: 'audio-2', name: 'Outro.mp3' };
    rerender(<AudioTransportControls />);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('No markers')).not.toBeNull();
  });

  it('surfaces a failed save and recovers on the next one', async () => {
    mocks.saveSchedule.mockRejectedValueOnce(new Error('Save failed'));
    mocks.getCurrentTime.mockReturnValue(1);
    render(<AudioTransportControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Save failed');
    // A failed write must never look saved: no remove affordance appears and
    // the schedule id stays stable for the retry.
    expect(screen.queryByRole('button', { name: 'Remove schedule' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.saveSchedule).toHaveBeenCalledTimes(2);
    expect(lastSavedSchedule().id).toBe('audio:audio-1');
  });

  it('draws marker dots over the scrubber at the marker positions', async () => {
    mocks.getCurrentTime.mockReturnValueOnce(10).mockReturnValueOnce(30);
    mocks.audioState.duration = 60;
    const { container } = render(<AudioTransportControls />);
    const markerButton = screen.getByRole('button', { name: 'Add marker (M)' });
    fireEvent.click(markerButton);
    fireEvent.click(markerButton);

    const dots = Array.from(container.querySelectorAll('[data-marker-dot]'));
    expect(dots).toHaveLength(2);
    expect(parseFloat((dots[0] as HTMLElement).style.left)).toBeCloseTo(16.67, 1);
    expect(parseFloat((dots[1] as HTMLElement).style.left)).toBeCloseTo(50, 0);
  });

  it('does not record when no audio is armed', async () => {
    mocks.audioState.currentAudioAsset = null;
    render(<AudioTransportControls />);
    expect(screen.getByRole('button', { name: 'Add marker (M)' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'm' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(mocks.saveSchedule).not.toHaveBeenCalled();
  });
});

it('does not create duplicate markers while paused at the same playhead', async () => {
  mocks.getCurrentTime.mockReturnValue(5);
  render(<AudioTransportControls />);
  const button = screen.getByRole('button', { name: 'Add marker (M)' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.saveSchedule).toHaveBeenCalledTimes(1));
  expect(lastSavedSchedule().markers).toHaveLength(1);
});

it('disables the audio schedule when its last marker is removed', async () => {
  mocks.lyrics = [{ id: 'song-1', title: 'Song' }];
  mocks.slidesForItemRef.mockReturnValue([{ id: 's1', order: 0 }]);
  mocks.schedules.push({ id: 'audio:audio-1', kind: 'audio-sync', audioAssetId: 'audio-1', enabled: true,
    itemRef: { type: 'lyric', id: 'song-1' }, markers: [{ id: 'm', timeMs: 0, slideId: 's1' }] });
  render(<AudioTransportControls />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove marker' }));
  await waitFor(() => expect(lastSavedSchedule()).toMatchObject({ enabled: false, markers: [] }));
});


it('turns a missing schedule handler into an actionable restart error', async () => {
  mocks.saveSchedule.mockRejectedValueOnce(new Error("Error invoking remote method 'cast:savePlaybackSchedule': Error: No handler registered for 'cast:savePlaybackSchedule'"));
  mocks.getCurrentTime.mockReturnValue(1);
  render(<AudioTransportControls />);
  fireEvent.click(screen.getByRole('button', { name: 'Add marker (M)' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Restart LumaCast');
  expect(screen.getByRole('alert').textContent).not.toContain('remote method');
});
