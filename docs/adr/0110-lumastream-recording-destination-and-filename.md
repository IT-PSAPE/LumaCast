# ADR-0110: LumaStream recording destination and filename format

## Status

Accepted

## Context

Stream currently asks the user to choose a save path for every recording and
replay. OBS keeps a recording path and filename format in its recording
settings, so repeated recording does not require a save dialog.

## Decision

- Persist the selected recording folder and filename format in a versioned,
  machine-local settings file, separate from profiles and scene collections.
- Use the Videos folder when no custom folder is selected.
- Support the OBS date and time tokens `%CCYY`, `%MM`, `%DD`, `%hh`, `%mm`, and
  `%ss` in the filename format.
- Apply the same preferences to recordings and saved replays.
- Append an incrementing numeric suffix when the generated path already exists
  or is reserved by another active recording; never intentionally overwrite an
  existing generated filename.

## Consequences

Recording and replay can start without a per-file save dialog. Folder paths stay
local to the machine and are not copied when a profile is exported or imported.
If the selected folder becomes unavailable, recording reports an error and the
user can choose another folder in Settings.
