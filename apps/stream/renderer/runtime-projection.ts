import type { StreamSource } from '../shared/desktop-api';
import { getOriginSourceId, getSourceRuntimeId } from './source-runtime';

/** Editor controls address logical sources; resource owners use session-local runtime IDs. */
export function projectRuntimeMap<T>(sources: readonly StreamSource[], values: ReadonlyMap<string, T>): Map<string, T> {
  const origins = new Map<string, Set<string>>();
  for (const source of sources) {
    const runtimeId = getSourceRuntimeId(source);
    const sourceOrigins = origins.get(runtimeId) ?? new Set<string>();
    sourceOrigins.add(getOriginSourceId(source));
    origins.set(runtimeId, sourceOrigins);
  }
  const projected = new Map<string, T>();
  for (const [key, value] of values) {
    const resourceId = key.split(':', 1)[0]!;
    const sourceOrigins = origins.get(resourceId);
    if (!sourceOrigins) continue;
    const suffix = key.slice(resourceId.length);
    for (const origin of sourceOrigins) projected.set(origin + suffix, value);
  }
  return projected;
}

export function projectRuntimeRecord<T>(sources: readonly StreamSource[], values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(projectRuntimeMap(sources, new Map(Object.entries(values))));
}
