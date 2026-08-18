# ADR-0008: Managed Media Capabilities at the Renderer Boundary

## Status

Accepted

## Context

Issue #159 (parent #119) closes the second half of the renderer-trust gap that
ADR-0007 opened. ADR-0007 stopped a compromised renderer from *navigating*
anywhere it liked. It explicitly left the `cast-media:` resource-fetch boundary
alone, noting only that it was "gated by `resolveTrustedCastMediaRequest`
(referrer-checked … then resolved through `resolveLocalMediaSourcePath`)".

That gate was weaker than it read. `resolveLocalMediaSourcePath` decodes a
percent-encoded absolute filesystem path *out of the URL the renderer supplied*.
The renderer therefore held a location, not a reference: every media asset,
slide/theme/overlay/stage background, and image/video element payload that
crossed IPC carried an absolute path (`/Users/<name>/…`), and the renderer could
edit any of those strings into a different path and fetch it. The referrer check
established that the request came from the app's own window — which is precisely
the assumption that fails in the threat model ADR-0007 was written for (a
supply-chain compromise, or untrusted content reaching the DOM). Two distinct
problems, then: **disclosure** (paths leak usernames and directory layout into
renderer memory, the DOM, and anything that can read them) and **authority**
(holding a path is holding permission to read that path).

The renderer has no legitimate use for the path itself. It renders `src`, hands
it back on a mutation, and compares it for equality. Every consumer that needed
a real path — broken-source detection, deck-bundle export/relink, import
dedupe, cover-art extraction, the v22 migration — runs in main or the database
layer.

## Decision

- **The renderer holds capabilities, not locations.** Every media source
  crossing the IPC boundary outbound is replaced by an opaque **managed media
  id** in the form `cast-media://<id>`, where `<id>` is `m` + 32 hex characters
  from `randomBytes(16)`. Main mints ids and resolves them; the renderer treats
  them as opaque URLs it may render or hand back, and never constructs or
  parses one.
- **The id space cannot express a path.** The id pattern admits no separator,
  no `%`, and no `.`, so traversal, encoded separators, and double-encoded
  forms all fail the pattern rather than being normalized away. There is no
  path parsing in the resolver to confuse, because a managed reference never
  contains a path. This is also what lets the inbound transform tell a managed
  capability apart from an import path without a second scheme or a marker
  field.
- **Storage is deliberately not migrated.** The database keeps storing
  `cast-media://<encodeURIComponent(absolutePath)>`. Managed ids are
  session-scoped capabilities, not durable identifiers — persisting them would
  be wrong on its own terms, since they survive neither a restart, a backup,
  nor a bundle export. The translation is therefore a boundary concern, applied
  in both directions in `app/main/media-capability.ts`:
  - outbound (`maskManagedMediaResult`): stored source → `cast-media://<id>`
  - inbound (`resolveManagedMediaArgs`): `cast-media://<id>` → stored source
- **Translation is wired once, structurally, at the RPC dispatch loop** in
  `app/main/ipc.ts`'s `registerRpcHandlers`, not per handler. An operation
  cannot be added that accidentally hands the renderer a filesystem path, and
  no repository method has to know managed ids exist. The inbound transform
  walks arguments structurally because managed ids arrive in a dozen shapes (a
  bare `src` argument, a create input's payload, whole `elements` arrays, an
  entire `AppSnapshot` on undo/redo) and a per-operation list would silently
  miss the next one added.
- **Inbound resolution returns the byte-identical stored string.** This is what
  keeps `restoreFromSnapshot` — which diffs a renderer-held snapshot against
  the database — from seeing a spurious change on every media row. Grants are
  therefore keyed by `(declared use, stored source string)`, not by resolved
  path, so two stored spellings of one file get two grants rather than
  collapsing onto whichever was seen first.
- **A managed-shaped reference that does not resolve rejects the whole
  operation** (`ManagedMediaError`). Passing it through would write a
  session-scoped token into the database.
- **Grants carry a declared use**, taken from the entity that carried the
  source outbound (`MediaAsset.type`, `SlideBackground.type`, the element's
  `type`) — never from renderer input. `image` and timed media (`video`/`audio`)
  are separate families and cross-family use is denied. Within timed media the
  distinction is deliberately *not* enforced: an `<audio>` element is a
  legitimate consumer of a video container's audio track, and the playback layer
  plays audio and video assets through both elements interchangeably.
- **The protocol handler takes intended use from `Sec-Fetch-Dest`**, which
  Chromium sets from the element that issued the fetch and the renderer cannot
  forge. When the header is absent or not a media destination (Chromium omits
  it for some cross-scheme fetches, and `fetch()` reports `empty`), the grant
  resolves as declared and no cross-family check runs. Failing closed on an
  absent header would break media loading wherever Chromium omits it for this
  non-standard scheme.
- **`getAudioCoverArt` resolves its own argument** with an explicit `'audio'`
  use, and is the single entry in `SELF_RESOLVING_MEDIA_OPERATIONS`. It must
  assert the declared use of the id it is handed, which the generic argument
  transform does not do: a background or element may legitimately reference any
  granted media, while cover art may not. Failure returns `null` — the same "no
  cover art" result an unreadable file already produced — disclosing neither a
  path nor a reason.
- **Denials disclose nothing.** `ManagedMediaFailure` is a closed set of reason
  codes (`malformed-id`, `unsupported-scheme`, `unknown-id`, `revoked-id`,
  `use-mismatch`) carrying no path, no id, and no offending string. The
  protocol handler logs the reason code alone. `revoked-id` is reported ahead of
  `unknown-id` on purpose: a withdrawn capability stays distinguishable from a
  guess for the rest of the session.
- **Project recovery revokes everything.** `restoreProjectBackup` swaps the
  database out from under the renderer, so `revokeAllManagedMedia()` withdraws
  every id minted from the pre-recovery project. The masked result re-mints
  grants for the restored project, so the renderer's new snapshot is complete
  and any id it still holds from the replaced project now fails as
  `revoked-id`.
- **A path-bearing source that cannot be granted is masked to the empty
  string**, which is how the renderer already represents "no media source". A
  path never leaks through the masking function. Sources that carry no path at
  all (`blob:`, `http(s):`, relative, empty) are returned unchanged — there is
  nothing to disclose, and rewriting them would change behavior for values the
  renderer already handles as-is.

### What is deliberately not generalized

A file the user just selected in a native dialog or dropped on the window
reaches the renderer through `webUtils.getPathForFile` /
`chooseImportReplacementMediaPath`, and travels back inbound as a raw
`cast-media://<encoded path>` string. These stay **short-lived import
capabilities** and pass through the inbound transform untouched.

They are not renderable: the protocol handler serves managed ids only, so
fetching that string is denied. The renderable source is the `src` main returns
on the persisted asset. `castMediaSrc` in `app/renderer/utils/slides.ts` is
documented accordingly — pass its result to an IPC mutation and render what
comes back.

This leaves a residual, narrower exposure: the renderer briefly learns the path
of a file the user themselves just chose. Closing that means moving file
selection wholly behind main-issued import tokens, which is separate work with
its own boundary; it is recorded here rather than left implicit.

### Consequence for renderer code that predicted a source string

`MediaPickerDialog` previously predicted the `src` of a just-uploaded asset by
encoding the selected file's path, then matched it against the refreshed bin to
auto-select what the upload produced. A managed id cannot be predicted, by
construction. It now records the asset **ids** the bin held before the import
and selects whatever is new afterwards, which is a more direct statement of the
same intent.

## Consequences

- A compromised renderer can fetch only files main has already granted it a
  capability for, in the family that capability was granted for. It cannot name
  a file, and cannot widen a grant it holds into a different one.
- Absolute filesystem paths no longer reach renderer memory or the DOM for
  managed media, so they cannot leak through the renderer's own surfaces.
- Managed ids are session-scoped. Anything that must survive a restart, a
  backup, or a bundle export continues to use the stored source, which is
  unchanged on disk — so this change is invisible to the project backup format
  (ADR-0006) and to the deck-bundle manifest.
- The renderer can no longer derive a media source string for a file it knows
  the path of. Any future feature that wants to must round-trip through main,
  which is the intended direction.
- Masking is structural and closed: it recognizes `SnapshotPatch`, `AppSnapshot`,
  and the two wrappers that nest them. A future result shape that carries media
  must be added to `maskManagedMediaResult`, or its media will cross unmasked.
  This is a known maintenance edge, chosen over a blanket deep-walk of every
  result so that results which legitimately carry a main-side path — export and
  import dialog paths, `obsGetCurrentLogPath`, the retained pre-recovery
  database path, deck-bundle manifest media references shown in the relink UI —
  keep working unchanged.
- ADR-0007's description of the `cast-media:` gate is superseded by this ADR on
  the resolution mechanism only. Its conclusion still holds unchanged:
  `cast-media:` is a resource-fetch boundary, not a navigation or window-open
  target, and belongs to neither navigation allow-list.
