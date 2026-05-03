import type { Id, Overlay, OverlayAnimation } from '@core/types';

export type OverlayPlaybackMode = 'single' | 'multiple';
export type OverlayPlaybackState = 'entering' | 'live' | 'exiting';

export interface ActiveOverlayEntry {
  overlayId: Id;
  state: OverlayPlaybackState;
  startedAt: number;
  exitStartedAt: number | null;
  exitStartOpacity: number;
  stackOrder: number;
  autoClearAt: number | null;
}

export interface OverlayRenderLayer {
  overlayId: Id;
  overlay: Overlay;
  opacityMultiplier: number;
  state: OverlayPlaybackState;
  startedAt: number;
  remainingAutoClearMs: number | null;
  stackOrder: number;
}

export function normalizeOverlayAnimation(animation: OverlayAnimation): Required<OverlayAnimation> {
  const kind = animation.kind === 'fade' || animation.kind === 'pulse'
    ? 'dissolve'
    : animation.kind;
  const durationMs = Math.max(0, Number.isFinite(animation.durationMs) ? animation.durationMs : 0);
  const autoClearDurationMs = animation.autoClearDurationMs == null
    ? null
    : Math.max(0, Number.isFinite(animation.autoClearDurationMs) ? animation.autoClearDurationMs : 0);

  return {
    kind,
    durationMs,
    autoClearDurationMs,
  };
}

export function activateOverlayPlayback(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  overlayId: Id,
  mode: OverlayPlaybackMode,
  now: number,
): ActiveOverlayEntry[] {
  const overlay = overlaysById.get(overlayId);
  if (!overlay) return entries;

  const nextEntries = mode === 'single'
    ? entries.map((entry) => {
      if (entry.overlayId === overlayId) return refreshActiveOverlayEntry(entry, overlay, now);
      return beginOverlayExit(entry, overlaysById, now);
    }).filter(isActiveOverlayEntry)
    : entries.slice();

  const existingIndex = nextEntries.findIndex((entry) => entry.overlayId === overlayId);
  if (existingIndex >= 0) {
    nextEntries[existingIndex] = refreshActiveOverlayEntry(nextEntries[existingIndex], overlay, now);
    return nextEntries;
  }

  nextEntries.push(createActiveOverlayEntry(overlay, now, getNextStackOrder(nextEntries)));
  return nextEntries;
}

export function clearOverlayPlayback(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  overlayId: Id,
  now: number,
): ActiveOverlayEntry[] {
  return entries
    .map((entry) => (entry.overlayId === overlayId ? beginOverlayExit(entry, overlaysById, now) : entry))
    .filter(isActiveOverlayEntry);
}

export function clearAllOverlayPlayback(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): ActiveOverlayEntry[] {
  return entries
    .map((entry) => beginOverlayExit(entry, overlaysById, now))
    .filter(isActiveOverlayEntry);
}

export function collapseOverlayPlaybackToSingle(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): ActiveOverlayEntry[] {
  const liveEntries = entries.filter((entry) => entry.state !== 'exiting');
  if (liveEntries.length <= 1) return entries;

  const retainedEntry = liveEntries.reduce((latest, entry) => {
    return entry.stackOrder > latest.stackOrder ? entry : latest;
  }, liveEntries[0]);

  return entries
    .map((entry) => (entry.overlayId === retainedEntry.overlayId ? entry : beginOverlayExit(entry, overlaysById, now)))
    .filter(isActiveOverlayEntry);
}

export function advanceOverlayPlayback(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): ActiveOverlayEntry[] {
  return entries.flatMap((entry) => {
    const overlay = overlaysById.get(entry.overlayId);
    if (!overlay) return [];

    const animation = normalizeOverlayAnimation(overlay.animation);
    if (entry.state === 'entering') {
      if (animation.autoClearDurationMs !== null && entry.autoClearAt !== null && entry.autoClearAt <= now) {
        return beginOverlayExit(entry, overlaysById, now) ? [beginOverlayExit(entry, overlaysById, now) as ActiveOverlayEntry] : [];
      }
      if (animation.kind === 'none' || animation.durationMs === 0 || now - entry.startedAt >= animation.durationMs) {
        return [{
          ...entry,
          state: 'live',
          exitStartedAt: null,
          exitStartOpacity: 1,
        }];
      }
      return [entry];
    }

    if (entry.state === 'live') {
      if (animation.autoClearDurationMs !== null && entry.autoClearAt !== null && entry.autoClearAt <= now) {
        return beginOverlayExit(entry, overlaysById, now) ? [beginOverlayExit(entry, overlaysById, now) as ActiveOverlayEntry] : [];
      }
      return [entry];
    }

    if (animation.kind === 'none' || animation.durationMs === 0 || entry.exitStartedAt === null) {
      return [];
    }
    if (now - entry.exitStartedAt >= animation.durationMs) {
      return [];
    }
    return [entry];
  });
}

export function getOverlayRenderLayers(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): OverlayRenderLayer[] {
  return entries
    .map((entry) => {
      const overlay = overlaysById.get(entry.overlayId);
      if (!overlay) return null;

      return {
        overlayId: overlay.id,
        overlay,
        opacityMultiplier: resolveOverlayOpacity(entry, overlay, now),
        state: entry.state,
        startedAt: entry.startedAt,
        remainingAutoClearMs: resolveRemainingAutoClearMs(entry, overlay, now),
        stackOrder: entry.stackOrder,
      };
    })
    .filter(isOverlayRenderLayer)
    .sort((left, right) => left.stackOrder - right.stackOrder);
}

export function getNextOverlayPlaybackDelay(
  entries: ActiveOverlayEntry[],
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): number | null {
  let nextDelay: number | null = null;

  for (const entry of entries) {
    const overlay = overlaysById.get(entry.overlayId);
    if (!overlay) continue;

    const animation = normalizeOverlayAnimation(overlay.animation);
    if (entry.state === 'entering') {
      if (animation.kind !== 'none' && animation.durationMs > 0) {
        nextDelay = nextDelay == null ? 33 : Math.min(nextDelay, 33);
      }
      if (entry.autoClearAt !== null) {
        const autoClearDelay = Math.max(0, entry.autoClearAt - now);
        nextDelay = nextDelay == null ? autoClearDelay : Math.min(nextDelay, autoClearDelay);
      }
      continue;
    }

    if (entry.state === 'exiting') {
      if (animation.kind !== 'none' && animation.durationMs > 0 && entry.exitStartedAt !== null) {
        nextDelay = nextDelay == null ? 33 : Math.min(nextDelay, 33);
      }
      continue;
    }

    if (entry.autoClearAt !== null) {
      const autoClearDelay = Math.max(0, entry.autoClearAt - now);
      nextDelay = nextDelay == null ? autoClearDelay : Math.min(nextDelay, autoClearDelay);
    }
  }

  return nextDelay;
}

function createActiveOverlayEntry(overlay: Overlay, now: number, stackOrder: number): ActiveOverlayEntry {
  const animation = normalizeOverlayAnimation(overlay.animation);
  return {
    overlayId: overlay.id,
    state: animation.kind === 'none' || animation.durationMs === 0 ? 'live' : 'entering',
    startedAt: now,
    exitStartedAt: null,
    exitStartOpacity: 1,
    stackOrder,
    autoClearAt: animation.autoClearDurationMs === null ? null : now + animation.autoClearDurationMs,
  };
}

function refreshActiveOverlayEntry(entry: ActiveOverlayEntry, overlay: Overlay, now: number): ActiveOverlayEntry {
  const animation = normalizeOverlayAnimation(overlay.animation);
  if (entry.state === 'exiting') {
    return createActiveOverlayEntry(overlay, now, entry.stackOrder);
  }

  return {
    ...entry,
    autoClearAt: animation.autoClearDurationMs === null ? null : now + animation.autoClearDurationMs,
  };
}

function beginOverlayExit(
  entry: ActiveOverlayEntry,
  overlaysById: ReadonlyMap<Id, Overlay>,
  now: number,
): ActiveOverlayEntry | null {
  const overlay = overlaysById.get(entry.overlayId);
  if (!overlay) return null;

  const animation = normalizeOverlayAnimation(overlay.animation);
  if (animation.kind === 'none' || animation.durationMs === 0) {
    return null;
  }

  if (entry.state === 'exiting') return entry;

  return {
    ...entry,
    state: 'exiting',
    exitStartedAt: now,
    exitStartOpacity: resolveOverlayOpacity(entry, overlay, now),
    autoClearAt: null,
  };
}

function resolveOverlayOpacity(entry: ActiveOverlayEntry, overlay: Overlay, now: number): number {
  const animation = normalizeOverlayAnimation(overlay.animation);
  if (animation.kind === 'none' || animation.durationMs === 0) {
    return entry.state === 'exiting' ? 0 : 1;
  }

  if (entry.state === 'entering') {
    return clampOpacity((now - entry.startedAt) / animation.durationMs);
  }

  if (entry.state === 'exiting' && entry.exitStartedAt !== null) {
    const progress = clampOpacity((now - entry.exitStartedAt) / animation.durationMs);
    return clampOpacity(entry.exitStartOpacity * (1 - progress));
  }

  return 1;
}

function resolveRemainingAutoClearMs(entry: ActiveOverlayEntry, overlay: Overlay, now: number): number | null {
  const animation = normalizeOverlayAnimation(overlay.animation);
  if (animation.autoClearDurationMs === null || entry.autoClearAt === null) return null;
  if (entry.state === 'exiting') return null;
  return Math.max(0, entry.autoClearAt - now);
}

function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getNextStackOrder(entries: ActiveOverlayEntry[]): number {
  return entries.reduce((highest, entry) => Math.max(highest, entry.stackOrder), -1) + 1;
}

function isActiveOverlayEntry(entry: ActiveOverlayEntry | null): entry is ActiveOverlayEntry {
  return entry !== null;
}

function isOverlayRenderLayer(layer: OverlayRenderLayer | null): layer is OverlayRenderLayer {
  return layer !== null;
}
