export function setMediaPlaybackActive(
  element: Pick<HTMLMediaElement, 'currentTime' | 'ended' | 'play' | 'pause'>,
  active: boolean,
  restartPlaybackWhenActive: boolean,
): void {
  if (!active) {
    element.pause();
    return;
  }
  if (restartPlaybackWhenActive) element.currentTime = 0;
  else if (element.ended) return;
  void element.play().catch(() => undefined);
}

export function shouldShowMediaFrame(ended: boolean, showNothingWhenPlaybackEnds: boolean): boolean {
  return !ended || !showNothingWhenPlaybackEnds;
}
