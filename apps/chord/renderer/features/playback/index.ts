// Public entry point for the playback feature. The store's `timelineEndMs`
// dependency and the app shell's `AudioElement` mount both come through here
// (per the layering rule, a deep import into this feature from outside it is
// a checker error once this file exists).
export { timelineEndMs } from './timeline-end';
export { formatClock, formatTimecode } from './format-time';
export { usePlaybackClock } from './use-playback-clock';
export { AudioElement, useAudioDuration } from './audio-element';
export { useAudioWaveform, sampleWaveform } from './use-audio-waveform';
