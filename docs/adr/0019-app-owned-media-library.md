# ADR-0019: Imported Media Is Copied Into an App-Owned Library

## Status

Accepted

## Context

Importing media stored a reference to the file the user picked. `castMediaSrc`
wrapped the absolute path from `webUtils.getPathForFile` as
`cast-media://<encodeURIComponent(path)>`, and that string became the asset's
identity in SQLite and — copied by value, because there is no `assetId`
foreign key anywhere — the `src` of every element, background, theme, overlay
and stage that used it.

So a project was only as durable as the user's own folders. Moving a file,
renaming its folder, emptying a Downloads directory, unplugging the drive the
deck was built from, or opening the project on another machine all produced
media that no longer resolved. ADR-0018 makes that failure visible; it does not
prevent it.

"Replace source" was no repair either. `updateMediaAssetSrc` rewrote only the
asset row, so every slide already using the asset kept pointing at the file
that was gone.

## Decision

- **Import copies the bytes.** `app/main/media-library.ts` copies every
  imported file into `<userData>/media` and the database stores a reference to
  *our* copy. A project depends only on files the app owns. This was chosen
  over a size threshold that would link large videos: the files most expensive
  to lose would have been exactly the ones left fragile.
- **The library lives beside the derivative cache** in `userData`, not in a
  user-visible folder. A folder the user can move or clean out reintroduces the
  failure being fixed.
- **Copies are content-addressed**: `<sha256 of the bytes>.<ext>`, with the
  extension preserved because `nativeImage`, `music-metadata` and mime sniffing
  all key off it. Re-importing the same file is free, and "do we already have
  this?" is a filename lookup rather than a scan. Two asset rows may therefore
  share one file; the bytes are identical, so that is correct, and it is one
  reason nothing is deleted implicitly.
- **A new stored form, resolved relative to the library:**
  `cast-media://library/<64 hex>[.<ext>]`. The pattern admits no `/`, `\`, `%`,
  or `..`, so — exactly as with the managed-id pattern in ADR-0008 — traversal
  outside the library is impossible by construction rather than by sanitising.
  Two consequences beyond durability: the database stops recording absolute
  paths (and therefore usernames and directory layout) for library media, and
  relocating `userData` no longer invalidates references.
- **Both resolver copies learn the form.** `resolveLocalMediaSourcePath` exists
  twice — `app/main/media-source-path.ts` and
  `packages/persistence-sqlite/src/media-source-utils.ts` — because the store
  runs in a `utilityProcess` that cannot import `app/main`. The library branch
  is checked before the generic percent-decode, so a malformed library payload
  can never be reinterpreted as a legacy encoded path. With no library
  directory configured a library reference resolves to `null` and is treated as
  *unverified*, never as *proven missing*.
- **Copying happens in main, at the media write handlers.** `createMediaAsset`,
  `updateMediaAssetSrc`, and the relink decisions of `finalizeImportBundle` all
  pass their source through `MediaLibraryService.adopt` before it reaches the
  repository. Main already owns filesystem access there, the renderer still
  never learns a path, and the store stays path-string-only. Sources with
  nothing to copy — an existing library reference, `blob:`, `http(s):`,
  relative, empty — pass through unchanged.
- **A copy is atomic.** Bytes go to a `.part` file in the same directory and are
  renamed into place, because a truncated file under a content-addressed name
  would be taken by the next import as proof the bytes were already there. A
  target of the same name but a different size is treated as exactly that
  wreckage and replaced. `COPYFILE_FICLONE` makes the copy a copy-on-write
  clone where the filesystem supports it (APFS, Btrfs, XFS).
- **Replace is a true replacement.** `updateMediaAssetSrc` now repoints, in one
  transaction, every stored reference to the asset's previous source —
  including slide/theme/overlay/stage backgrounds, which the deck-bundle
  scanners omit — and returns a patch covering everything it changed. Replacing
  a lost file repairs the slides that lost it. Its `preserveMetadata` option
  exists for adoption, where the bytes are unchanged and the persisted
  `width`/`height`/`duration`/`codec` are still truthful; the default still
  clears them, because a genuinely different file must not inherit them
  (ADR-0012).
- **Media imported before the library is adopted in the background.**
  `adoptExistingAssets` walks the snapshot once, copies each external source
  into the library, and repoints it, one asset at a time. It starts when the
  renderer subscribes rather than at startup — that is when there is a window
  to send patches to, and a large library is a lot of bytes to hold a launch
  for. Every repoint is emitted as a patch the renderer applies, so its
  snapshot cannot diverge from disk and undo cannot resurrect the old external
  path. A source whose file is already gone is left exactly as it is: the
  honest outcome is ADR-0018's missing-media state, not a reference to a copy
  that was never made.
- **Nothing is deleted implicitly.** Because media references are copied by
  value into content, an incomplete reference scan that deleted files would be
  unrecoverable. `reclaim` is explicit and user-initiated, removes only names
  the app itself writes (a content-addressed copy, or a `.part` abandoned for
  over an hour), and derives its reference set by mirroring `maskAppSnapshot`'s
  walk — the authoritative list of media-bearing snapshot shapes, since it has
  to be complete or paths leak.
- **An import that cannot be copied fails loudly, per file.** The renderer
  counts failures separately from files with no path and reports both; one
  unreadable file or a full disk does not abandon the rest of a selection.

## Consequences

- Moving, renaming or deleting an original after import no longer affects the
  project. The original is untouched — the library holds a copy, not a move.
- Disk use grows with imports, and on filesystems without copy-on-write it
  grows by the full size of every imported file. Reclaiming is manual, so an
  unused library file survives until the user asks for the space back.
- `reclaim` consults the live project only. Undoing past a reclaim can restore
  an element whose file has since been removed, which then reports as missing
  media.
- Two assets sharing one content-addressed file share its fate: replacing the
  source of one repoints every usage of those identical bytes. Given the bytes
  were the same picture, that reads as "it updated everywhere", and the other
  asset's file still exists because nothing is deleted implicitly.
- Project backups still record `src` references and never copy media files
  (ADR-0006). A backup restored on a machine whose `userData` does not hold
  those library files resolves to missing media. Carrying library files in the
  backup artifact would make it portable and is not attempted here.
- Derivative fingerprints include the stored source string, so adoption
  invalidates every thumbnail once; they regenerate lazily on demand.
- The renderer briefly still learns the path of a file the user just chose
  (ADR-0008's residual import-capability exposure). That is unchanged: the path
  now reaches main, gets copied, and is replaced by a library reference on the
  way back.
