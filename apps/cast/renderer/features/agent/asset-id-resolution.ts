// Agent-facing media references are stable asset ids; the RPC contract speaks
// `src`.
//
// An agent never sees a `cast-media:` token — those are opaque, minted by main,
// and meaningless as model context. The agent-facing schemas therefore expose
// `assetId` wherever the wire contract carries `src` on an image/video element
// payload or an image/video background. This walk closes that gap on the way
// in: the renderer's snapshot already holds the masked token main expects back,
// so resolving here needs no extra round trip.
//
// It is a pure function over plain data — no contexts, no IPC — so the
// dispatcher can apply it to every main-site action's params uniformly rather
// than remembering which shapes nest a media reference.
import type { Id } from '@lumacast/kernel';

/** Thrown when a referenced asset is not in the current snapshot. Reported as a failure naming the id. */
export class UnknownMediaAssetError extends Error {
  readonly assetId: string;

  constructor(assetId: string) {
    super(`Unknown media asset: ${assetId}`);
    this.name = 'UnknownMediaAssetError';
    this.assetId = assetId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-copies `value`, replacing `{ type: 'image' | 'video', assetId }` with
 * `{ type, src }` wherever the object carries no `src` of its own (the
 * agent-facing background/media-layer shape), and replacing
 * `{ type: 'image' | 'video', payload: { assetId } }` with
 * `{ type, payload: { src } }` wherever `payload` itself carries no `src`
 * (the agent-facing element shape, e.g. `AgentElementCreateInput` /
 * `AgentSlideElement`, where `assetId` lives one level down from the sibling
 * `type` field). An object that already has a `src` in the relevant place is
 * left alone, so a caller that speaks the wire contract directly still works.
 *
 * `srcForAssetId` returns `null` for an id the snapshot does not know, which
 * raises `UnknownMediaAssetError` rather than silently dropping the reference
 * and writing a media element that points at nothing.
 */
export function resolveAssetIdReferences<T>(value: T, srcForAssetId: (assetId: Id) => string | null): T {
  return walk(value, srcForAssetId) as T;
}

function resolveAssetId(assetId: Id, srcForAssetId: (assetId: Id) => string | null): string {
  const src = srcForAssetId(assetId);
  if (src === null) throw new UnknownMediaAssetError(assetId);
  return src;
}

function walk(value: unknown, srcForAssetId: (assetId: Id) => string | null): unknown {
  if (Array.isArray(value)) return value.map((entry) => walk(entry, srcForAssetId));
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) next[key] = walk(entry, srcForAssetId);

  const isMediaReference = next.type === 'image' || next.type === 'video';
  if (isMediaReference && typeof next.assetId === 'string' && next.src === undefined) {
    const assetId = next.assetId as Id;
    next.src = resolveAssetId(assetId, srcForAssetId);
    delete next.assetId;
  }
  const payload = next.payload;
  if (isMediaReference && isRecord(payload) && typeof payload.assetId === 'string' && payload.src === undefined) {
    const assetId = payload.assetId as Id;
    const { assetId: _assetId, ...rest } = payload;
    next.payload = { ...rest, src: resolveAssetId(assetId, srcForAssetId) };
  }
  return next;
}
