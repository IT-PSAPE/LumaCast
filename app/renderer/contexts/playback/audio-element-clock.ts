/** Read transport truth without waiting for React or timeupdate events. */
export function isAudioElementRunning(
  element: Pick<HTMLAudioElement, 'paused' | 'ended' | 'readyState' | 'dataset'> | null,
  assetId: string | null,
  requestedPlay: boolean,
): boolean {
  return Boolean(requestedPlay && assetId && element && element.dataset.assetId === assetId
    && !element.paused && !element.ended && element.readyState >= 2);
}
