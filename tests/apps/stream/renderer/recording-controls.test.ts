import { describe, expect, it, vi } from 'vitest';
import { pauseRecordingChannels, recordingElapsedTime, resumeRecordingChannels, stopRecordingChannels } from '../../../../apps/stream/renderer/recording-controls';

function makeRecorder(initialState: MediaRecorderState = 'recording') {
  let state = initialState;
  return {
    get state() { return state; },
    pause: vi.fn(() => { state = 'paused'; }),
    resume: vi.fn(() => { state = 'recording'; }),
    stop: vi.fn(() => { state = 'inactive'; }),
  };
}

describe('coordinated recording controls', () => {
  it('pauses and resumes video and audio channels together while elapsed time stays frozen', () => {
    const recorders = [makeRecorder(), makeRecorder(), makeRecorder()];
    const channels = recorders.map((recorder) => ({ recorder }));

    expect(pauseRecordingChannels(channels)).toBe(true);
    expect(recorders.every(({ state }) => state === 'paused')).toBe(true);
    expect(recorders.every(({ pause }) => pause.mock.calls.length === 1)).toBe(true);

    const pausedAt = 16_000;
    const accumulatedPauseMs = 2_000;
    expect(recordingElapsedTime(16_000, pausedAt, accumulatedPauseMs)).toBe(14_000);
    expect(recordingElapsedTime(25_000, pausedAt, accumulatedPauseMs)).toBe(14_000);

    expect(resumeRecordingChannels(channels)).toBe(true);
    expect(recorders.every(({ state }) => state === 'recording')).toBe(true);
    const nextAccumulatedPauseMs = accumulatedPauseMs + (25_000 - pausedAt);
    expect(recordingElapsedTime(27_000, null, nextAccumulatedPauseMs)).toBe(16_000);
  });

  it('stops every paused channel so stopping while paused finalizes all tracks', () => {
    const recorders = [makeRecorder('paused'), makeRecorder('paused'), makeRecorder('paused')];
    const channels = recorders.map((recorder) => ({ recorder }));

    stopRecordingChannels(channels);

    expect(recorders.every(({ state }) => state === 'inactive')).toBe(true);
    expect(recorders.every(({ stop }) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('does not partially pause or resume channels when their states are out of sync', () => {
    const recording = makeRecorder('recording');
    const paused = makeRecorder('paused');
    expect(pauseRecordingChannels([{ recorder: recording }, { recorder: paused }])).toBe(false);
    expect(recording.pause).not.toHaveBeenCalled();
    expect(resumeRecordingChannels([{ recorder: recording }, { recorder: paused }])).toBe(false);
    expect(paused.resume).not.toHaveBeenCalled();
  });

  it('rolls back a partially applied pause or resume if a recorder rejects the operation', () => {
    const pausedRecorder = makeRecorder();
    const pauseFailure = makeRecorder();
    pauseFailure.pause.mockImplementation(() => { throw new Error('pause failed'); });
    expect(pauseRecordingChannels([{ recorder: pausedRecorder }, { recorder: pauseFailure }])).toBe(false);
    expect(pausedRecorder.state).toBe('recording');

    const resumedRecorder = makeRecorder('paused');
    const resumeFailure = makeRecorder('paused');
    resumeFailure.resume.mockImplementation(() => { throw new Error('resume failed'); });
    expect(resumeRecordingChannels([{ recorder: resumedRecorder }, { recorder: resumeFailure }])).toBe(false);
    expect(resumedRecorder.state).toBe('paused');
  });
});
