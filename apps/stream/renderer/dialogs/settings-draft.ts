// Pure, UI-free helpers backing the Settings dialog's OK/Cancel/Apply model.
// The dialog buffers every edit in a `SettingsDraft` taken from the live
// project/audio/recording/stream-service state when it opens; Apply/OK diff
// that draft against the last-committed baseline and hand the dialog only the
// groups that actually changed, so unrelated callbacks are never invoked.
import {
  type StreamAudioSettings,
  type StreamOutputConfiguration,
  type StreamRecordingPreferences,
  type StreamServiceSettings,
} from '../../shared/desktop-api';
import { isVideoEncoderAvailableOnPlatform, type StreamPlatform } from '../../shared/platform-capabilities';
import { validateRecordingFilenameFormat } from '../../shared/recording-filename';
import { SCALED_OUTPUT_LIMITS } from '../output-scaling';

export type SettingsPage = 'general' | 'stream' | 'output' | 'audio' | 'video' | 'hotkeys' | 'advanced';

export interface SettingsDraft {
  output: StreamOutputConfiguration;
  audioSettings: StreamAudioSettings;
  recordingPreferences: StreamRecordingPreferences;
  replayBufferDurationSeconds: number;
  streamServiceSettings: StreamServiceSettings | null;
}

export function cloneStreamServiceSettings(settings: StreamServiceSettings): StreamServiceSettings {
  return { ...settings, youtube: { ...settings.youtube } };
}

export function createSettingsDraft(
  output: StreamOutputConfiguration,
  audioSettings: StreamAudioSettings,
  recordingPreferences: StreamRecordingPreferences,
  replayBufferDurationSeconds: number,
  streamServiceSettings?: StreamServiceSettings | null,
): SettingsDraft {
  return {
    output: { ...output, recordingAudioTracks: [...output.recordingAudioTracks] },
    audioSettings: { ...audioSettings },
    recordingPreferences: { ...recordingPreferences },
    replayBufferDurationSeconds,
    streamServiceSettings: streamServiceSettings ? cloneStreamServiceSettings(streamServiceSettings) : null,
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

function diffKeys<T extends object>(next: T, previous: T): Partial<T> | undefined {
  let patch: Partial<T> | undefined;
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (!valuesEqual(next[key], previous[key])) {
      patch ??= {};
      patch[key] = next[key];
    }
  }
  return patch;
}

export interface SettingsDraftPatches {
  outputPatch?: Partial<StreamOutputConfiguration>;
  audioSettingsPatch?: Partial<StreamAudioSettings>;
  recordingPreferencesPatch?: Partial<StreamRecordingPreferences>;
  replayBufferDurationSeconds?: number;
  streamServiceSettings?: StreamServiceSettings;
}

/** Diffs `draft` against `baseline`, returning only the groups that changed. */
export function applySettingsDraft(draft: SettingsDraft, baseline: SettingsDraft): SettingsDraftPatches {
  const patches: SettingsDraftPatches = {};
  const outputPatch = diffKeys(draft.output, baseline.output);
  if (outputPatch) patches.outputPatch = outputPatch;
  const audioSettingsPatch = diffKeys(draft.audioSettings, baseline.audioSettings);
  if (audioSettingsPatch) patches.audioSettingsPatch = audioSettingsPatch;
  const recordingPreferencesPatch = diffKeys(draft.recordingPreferences, baseline.recordingPreferences);
  if (recordingPreferencesPatch) patches.recordingPreferencesPatch = recordingPreferencesPatch;
  if (draft.replayBufferDurationSeconds !== baseline.replayBufferDurationSeconds) {
    patches.replayBufferDurationSeconds = draft.replayBufferDurationSeconds;
  }
  if (draft.streamServiceSettings && streamServiceSettingsDiffer(draft.streamServiceSettings, baseline.streamServiceSettings)) {
    patches.streamServiceSettings = draft.streamServiceSettings;
  }
  return patches;
}

/**
 * Field-by-field equivalent of the other `diffKeys` calls above, for
 * `StreamServiceSettings`. `diffKeys` itself can't be reused directly: its
 * `youtube` field is a nested object that `cloneStreamServiceSettings` always
 * recreates with a new reference, so a top-level `diffKeys` call would treat
 * it as "changed" on every comparison via reference inequality. Diffing the
 * two levels separately (both of plain primitive fields) avoids that false
 * positive.
 */
function streamServiceSettingsDiffer(next: StreamServiceSettings, previous: StreamServiceSettings | null): boolean {
  if (!previous) return true;
  const { youtube: nextYoutube, ...nextRest } = next;
  const { youtube: previousYoutube, ...previousRest } = previous;
  return diffKeys(nextRest, previousRest) !== undefined || diffKeys(nextYoutube, previousYoutube) !== undefined;
}

export function isSettingsDraftDirty(draft: SettingsDraft, baseline: SettingsDraft): boolean {
  return Object.keys(applySettingsDraft(draft, baseline)).length > 0;
}

export type SettingsErrorField =
  | 'baseWidth'
  | 'baseHeight'
  | 'width'
  | 'height'
  | 'frameRate'
  | 'streamVideoBitrateKbps'
  | 'streamAudioBitrateKbps'
  | 'streamKeyframeIntervalSeconds'
  | 'streamVideoEncoder'
  | 'recordingVideoBitrateKbps'
  | 'recordingAudioBitrateKbps'
  | 'recordingKeyframeIntervalSeconds'
  | 'recordingVideoEncoder'
  | 'recordingFilenameFormat';

export type SettingsDraftErrors = Partial<Record<SettingsErrorField, string>>;

function checkRange(errors: SettingsDraftErrors, field: SettingsErrorField, value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    errors[field] = `${label} must be between ${min} and ${max}.`;
  }
}

/**
 * Field-level validation for the whole draft. Deliberately does not validate
 * `streamServiceSettings` completeness (an empty stream key is a normal "not
 * configured yet" state, not an error that should block saving unrelated
 * settings) — the dialog shows that as a separate, non-blocking status note.
 */
export function validateSettingsDraft(draft: SettingsDraft, platform: StreamPlatform): SettingsDraftErrors {
  const errors: SettingsDraftErrors = {};
  const { output } = draft;
  checkRange(errors, 'baseWidth', output.baseWidth, 320, 16384, 'Base width');
  checkRange(errors, 'baseHeight', output.baseHeight, 180, 16384, 'Base height');
  checkRange(errors, 'width', output.width, SCALED_OUTPUT_LIMITS.minWidth, SCALED_OUTPUT_LIMITS.maxWidth, 'Output width');
  checkRange(errors, 'height', output.height, SCALED_OUTPUT_LIMITS.minHeight, SCALED_OUTPUT_LIMITS.maxHeight, 'Output height');
  checkRange(errors, 'frameRate', output.frameRate, 1, 240, 'Frame rate');
  checkRange(errors, 'streamVideoBitrateKbps', output.streamVideoBitrateKbps, 250, 50000, 'Video bitrate');
  checkRange(errors, 'streamAudioBitrateKbps', output.streamAudioBitrateKbps, 32, 320, 'Audio bitrate');
  checkRange(errors, 'streamKeyframeIntervalSeconds', output.streamKeyframeIntervalSeconds, 1, 10, 'Keyframe interval');
  checkRange(errors, 'recordingVideoBitrateKbps', output.recordingVideoBitrateKbps, 500, 50000, 'Recording video bitrate');
  checkRange(errors, 'recordingAudioBitrateKbps', output.recordingAudioBitrateKbps, 32, 320, 'Recording audio bitrate');
  checkRange(errors, 'recordingKeyframeIntervalSeconds', output.recordingKeyframeIntervalSeconds, 1, 10, 'Recording keyframe interval');
  if (!isVideoEncoderAvailableOnPlatform(platform, output.streamVideoEncoder)) {
    errors.streamVideoEncoder = 'Selected video encoder is unavailable on this platform.';
  }
  if (!isVideoEncoderAvailableOnPlatform(platform, output.recordingVideoEncoder)) {
    errors.recordingVideoEncoder = 'Selected recording encoder is unavailable on this platform.';
  }
  if (!validateRecordingFilenameFormat(draft.recordingPreferences.filenameFormat)) {
    errors.recordingFilenameFormat = 'Enter a valid filename format.';
  }
  return errors;
}

export function hasSettingsDraftErrors(errors: SettingsDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}
