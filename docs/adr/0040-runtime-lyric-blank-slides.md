# ADR-0040: Lyric Boundary Blanks Are Runtime Projections

## Status

Accepted

## Date

2026-09-14

## Context

Operators need optional blank frames before and after a lyric, including from
the creation flow and the active slide menu. These frames are playback
structure rather than authored content: storing them as ordinary slides would
give them editable identity, elements, ordering, and persistence semantics
that the feature explicitly does not have.

## Decision

- Lyrics persist a `blank_slide_mode` setting with `none`, `start`, `end`, and
  `both` values. No synthetic slide or element rows are written.
- The renderer's project-content projection inserts deterministic runtime
  slides around the persisted lyric slides. All navigation, thumbnails, and
  output consume that projection; repository and backup data remain authored
  slides only.
- A runtime blank linked to a lyric theme inherits the theme background and
  non-text elements, filtering every text element. An unthemed runtime blank
  is empty.
- Runtime blank slides are immutable. Configuration changes use the typed
  `setLyricBlankSlides` RPC, also exposed as the agent action
  `lyric.setBlankSlides`.
- Project backups move to schema 35. Schema-34 and earlier supported backups
  normalize lyric rows to `blank_slide_mode = none`.

## Consequences

Runtime slide IDs are stable for a lyric and boundary, but are not repository
IDs and must never be sent to stored-slide mutation methods. Removing or
changing the setting immediately changes the projected sequence without data
migration beyond the lyric setting itself.
