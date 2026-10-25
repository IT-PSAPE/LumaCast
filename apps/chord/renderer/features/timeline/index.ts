// Public entry point for the timeline feature: the composed transport +
// ruler + tracks + playhead strip the app shell mounts.
export { Timeline } from './timeline';

// The native menu fires the same cue commands as the timeline's own keyboard
// handler, so the shell needs them — through here, not by reaching inside.
export { deleteSelectedCues, duplicateSelectedCue, trimSelectedCueToPlayhead } from './cue-commands';
export { isEditableTarget } from './use-timeline-shortcuts';
