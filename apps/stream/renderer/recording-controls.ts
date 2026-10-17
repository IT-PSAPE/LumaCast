export interface RecordingControlChannel {
  recorder: Pick<MediaRecorder, 'state' | 'pause' | 'resume' | 'stop'>;
}

export function pauseRecordingChannels(channels: readonly RecordingControlChannel[]): boolean {
  if (channels.length === 0 || channels.some(({ recorder }) => recorder.state !== 'recording')) return false;
  const paused: RecordingControlChannel[] = [];
  try {
    channels.forEach((channel) => {
      channel.recorder.pause();
      paused.push(channel);
    });
  } catch {
    paused.forEach(({ recorder }) => { if (recorder.state === 'paused') recorder.resume(); });
    return false;
  }
  return true;
}

export function resumeRecordingChannels(channels: readonly RecordingControlChannel[]): boolean {
  if (channels.length === 0 || channels.some(({ recorder }) => recorder.state !== 'paused')) return false;
  const resumed: RecordingControlChannel[] = [];
  try {
    channels.forEach((channel) => {
      channel.recorder.resume();
      resumed.push(channel);
    });
  } catch {
    resumed.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.pause(); });
    return false;
  }
  return true;
}

export function stopRecordingChannels(channels: readonly RecordingControlChannel[]): void {
  channels.forEach(({ recorder }) => {
    if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop();
  });
}

export function recordingElapsedTime(now: number, pausedAt: number | null, accumulatedPauseMs: number): number {
  return Math.max(0, (pausedAt ?? now) - accumulatedPauseMs);
}
