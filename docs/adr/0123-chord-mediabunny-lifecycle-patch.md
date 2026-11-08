# ADR-0123: Chord's reproducible MediaBunny lifecycle patch

## Status

Accepted

## Context

Chord must signal each track's actual end while admitting audio and video in
presentation order. Leaving a shorter track open retains the longer tail in the
muxer. Padding or trimming changes existing content; finalization alone does not
bound the retained tail.

The installed MediaBunny1.60.0 public close method returns void and detaches its
muxer notification. A rejected write during EOF can become unhandled and retain
a muxer mutex. Failed serialized encoder work can also skip encoder cleanup,
and output cancellation/finalization can settle before other source cleanup.
The inspected maintained API does not establish the awaited lifecycle contract
Chord needs. An application scheduler cannot safely repair these private owners.

## Decision

Pin Chord's mediabunny dependency to exactly1.60.0 and keep a narrow local patch
under tool/patches/mediabunny-1.60.0. Patch the five corresponding published TS and
modular ESM files, plus MediaSource.close declarations. Close returns its cached
promise, awaits EOF notification and uses forced cleanup after cancellation.
Muxer locks release in finally. Custom encoders close after serialized work
settles. Output cleanup waits for all owners and preserves the first observed
failure, including rejection with undefined.

Conversion keeps one cancellation cleanup operation and joins it on repeated
cancel and covered setup/pump failures. Execution waits for cleanup but retains
its exact primary error if cleanup also rejects. Metadata/start admission guards
prevent new producer work after cancellation, and pause listeners are removed
after covered failures. Its public Promise<void> signatures and existing
finalization/done behavior remain unchanged. Remove the stale modular Conversion
declaration-map link after changing source offsets.

Use a Node-built-in-only root postinstall tool. Before writing anything, verify
the version/export map, all original or known patched bytes, and every computed
final SHA256. Unexpected bytes fail without target writes. Applying a known
original/final mixture resumes only original files; verification requires the
whole final cohort. Staged per-file replacements do not make the multi-file
operation atomic. A fresh npm ci restores unexpected contents.

Chord's Vite plugin verifies rather than applying changes. It forces and checks
the modular ESM entry for the app and codec extensions, rejects loaded core
modules outside that subtree, and excludes the entire MediaBunny/codec-extension
cohort from optimized-dependency caches. CJS and standalone bundles remain
unmodified and outside this contract. Direct builds after ignored install
scripts fail until the patch is explicitly applied.

Preserve upstream MPL notices and ship verified LICENSE, NOTICE, patch/diff and
modified preferred TS source in renderer/licenses/mediabunny. Existing out/**
packaging includes these assets. Repository text is canonicalized to LF for
stable Windows checkouts; npm package input/output bytes are never normalized.

## Consequences

Chord can await real EOF and failure cleanup without changing media durations,
packet payloads or content policy. The application must still await and reconcile
close/cancel/finalize. Cancellation remains cooperative once an encoder flush
has begun; this patch does not interrupt permanently stalled custom encoders.
Conversion cleanup owns Output encoder/target resources. Borrowed Input remains
caller-owned, including initialization failures before a Conversion handle is
returned. Already-admitted noncooperative input reads retain that limitation;
the patch does not claim to join every pump/input-read lifetime.

An upstream upgrade requires a deliberate rebase or removal of the patch,
source/runtime/type checks, exact-byte content controls, bounded unequal-tail
regressions, writer/encoder failure and cancellation tests, and verified ESM and
source-notice build output. No remote fork, patch-package dependency, codec
replacement or publication process is introduced.
