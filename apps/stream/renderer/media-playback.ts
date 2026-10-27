const elementActivity = new WeakMap<object, boolean>();

export function setMediaPlaybackActive(
  element: Pick<HTMLMediaElement, 'currentTime' | 'ended' | 'play' | 'pause'>,
  active: boolean,
  restartPlaybackWhenActive: boolean,
): void {
  if (!active) {
    elementActivity.set(element, false);
    element.pause();
    return;
  }

  // Effects can run again when a scene config or callback changes even though
  // the same runtime source stayed in Program. Restart only on the inactive ->
  // active edge so source identity, rather than the owning scene, controls the
  // media timeline.
  if (elementActivity.get(element) === true) return;
  elementActivity.set(element, true);
  if (restartPlaybackWhenActive) element.currentTime = 0;
  else if (element.ended) return;
  try {
    void Promise.resolve(element.play()).catch(() => elementActivity.set(element, false));
  } catch {
    elementActivity.set(element, false);
  }
}

export function shouldShowMediaFrame(ended: boolean, showNothingWhenPlaybackEnds: boolean): boolean {
  return !ended || !showNothingWhenPlaybackEnds;
}
