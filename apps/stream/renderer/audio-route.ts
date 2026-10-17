export function connectAudioInput(input: AudioNode, gain: AudioNode, noiseSuppression: AudioNode | null): void {
  if (noiseSuppression) {
    input.connect(noiseSuppression);
    noiseSuppression.connect(gain);
    return;
  }
  input.connect(gain);
}

export function gainFromDecibels(decibels: number): number {
  return 10 ** (decibels / 20);
}

export function replaceAudioInputConnection(
  input: AudioNode,
  gain: AudioNode,
  currentNoiseSuppression: AudioNode | null,
  nextNoiseSuppression: AudioNode | null,
): void {
  if (currentNoiseSuppression) {
    input.disconnect(currentNoiseSuppression);
    currentNoiseSuppression.disconnect(gain);
  } else {
    input.disconnect(gain);
  }

  connectAudioInput(input, gain, nextNoiseSuppression);
}
