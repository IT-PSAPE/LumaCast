# ADR 0029: Remove the Talk content model

Status: Accepted

## Context

Talks duplicated the presentation/lyric ownership machinery with a separate
item table, theme family, script-block model, slide columns, playlist column,
bindings, IPC methods, and editor surfaces. The product no longer uses that
workflow. Keeping the dormant family made every item, theme, snapshot, backup,
and migration change carry a third branch.

## Decision

Presentations and lyrics are the complete current item model. Remove Talk,
Talk themes, Talk script blocks, Talk bindings, and their UI, IPC, snapshot,
patch, repository, playlist, and playback paths.

Schema migration v33 deletes Talk-owned playback schedules, playlist entries,
slide elements, and slides before dropping the Talk tables and rebuilding
`slides` and `playlist_entries` without Talk owner columns. The rebuilt tables
retain their current foreign keys and ordering indexes.

Current deck bundles and project backups use Talk-free version 3 contracts.
The version 1 and 2 readers remain isolated compatibility boundaries: they
discard Talk-owned content while preserving valid presentation, lyric,
playlist, media, overlay, stage, and automation data. Talk is never normalized
into another current item type.

## Consequences

Opening an existing database or importing an older supported file permanently
removes Talk content and references. Presentation and lyric content survives
with its existing ids and order. Current runtime types cannot construct or
persist Talk data, so the removed behavior cannot return through an unhandled
renderer branch.

This supersedes the Talk-specific parts of ADRs 0003, 0004, 0006, 0025, and
0026. Their remaining presentation, lyric, backup, and live-theme decisions
still apply.
