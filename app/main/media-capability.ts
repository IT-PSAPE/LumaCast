// Managed-media capability boundary (issue #159, parent #119).
//
// The renderer must never be handed a persisted filesystem path. Every
// managed media source that leaves main is replaced by an opaque, scoped
// **managed media id**, and the privileged `cast-media:` scheme resolves that
// id back to a path server-side. The renderer therefore holds a capability
// (an unguessable reference main issued for one declared media use) instead of
// a location it could edit into a different location.
//
// Storage is deliberately *not* migrated. The database keeps storing
// `cast-media://<encodeURIComponent(absolutePath)>` in `media_assets.src`, in
// slide/theme/overlay/stage backgrounds, and in image/video element payloads,
// because that stored path is the asset's identity for the features that need
// it main-side: broken-source detection, deck-bundle export/relink, import
// dedupe, and the migration in `app/database/migrations/definitions.ts`.
// Managed ids are session-scoped capabilities, not durable identifiers, so
// persisting them would be wrong on its own terms (they would not survive a
// restart, a backup, or a bundle export). The translation therefore happens at
// the main <-> renderer boundary, in both directions:
//
//   - outbound (`maskManagedMediaResult`): stored source -> `cast-media://<id>`
//   - inbound  (`resolveManagedMediaArgs`): `cast-media://<id>` -> stored source
//
// Inbound resolution returns the *byte-identical* stored string, which is what
// keeps undo/redo (`restoreFromSnapshot`, which diffs a renderer-held snapshot
// against the database) from seeing a spurious change on every media row.
//
// What is NOT generalized into this mechanism (per the issue's fixed
// decisions): a file the user just picked in a native dialog or dropped onto
// the window. That path reaches the renderer through `webUtils.getPathForFile`
// / `chooseImportReplacementMediaPath` and is written back as a raw
// `cast-media://<encoded path>` string. Those stay short-lived import
// capabilities and pass through the inbound transform untouched; see
// docs/adr/0007-renderer-navigation-trust.md for the residual exposure that
// leaves and why closing it is separate work.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { MediaAsset, Slide, SlideBackground, SlideElement } from '@lumacast/composition';
import type { SnapshotPatch } from '@lumacast/protocol';
import { resolveLocalMediaSourcePath } from './media-source-path';
import type { AppSnapshot } from '@lumacast/protocol';

/**
 * The declared media use a grant is issued for. Taken from the entity that
 * carried the source outbound (`MediaAsset.type`, `SlideBackground.type`, or
 * the image/video element's `type`) — never from renderer input.
 */
export type ManagedMediaUse = 'image' | 'video' | 'audio';

export const MANAGED_MEDIA_SCHEME = 'cast-media:';
const MANAGED_MEDIA_URL_PREFIX = `${MANAGED_MEDIA_SCHEME}//`;

// A managed media id is exactly `m` + 32 lowercase hex characters. Two
// properties matter:
//   1. It is URL-safe by construction, so `cast-media://<id>` needs no
//      escaping and has no alternate encodings to normalize away.
//   2. It cannot be confused with the percent-encoded path form the database
//      stores: an encoded absolute path always contains `%` (`%2F` on POSIX,
//      `%3A`/`%5C` on Windows) or a separator, and this pattern admits
//      neither. That is what lets the inbound transform tell a managed
//      capability apart from a short-lived import path without a second
//      scheme or a marker field.
const MANAGED_MEDIA_ID_PATTERN = /^m[0-9a-f]{32}$/;

/** Every way resolution can fail. Carries no path information by design. */
export type ManagedMediaFailure =
  | 'malformed-id'
  | 'unsupported-scheme'
  | 'unknown-id'
  | 'revoked-id'
  | 'use-mismatch';

export type ManagedMediaResolution =
  | {
    ok: true;
    id: string;
    /** The use this grant was declared for. */
    use: ManagedMediaUse;
    /** The stored source string, byte-identical to what the database holds. */
    source: string;
    /** The absolute, normalized filesystem path the grant points at. */
    filePath: string;
    /** The managed URL for this grant, standards-correct and fully encoded. */
    url: string;
  }
  | { ok: false; reason: ManagedMediaFailure };

/**
 * Thrown when a renderer-supplied value *is* a managed reference but cannot be
 * resolved. The message deliberately carries only the failure reason: never
 * the id, never a path, never the offending string.
 */
export class ManagedMediaError extends Error {
  readonly reason: ManagedMediaFailure;

  constructor(reason: ManagedMediaFailure) {
    super(`Unresolvable managed media reference (${reason})`);
    this.name = 'ManagedMediaError';
    this.reason = reason;
  }
}

interface ManagedMediaGrant {
  id: string;
  use: ManagedMediaUse;
  source: string;
  filePath: string;
}

/** `cast-media://<id>`. `encodeURIComponent` is identity for the id charset. */
export function managedMediaUrl(id: string): string {
  return `${MANAGED_MEDIA_URL_PREFIX}${encodeURIComponent(id)}`;
}

type ParsedReference = { ok: true; id: string } | { ok: false; reason: ManagedMediaFailure };

/**
 * Parses a renderer-supplied reference — either a bare managed id or a full
 * `cast-media://<id>` URL — into an id, rejecting everything else.
 *
 * Traversal segments (`..`), separators (`/`, `\`) and their encoded forms
 * (`%2F`, `%5C`, `%2E%2E`, and any double-encoding of them) all fail the id
 * pattern and are reported as `malformed-id`; there is no path parsing here to
 * confuse, because a managed reference never contains a path. Any other
 * scheme (`file:`, `blob:`, `http:`, `javascript:`) is `unsupported-scheme`.
 */
export function parseManagedMediaReference(reference: string): ParsedReference {
  if (!reference) return { ok: false, reason: 'malformed-id' };

  let candidate = reference;
  const schemeEnd = reference.indexOf('://');
  if (schemeEnd >= 0) {
    if (reference.slice(0, schemeEnd + 1) !== MANAGED_MEDIA_SCHEME) {
      return { ok: false, reason: 'unsupported-scheme' };
    }
    candidate = reference.slice(MANAGED_MEDIA_URL_PREFIX.length);
  } else if (reference.includes(':')) {
    // `blob:…`, `data:…`, `javascript:…`, `file:/…` — schemes without an
    // authority. Rejected on the scheme, before anything looks at the rest.
    return { ok: false, reason: 'unsupported-scheme' };
  }

  // Chromium may present an authority-only URL with a trailing slash.
  if (candidate.endsWith('/')) candidate = candidate.slice(0, -1);
  // Case-fold defensively: the id charset is lowercase hex, and a future
  // `standard: true` scheme registration would lowercase the authority.
  if (!MANAGED_MEDIA_ID_PATTERN.test(candidate.toLowerCase())) {
    return { ok: false, reason: 'malformed-id' };
  }

  return { ok: true, id: candidate.toLowerCase() };
}

/**
 * True when a string is shaped like a managed capability URL. Used by the
 * inbound transform to decide whether a `cast-media:` value must resolve
 * against the registry (a managed id) or passes through as a short-lived
 * user-selected import path.
 */
export function looksLikeManagedMediaReference(value: string): boolean {
  if (!value.startsWith(MANAGED_MEDIA_URL_PREFIX)) return false;
  return parseManagedMediaReference(value).ok;
}

/**
 * `image` grants and timed-media (`video`/`audio`) grants are separate
 * families. Within the timed-media family the distinction is not enforceable
 * and must not be: an `<audio>` element is a legitimate consumer of a video
 * container's audio track, and the app plays audio assets through `<audio>`
 * and video assets through `<video>` interchangeably in the playback layer.
 * What is rejected is cross-family use — fetching an image grant as a media
 * stream, or a media grant as an image.
 */
function isCompatibleUse(granted: ManagedMediaUse, intended: ManagedMediaUse): boolean {
  if (granted === intended) return true;
  return granted !== 'image' && intended !== 'image';
}

/**
 * Normalizes a stored source into the absolute path a grant may point at, or
 * null when the source is not path-bearing at all (`blob:`, `http(s):`, a
 * relative string, empty). `path.resolve` + `path.normalize` already collapse
 * traversal; the explicit `..` check is a second, cheap assertion that no
 * segment survived, since this is the one place a path enters the registry.
 */
function normalizeGrantablePath(source: string): string | null {
  const localPath = resolveLocalMediaSourcePath(source);
  if (!localPath) return null;

  const normalized = path.normalize(path.resolve(localPath));
  if (!path.isAbsolute(normalized)) return null;
  if (normalized.split(/[\\/]/).includes('..')) return null;
  return normalized;
}

/**
 * Main-owned, session-scoped registry of managed media capabilities.
 *
 * Grants are keyed by `(declared use, stored source string)`, not by resolved
 * path: the stored string is what inbound resolution has to hand back
 * byte-identically, so two stored spellings of the same file deliberately get
 * two grants rather than collapsing onto whichever spelling was seen first.
 */
export class ManagedMediaRegistry {
  #grantsById = new Map<string, ManagedMediaGrant>();
  #idsByGrantKey = new Map<string, string>();
  #revokedIds = new Set<string>();

  /**
   * Issues (or reuses) the capability for a stored source and declared use.
   * Returns null when the source is not path-bearing, in which case the
   * caller leaves the value alone — there is no path to hide.
   */
  grant(source: string, use: ManagedMediaUse): string | null {
    const filePath = normalizeGrantablePath(source);
    if (!filePath) return null;

    const grantKey = `${use} ${source}`;
    const existingId = this.#idsByGrantKey.get(grantKey);
    if (existingId) return existingId;

    const id = `m${randomBytes(16).toString('hex')}`;
    this.#grantsById.set(id, { id, use, source, filePath });
    this.#idsByGrantKey.set(grantKey, id);
    return id;
  }

  /**
   * The resolver: one managed reference plus the intended media use.
   * `intendedUse` is null only for callers that genuinely cannot know it (a
   * protocol request whose `Sec-Fetch-Dest` is absent or not a media
   * destination); every other caller passes the use it intends and gets
   * `use-mismatch` when the grant was declared for the other family.
   */
  resolve(reference: string, intendedUse: ManagedMediaUse | null = null): ManagedMediaResolution {
    const parsed = parseManagedMediaReference(reference);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };

    // Revoked before unknown: a capability that was withdrawn reports that it
    // was withdrawn, rather than being indistinguishable from a guess.
    if (this.#revokedIds.has(parsed.id)) return { ok: false, reason: 'revoked-id' };

    const grant = this.#grantsById.get(parsed.id);
    if (!grant) return { ok: false, reason: 'unknown-id' };

    if (intendedUse && !isCompatibleUse(grant.use, intendedUse)) {
      return { ok: false, reason: 'use-mismatch' };
    }

    return {
      ok: true,
      id: grant.id,
      use: grant.use,
      source: grant.source,
      filePath: grant.filePath,
      url: managedMediaUrl(grant.id),
    };
  }

  /** Withdraws one capability. Returns false for an unparseable reference. */
  revoke(reference: string): boolean {
    const parsed = parseManagedMediaReference(reference);
    if (!parsed.ok) return false;

    const grant = this.#grantsById.get(parsed.id);
    if (grant) {
      this.#grantsById.delete(grant.id);
      this.#idsByGrantKey.delete(`${grant.use} ${grant.source}`);
    }
    this.#revokedIds.add(parsed.id);
    return true;
  }

  /**
   * Withdraws every capability issued so far. Used when the project's entire
   * media inventory is replaced under the renderer (project recovery swaps the
   * database file), so no id minted from the pre-recovery project keeps
   * resolving. The revoked-id set is retained on purpose — a withdrawn
   * capability must stay distinguishable from an unknown one for the rest of
   * the session.
   */
  revokeAll(): void {
    for (const id of this.#grantsById.keys()) this.#revokedIds.add(id);
    this.#grantsById.clear();
    this.#idsByGrantKey.clear();
  }

  revokeGrant(source: string, use: ManagedMediaUse): boolean {
    const existingId = this.#idsByGrantKey.get(`${use} ${source}`);
    if (!existingId) return false;
    return this.revoke(existingId);
  }

  /** Test/diagnostic hook: number of live (non-revoked) capabilities. */
  get size(): number {
    return this.#grantsById.size;
  }
}

/**
 * The process-wide registry. Main is the only process that can reach it; the
 * renderer only ever sees ids it produced.
 */
export const managedMediaRegistry = new ManagedMediaRegistry();

export function resolveManagedMedia(
  reference: string,
  intendedUse: ManagedMediaUse | null = null,
): ManagedMediaResolution {
  return managedMediaRegistry.resolve(reference, intendedUse);
}

export function revokeAllManagedMedia(): void {
  managedMediaRegistry.revokeAll();
}

export function revokeManagedMediaSource(source: string, use: ManagedMediaUse): boolean {
  return managedMediaRegistry.revokeGrant(source, use);
}

// ─── Outbound: stored source -> managed capability ──────────────────────────

/**
 * Replaces one stored source with its managed URL.
 *
 * - Not path-bearing (`blob:`, `http(s):`, relative, empty): returned
 *   unchanged. There is nothing to disclose, and rewriting it would change
 *   behavior for values the renderer already handles as-is.
 * - Path-bearing but ungrantable: returned as the empty string, which is how
 *   the renderer already represents "no media source". A path never leaks
 *   through this function.
 */
export function maskManagedMediaSource(source: string, use: ManagedMediaUse): string {
  if (!source) return source;
  if (looksLikeManagedMediaReference(source)) return source;
  if (!resolveLocalMediaSourcePath(source)) return source;

  const id = managedMediaRegistry.grant(source, use);
  if (!id) return '';
  return managedMediaUrl(id);
}

function maskBackground(background: SlideBackground | null | undefined): SlideBackground | null | undefined {
  if (!background) return background;
  if (background.type !== 'image' && background.type !== 'video') return background;

  const src = maskManagedMediaSource(background.src, background.type);
  return src === background.src ? background : { ...background, src };
}

// The payload union is read structurally here (one field, by name) rather than
// narrowed per variant: masking cares only about `src` on image/video and
// `children` on group, and re-narrowing the whole union would add nothing.
function payloadFields(payload: SlideElement['payload']): Record<string, unknown> {
  return payload as unknown as Record<string, unknown>;
}

function withPayloadFields(element: SlideElement, fields: Record<string, unknown>): SlideElement {
  return { ...element, payload: fields as unknown as SlideElement['payload'] };
}

function maskElement(element: SlideElement): SlideElement {
  const fields = payloadFields(element.payload);

  if (element.type === 'group') {
    const children = fields.children;
    if (!Array.isArray(children)) return element;
    const nested = (children as SlideElement[]).map(maskElement);
    if (nested.every((child, index) => child === children[index])) return element;
    return withPayloadFields(element, { ...fields, children: nested });
  }

  if (element.type !== 'image' && element.type !== 'video') return element;
  if (typeof fields.src !== 'string') return element;

  const src = maskManagedMediaSource(fields.src, element.type);
  if (src === fields.src) return element;
  return withPayloadFields(element, { ...fields, src });
}

function maskMediaAsset(asset: MediaAsset): MediaAsset {
  const src = maskManagedMediaSource(asset.src, asset.type);
  const thumbnailSrc = typeof asset.thumbnailSrc === 'string'
    ? maskManagedMediaSource(asset.thumbnailSrc, 'image')
    : asset.thumbnailSrc;
  if (src === asset.src && thumbnailSrc === asset.thumbnailSrc) return asset;
  return { ...asset, src, thumbnailSrc };
}

function maskSlide(slide: Slide): Slide {
  const background = maskBackground(slide.background);
  return background === slide.background ? slide : { ...slide, background };
}

/** Themes, overlays and stages all carry a background plus owned elements. */
interface CompositionEntity {
  background?: SlideBackground | null;
  elements: SlideElement[];
}

function maskComposition<T extends CompositionEntity>(entity: T): T {
  const background = maskBackground(entity.background);
  const elements = entity.elements.map(maskElement);
  const elementsChanged = elements.some((element, index) => element !== entity.elements[index]);
  if (background === entity.background && !elementsChanged) return entity;
  return { ...entity, background, elements } as T;
}

function mapChanged<T>(items: T[] | undefined, map: (item: T) => T): T[] | undefined {
  if (!items) return items;
  const mapped = items.map(map);
  return mapped.some((item, index) => item !== items[index]) ? mapped : items;
}

function hasOwnKey(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function maskAppSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    mediaAssets: mapChanged(snapshot.mediaAssets, maskMediaAsset) ?? snapshot.mediaAssets,
    slides: mapChanged(snapshot.slides, maskSlide) ?? snapshot.slides,
    slideElements: mapChanged(snapshot.slideElements, maskElement) ?? snapshot.slideElements,
    presentationThemes: mapChanged(snapshot.presentationThemes, maskComposition) ?? snapshot.presentationThemes,
    lyricThemes: mapChanged(snapshot.lyricThemes, maskComposition) ?? snapshot.lyricThemes,
    talkThemes: mapChanged(snapshot.talkThemes, maskComposition) ?? snapshot.talkThemes,
    overlayThemes: mapChanged(snapshot.overlayThemes, maskComposition) ?? snapshot.overlayThemes,
    overlays: mapChanged(snapshot.overlays, maskComposition) ?? snapshot.overlays,
    stages: mapChanged(snapshot.stages, maskComposition) ?? snapshot.stages,
  };
}

export function maskSnapshotPatch(patch: SnapshotPatch): SnapshotPatch {
  const { upserts } = patch;
  let nextUpserts = upserts;

  const assignMasked = <K extends keyof SnapshotPatch['upserts']>(
    key: K,
    map: (item: NonNullable<SnapshotPatch['upserts'][K]>[number]) => NonNullable<SnapshotPatch['upserts'][K]>[number],
  ) => {
    if (!hasOwnKey(upserts, key)) return;
    const current = upserts[key];
    const masked = mapChanged(current, map as (item: NonNullable<SnapshotPatch['upserts'][K]>[number]) => NonNullable<SnapshotPatch['upserts'][K]>[number]);
    if (masked === current) return;
    if (nextUpserts === upserts) nextUpserts = { ...upserts };
    nextUpserts[key] = masked as SnapshotPatch['upserts'][K];
  };

  assignMasked('mediaAssets', maskMediaAsset);
  assignMasked('slides', maskSlide);
  assignMasked('slideElements', maskElement);
  assignMasked('presentationThemes', maskComposition);
  assignMasked('lyricThemes', maskComposition);
  assignMasked('talkThemes', maskComposition);
  assignMasked('overlayThemes', maskComposition);
  assignMasked('overlays', maskComposition);
  assignMasked('stages', maskComposition);

  if (nextUpserts === upserts) return patch;

  return {
    ...patch,
    upserts: nextUpserts,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isSnapshotPatchLike(value: Record<string, unknown>): boolean {
  return typeof value.version === 'number' && isPlainObject(value.upserts) && isPlainObject(value.deletes);
}

function isAppSnapshotLike(value: Record<string, unknown>): boolean {
  return Array.isArray(value.mediaAssets) && Array.isArray(value.slideElements) && Array.isArray(value.slides);
}

/**
 * Masks every media-bearing RPC result shape. Deliberately structural and
 * closed: `SnapshotPatch`, `AppSnapshot`, and the two wrappers that nest them
 * (`{ itemId, patch }` from deck creation/duplication, `{ snapshot,
 * retainedDatabasePath }` from project recovery). Everything else is returned
 * untouched, so results that legitimately carry a main-side path — the
 * export/import dialog paths, `obsGetCurrentLogPath`, the retained
 * pre-recovery database path, deck-bundle manifest media references shown in
 * the relink UI — keep working exactly as before. Those are separate,
 * user-initiated capabilities, not managed media (see the module header).
 */
export function maskManagedMediaResult(result: unknown): unknown {
  if (!isPlainObject(result)) return result;

  if (isSnapshotPatchLike(result)) return maskSnapshotPatch(result as unknown as SnapshotPatch);
  if (isAppSnapshotLike(result)) return maskAppSnapshot(result as unknown as AppSnapshot);

  if (isPlainObject(result.patch) && isSnapshotPatchLike(result.patch)) {
    return { ...result, patch: maskSnapshotPatch(result.patch as unknown as SnapshotPatch) };
  }
  if (isPlainObject(result.snapshot) && isAppSnapshotLike(result.snapshot)) {
    return { ...result, snapshot: maskAppSnapshot(result.snapshot as unknown as AppSnapshot) };
  }

  return result;
}

// ─── Inbound: managed capability -> stored source ───────────────────────────

/**
 * Resolves one renderer-supplied string.
 *
 * A value shaped like a managed capability must resolve, or the whole
 * operation is rejected — silently storing an unresolvable id would write a
 * session-scoped token into the database. Anything else (a short-lived
 * user-selected import path, a `blob:`/`data:` URL, plain text) is returned
 * unchanged: this transform is a translator, not a validator, and the RPC
 * codecs in `app/contracts/codecs.ts` remain the validation boundary.
 */
export function resolveManagedMediaSource(value: string): string {
  if (!value.startsWith(MANAGED_MEDIA_URL_PREFIX)) return value;
  if (!looksLikeManagedMediaReference(value)) return value;

  const resolved = managedMediaRegistry.resolve(value);
  if (!resolved.ok) throw new ManagedMediaError(resolved.reason);
  return resolved.source;
}

function stripRendererThumbnailSrcFromPatch(patch: SnapshotPatch): SnapshotPatch {
  if (!patch.upserts.mediaAssets) return patch;
  const mediaAssets = patch.upserts.mediaAssets.map((asset) => {
    if (!Object.hasOwn(asset, 'thumbnailSrc')) return asset;
    return { ...asset, thumbnailSrc: undefined };
  });
  if (mediaAssets.every((asset, index) => asset === patch.upserts.mediaAssets?.[index])) return patch;
  return {
    ...patch,
    upserts: {
      ...patch.upserts,
      mediaAssets,
    },
  };
}

function stripRendererThumbnailSrcFromSnapshot(snapshot: AppSnapshot): AppSnapshot {
  const mediaAssets = snapshot.mediaAssets.map((asset) => {
    if (!Object.hasOwn(asset, 'thumbnailSrc')) return asset;
    return { ...asset, thumbnailSrc: undefined };
  });
  return mediaAssets.every((asset, index) => asset === snapshot.mediaAssets[index])
    ? snapshot
    : { ...snapshot, mediaAssets };
}

function stripRendererThumbnailSrc(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  if (isSnapshotPatchLike(value)) return stripRendererThumbnailSrcFromPatch(value as unknown as SnapshotPatch);
  if (isAppSnapshotLike(value)) return stripRendererThumbnailSrcFromSnapshot(value as unknown as AppSnapshot);
  if (isPlainObject(value.patch) && isSnapshotPatchLike(value.patch)) {
    return {
      ...value,
      patch: stripRendererThumbnailSrcFromPatch(value.patch as unknown as SnapshotPatch),
    };
  }
  if (isPlainObject(value.snapshot) && isAppSnapshotLike(value.snapshot)) {
    return {
      ...value,
      snapshot: stripRendererThumbnailSrcFromSnapshot(value.snapshot as unknown as AppSnapshot),
    };
  }
  return value;
}

function resolveDeep(value: unknown): unknown {
  if (typeof value === 'string') return resolveManagedMediaSource(value);
  if (Array.isArray(value)) {
    const mapped = value.map(resolveDeep);
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  if (!isPlainObject(value)) return value;

  let changed = false;
  const next: Record<string, unknown> = {};
  // `Object.entries` keeps explicitly-undefined keys, which the structured
  // clone across IPC preserved; dropping them would change payload shape.
  for (const [key, entry] of Object.entries(value)) {
    const resolved = resolveDeep(entry);
    if (resolved !== entry) changed = true;
    next[key] = resolved;
  }
  return changed ? next : value;
}

/**
 * Translates every managed capability anywhere in an RPC argument list back to
 * its stored source. Applied structurally rather than per-operation because
 * managed ids arrive in a dozen shapes — a bare `src` argument, a create
 * input's payload, whole `elements` arrays for themes/overlays/stages, and the
 * complete `AppSnapshot` undo/redo round-trips through `restoreFromSnapshot`
 * — and a per-operation list would silently miss the next one added.
 */
export function resolveManagedMediaArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => resolveDeep(stripRendererThumbnailSrc(arg)));
}
