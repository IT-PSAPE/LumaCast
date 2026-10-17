# ADR-0091: Portable LumaStream Scene Collections

## Status

Accepted

## Date

2026-10-17

## Context

Scene collections contain references to imported media stored in Stream's local
data directory. Copying only the project JSON would leave those sources broken
on another installation. Archive import also crosses a filesystem trust
boundary and must not allow archive paths to select arbitrary destinations.

## Decision

- Export a versioned `.lumacollection` ZIP containing one project manifest and
  each referenced image, video, or audio asset.
- Stream entries between files; do not buffer media assets in renderer or main
  process memory.
- On import, enforce archive, entry-count, manifest, and expanded-size limits;
  accept only the manifest and UUID-named media paths.
- Verify each media file's declared size and SHA-256 digest, then copy it into
  the managed media directory under a newly generated opaque ID.
- Decode project data with the regular persistence validator, use the current
  profile's output settings, and activate the imported collection with a unique
  name.
- Keep dialogs, archive reads, media copies, and project persistence in main;
  renderer IPC carries only the collection import action or current collection
  ID for export.

## Consequences

Collections can move between Stream installations with their local media.
Capture-device IDs and browser-source URLs remain collection configuration and
may need adjustment on another machine. Plugins and filters remain outside this
collection portability contract.
