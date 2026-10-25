// The selection-scoped cue commands that two entry points share: the
// timeline's keydown handler and the native menu's click handler. Both call
// these, so a key and its menu item can never drift apart.
import { useChordStore } from '../../store';

export function deleteSelectedCues(): void {
  const state = useChordStore.getState();
  if (state.selection.length > 0) state.deleteCues(state.selection);
}

/** Copies the first selected cue to the playhead. */
export function duplicateSelectedCue(): void {
  const state = useChordStore.getState();
  const [id] = state.selection;
  if (id) state.duplicateCue(id, state.playback.timeMs);
}

/** Sets the first selected cue's in (`start`) or out (`end`) point to the playhead; the store clamps it to the neighbours. */
export function trimSelectedCueToPlayhead(edge: 'start' | 'end'): void {
  const state = useChordStore.getState();
  const [id] = state.selection;
  if (id) state.trimCue(id, edge, state.playback.timeMs);
}
