import { useSyncExternalStore } from 'react';

interface FontFaceSetLike {
  ready: Promise<unknown>;
  addEventListener?: (type: 'loadingdone', listener: () => void) => void;
  removeEventListener?: (type: 'loadingdone', listener: () => void) => void;
}

function getDocumentFonts(): FontFaceSetLike | null {
  if (typeof document === 'undefined') return null;
  return (document as Document & { fonts?: FontFaceSetLike }).fonts ?? null;
}

let epoch = 0;
let activeFonts: FontFaceSetLike | null = null;
let trackedFonts: FontFaceSetLike | null = null;
let observedReady: Promise<unknown> | null = null;
let pendingReady: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function observeReady(fonts: FontFaceSetLike) {
  const readyPromise = fonts.ready;
  if (readyPromise === observedReady || readyPromise === pendingReady) return;

  pendingReady = readyPromise;
  void readyPromise.then(() => {
    if (pendingReady !== readyPromise) return;
    pendingReady = null;
    if (observedReady === readyPromise) return;
    observedReady = readyPromise;
    epoch += 1;
    emitChange();
  }).catch(() => {
    if (pendingReady === readyPromise) pendingReady = null;
  });
}

function handleLoadingDone() {
  const fonts = activeFonts ?? getDocumentFonts();
  if (!fonts) return;
  observeReady(fonts);
}

function syncActiveFonts() {
  const nextFonts = getDocumentFonts();
  if (nextFonts === activeFonts) {
    if (nextFonts) observeReady(nextFonts);
    return;
  }

  activeFonts?.removeEventListener?.('loadingdone', handleLoadingDone);
  activeFonts = nextFonts;
  if (trackedFonts !== nextFonts) {
    trackedFonts = nextFonts;
    observedReady = null;
    pendingReady = null;
  }

  if (!activeFonts) return;

  activeFonts.addEventListener?.('loadingdone', handleLoadingDone);
  observeReady(activeFonts);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    syncActiveFonts();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      activeFonts?.removeEventListener?.('loadingdone', handleLoadingDone);
      activeFonts = null;
      pendingReady = null;
    }
  };
}

function getSnapshot() {
  return epoch;
}

export function useFontAvailabilityEpoch(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
