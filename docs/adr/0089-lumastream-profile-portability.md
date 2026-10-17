# ADR-0089: Portable LumaStream Output Profiles

## Status

Accepted

## Date

2026-10-17

## Context

Output profiles should be reusable between Stream installations and should not
require manually editing app data. The renderer must not receive arbitrary file
paths or write profile data directly.

## Decision

- Import and export versioned `.lumaprofile` JSON documents through native file
  dialogs owned by the main process.
- Export only the named profile's output configuration and global hotkeys.
- Limit imported files to 4 MiB and validate their format, name, output fields,
  and hotkeys with the same decoder used for persisted profiles.
- Activate an imported profile after saving it. If its name is already in use,
  append a numbered suffix without overwriting the existing profile.
- Keep file paths in main; the typed renderer bridge accepts only an import
  action or an existing profile ID for export.

## Consequences

Profiles can be moved between installations without exposing Stream's profile
index or scene collection files. Imported profiles cannot contain scenes,
sources, media paths, or arbitrary filesystem references.
