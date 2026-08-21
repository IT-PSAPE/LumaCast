// Public entry for the resource-drawer transport controls. Each control is an
// independent component living in its own file; this module re-exports them so
// existing import paths (`../playback/media-transport-controls`) keep working.
export { VideoTransportControls } from './video-transport-controls';
export { AudioTransportControls } from './audio-transport-controls';
