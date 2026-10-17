import type { StreamSource } from '../shared/desktop-api';

export function duplicateSource(source: StreamSource, id = crypto.randomUUID()): StreamSource {
  const copy = structuredClone(source);
  return {
    ...copy,
    id,
    name: `Copy of ${source.name}`.slice(0, 120),
    transform: { ...copy.transform, x: copy.transform.x + 40, y: copy.transform.y + 40 },
  };
}
