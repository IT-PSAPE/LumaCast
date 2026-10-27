import type { StreamSource } from '../shared/desktop-api';

export type SourceAvailabilityState = 'starting' | 'ready' | 'unavailable';

export interface SourceStatus {
  state: SourceAvailabilityState;
  /** Optional short reason shown as the status indicator's tooltip. */
  message?: string;
}

/** Status text is intentionally explicit so availability never depends on color alone. */
export function sourceAvailabilityLabel(status: SourceStatus): string | null {
  if (status.state === 'starting') return 'Starting';
  if (status.state === 'unavailable') return 'Unavailable';
  return null;
}

export function sourceAvailabilityDescription(sourceName: string, status: SourceStatus): string | null {
  const label = sourceAvailabilityLabel(status);
  if (!label) return null;
  return status.message ? `${sourceName}: ${label} — ${status.message}` : `${sourceName}: ${label}`;
}

/**
 * Merges resource decoding and capture readiness by runtime source ID.
 * Unavailable wins over starting, and starting wins over ready, so an already
 * loaded asset cannot hide a capture failure or a persistent decode error.
 */
export function mergeSourceStatuses(
  sources: readonly StreamSource[],
  captureStatuses: Readonly<Record<string, SourceStatus>>,
  resourceStatuses: Readonly<Record<string, SourceStatus>>,
): Record<string, SourceStatus> {
  const priority: Record<SourceAvailabilityState, number> = { ready: 0, starting: 1, unavailable: 2 };
  const merged: Record<string, SourceStatus> = {};

  for (const source of sources) {
    const reported = [captureStatuses[source.id], resourceStatuses[source.id]].filter((status): status is SourceStatus => status !== undefined);
    if (reported.length === 0) continue;
    merged[source.id] = reported.reduce((strongest, status) => priority[status.state] > priority[strongest.state] ? status : strongest);
  }

  return merged;
}
