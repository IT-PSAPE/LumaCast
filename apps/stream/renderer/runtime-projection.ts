import type { StreamSource } from '../shared/desktop-api';
import { getOriginSourceId, getSourceRuntimeId } from './source-runtime';

/** Editor controls address logical sources; resource owners use session-local runtime IDs. */
export function projectRuntimeMap<T>(sources: readonly StreamSource[], values: ReadonlyMap<string, T>): Map<string, T> {
  const origins = new Map(sources.map((source) => [getSourceRuntimeId(source), getOriginSourceId(source)]));
  const projected = new Map<string, T>();
  for (const [key, value] of values) {
    const resourceId = key.split(':', 1)[0]!;
    const origin = origins.get(resourceId);
    if (origin) projected.set(origin + key.slice(resourceId.length), value);
  }
  return projected;
}

export function projectRuntimeRecord<T>(sources: readonly StreamSource[], values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(projectRuntimeMap(sources, new Map(Object.entries(values))));
}
