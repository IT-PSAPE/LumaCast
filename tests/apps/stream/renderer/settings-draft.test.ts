import { describe, expect, it } from 'vitest';
import {
  applySettingsDraft,
  createSettingsDraft,
  hasSettingsDraftErrors,
  isSettingsDraftDirty,
  validateSettingsDraft,
  type SettingsDraft,
} from '../../../../apps/stream/renderer/dialogs/settings-draft';
import {
  createDefaultProject,
  createDefaultStreamAudioSettings,
  createDefaultStreamRecordingPreferences,
  createDefaultStreamServiceSettings,
} from '../../../../apps/stream/shared/desktop-api';

function makeDraft(overrides: Partial<SettingsDraft> = {}): SettingsDraft {
  const project = createDefaultProject('win32');
  const base = createSettingsDraft(
    project.output,
    createDefaultStreamAudioSettings(),
    createDefaultStreamRecordingPreferences(),
    30,
    createDefaultStreamServiceSettings(),
  );
  return { ...base, ...overrides };
}

describe('createSettingsDraft', () => {
  it('copies nested arrays/objects so mutating the draft never touches the source', () => {
    const project = createDefaultProject('win32');
    const audioSettings = createDefaultStreamAudioSettings();
    const recordingPreferences = createDefaultStreamRecordingPreferences();
    const streamServiceSettings = createDefaultStreamServiceSettings();
    const draft = createSettingsDraft(project.output, audioSettings, recordingPreferences, 30, streamServiceSettings);

    draft.output.recordingAudioTracks.push(2);
    draft.streamServiceSettings!.youtube.title = 'changed';

    expect(project.output.recordingAudioTracks).toEqual([1]);
    expect(streamServiceSettings.youtube.title).toBe('');
  });

  it('stores a null streamServiceSettings when none is provided', () => {
    const project = createDefaultProject('win32');
    const draft = createSettingsDraft(project.output, createDefaultStreamAudioSettings(), createDefaultStreamRecordingPreferences(), 30);
    expect(draft.streamServiceSettings).toBeNull();
  });
});

describe('isSettingsDraftDirty', () => {
  it('is false for two drafts with identical values', () => {
    const baseline = makeDraft();
    const draft = makeDraft();
    expect(isSettingsDraftDirty(draft, baseline)).toBe(false);
  });

  it('is true when an output field changes', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, frameRate: 60 } });
    expect(isSettingsDraftDirty(draft, baseline)).toBe(true);
  });

  it('is true when the replay buffer duration changes', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ replayBufferDurationSeconds: 60 });
    expect(isSettingsDraftDirty(draft, baseline)).toBe(true);
  });

  it('is true when a stream service field changes', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ streamServiceSettings: { ...baseline.streamServiceSettings!, streamKey: 'abcd' } });
    expect(isSettingsDraftDirty(draft, baseline)).toBe(true);
  });

  it('treats reordering/mutating an array field as a change but an equal copy as unchanged', () => {
    const baseline = makeDraft({ output: { ...makeDraft().output, recordingAudioTracks: [1, 2] } });
    const sameDraft = makeDraft({ output: { ...baseline.output, recordingAudioTracks: [1, 2] } });
    const changedDraft = makeDraft({ output: { ...baseline.output, recordingAudioTracks: [1, 3] } });
    expect(isSettingsDraftDirty(sameDraft, baseline)).toBe(false);
    expect(isSettingsDraftDirty(changedDraft, baseline)).toBe(true);
  });
});

describe('applySettingsDraft', () => {
  it('returns no patches when nothing changed', () => {
    const baseline = makeDraft();
    const draft = makeDraft();
    expect(applySettingsDraft(draft, baseline)).toEqual({});
  });

  it('returns only the groups that changed', () => {
    const baseline = makeDraft();
    const draft = makeDraft({
      output: { ...baseline.output, frameRate: 60 },
      audioSettings: baseline.audioSettings,
      recordingPreferences: baseline.recordingPreferences,
      replayBufferDurationSeconds: baseline.replayBufferDurationSeconds,
      streamServiceSettings: baseline.streamServiceSettings,
    });
    const patches = applySettingsDraft(draft, baseline);
    expect(patches).toEqual({ outputPatch: { frameRate: 60 } });
  });

  it('includes only the changed keys within a group, not the whole object', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, frameRate: 60, streamVideoBitrateKbps: 9000 } });
    const patches = applySettingsDraft(draft, baseline);
    expect(patches.outputPatch).toEqual({ frameRate: 60, streamVideoBitrateKbps: 9000 });
  });

  it('reports a changed monitoring device under audioSettingsPatch', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ audioSettings: { monitoringDeviceId: 'device-1' } });
    expect(applySettingsDraft(draft, baseline)).toEqual({ audioSettingsPatch: { monitoringDeviceId: 'device-1' } });
  });

  it('reports a changed filename format under recordingPreferencesPatch', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ recordingPreferences: { ...baseline.recordingPreferences, filenameFormat: 'Capture %CCYY-%MM-%DD' } });
    expect(applySettingsDraft(draft, baseline)).toEqual({ recordingPreferencesPatch: { filenameFormat: 'Capture %CCYY-%MM-%DD' } });
  });

  it('reports the whole streamServiceSettings object when it changes', () => {
    const baseline = makeDraft();
    const nextSettings = { ...baseline.streamServiceSettings!, streamKey: 'secret-key' };
    const draft = makeDraft({ streamServiceSettings: nextSettings });
    expect(applySettingsDraft(draft, baseline)).toEqual({ streamServiceSettings: nextSettings });
  });

  it('detects a change nested inside streamServiceSettings.youtube even when every top-level field is unchanged', () => {
    const baseline = makeDraft();
    const nextSettings = { ...baseline.streamServiceSettings!, youtube: { ...baseline.streamServiceSettings!.youtube, title: 'Launch stream' } };
    const draft = makeDraft({ streamServiceSettings: nextSettings });
    expect(applySettingsDraft(draft, baseline)).toEqual({ streamServiceSettings: nextSettings });
    expect(isSettingsDraftDirty(draft, baseline)).toBe(true);
  });

  it('is not fooled into reporting a change by youtube being cloned into a new object reference', () => {
    // `createSettingsDraft`/`cloneStreamServiceSettings` always give `youtube` a
    // fresh object reference, even when every field is identical — the diff
    // must compare its fields by value, not the object itself.
    const baseline = makeDraft();
    const draft = makeDraft({ streamServiceSettings: { ...baseline.streamServiceSettings!, youtube: { ...baseline.streamServiceSettings!.youtube } } });
    expect(applySettingsDraft(draft, baseline)).toEqual({});
    expect(isSettingsDraftDirty(draft, baseline)).toBe(false);
  });

  it('combines multiple changed groups in one call', () => {
    const baseline = makeDraft();
    const draft = makeDraft({
      output: { ...baseline.output, frameRate: 24 },
      replayBufferDurationSeconds: 15,
    });
    const patches = applySettingsDraft(draft, baseline);
    expect(Object.keys(patches).sort()).toEqual(['outputPatch', 'replayBufferDurationSeconds']);
  });
});

describe('validateSettingsDraft', () => {
  it('returns no errors for a freshly created default draft', () => {
    const draft = makeDraft();
    expect(validateSettingsDraft(draft, 'win32')).toEqual({});
    expect(hasSettingsDraftErrors(validateSettingsDraft(draft, 'win32'))).toBe(false);
  });

  it('flags an out-of-range frame rate', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, frameRate: 1000 } });
    const errors = validateSettingsDraft(draft, 'win32');
    expect(errors.frameRate).toMatch(/between 1 and 240/);
    expect(hasSettingsDraftErrors(errors)).toBe(true);
  });

  it('flags an out-of-range base/output size', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, baseWidth: 10, width: 100000 } });
    const errors = validateSettingsDraft(draft, 'win32');
    expect(errors.baseWidth).toBeDefined();
    expect(errors.width).toBeDefined();
  });

  it('flags an out-of-range bitrate', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, streamVideoBitrateKbps: 1, recordingAudioBitrateKbps: 10000 } });
    const errors = validateSettingsDraft(draft, 'win32');
    expect(errors.streamVideoBitrateKbps).toBeDefined();
    expect(errors.recordingAudioBitrateKbps).toBeDefined();
  });

  it('flags an invalid recording filename format', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ recordingPreferences: { ...baseline.recordingPreferences, filenameFormat: 'bad/name' } });
    const errors = validateSettingsDraft(draft, 'win32');
    expect(errors.recordingFilenameFormat).toBeDefined();
  });

  it('flags a video encoder unavailable on the given platform', () => {
    const baseline = makeDraft();
    const draft = makeDraft({ output: { ...baseline.output, streamVideoEncoder: 'h264_videotoolbox' } });
    const errors = validateSettingsDraft(draft, 'win32');
    expect(errors.streamVideoEncoder).toBeDefined();
  });

  it('does not block on an incomplete (but not malformed) stream service draft', () => {
    const baseline = makeDraft({ streamServiceSettings: { ...createDefaultStreamServiceSettings(), streamKey: '' } });
    const errors = validateSettingsDraft(baseline, 'win32');
    expect(hasSettingsDraftErrors(errors)).toBe(false);
  });
});
