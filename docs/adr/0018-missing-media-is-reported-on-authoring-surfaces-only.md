# ADR-0018: Missing Media Is Reported, In Red, On Authoring Surfaces Only

## Status

Accepted

## Context

A media element whose file cannot be read had three different fates depending
on where it was painted, none of them a report:

- a foreground image/video element on the stage editor drew a near-black field
  (`#101114`) crossed by heavy black diagonal stripes (`#050505`), a muted
  technical texture that read as "some kind of empty" rather than "this is
  broken";
- the same element on every other surface — including the operator's monitor —
  drew a fully transparent rect, so the scene frame's transparency
  checkerboard showed through and the element vanished silently;
- a slide/theme/overlay/stage **background** whose file was missing had no
  broken state at all, on any surface: it always painted transparent.

The asset bin already had a truthful missing state (`AlertTriangle` +
"Missing source"), but it was drawn in the neutral `bg-tertiary`/`text-tertiary`
gray the loading state uses, so a fault and a not-yet-generated thumbnail
looked alike. A second thumbnail component (`components/overlays/media-thumbnail.tsx`)
had no missing state whatsoever and fell through to its generating icon.

The operator therefore could not tell, before going live, the difference
between "this slide is intentionally empty here", "this is still loading", and
"this file is gone".

## Decision

- **One placeholder, one meaning, drawn in red.**
  `packages/canvas/src/missing-media-placeholder.tsx` is the single
  missing-media painter for every Konva surface: a muted red field, a subtle
  diagonal hatch, a hairline border, a warning triangle, and a `MISSING MEDIA`
  label. Red is the decision, not a style preference — a missing source is a
  fault the operator must catch before the slide goes live, so it is never
  rendered in the neutral gray that also means "loading" or "empty".
- **The red is desaturated and theme-adaptive, not alarm red.** Two palettes
  derived from the app's red ramp (`app/renderer/theme.css`) — a pale field in
  light mode, a deep one in dark mode — carry the warning without the
  oversaturated red that would dominate a scene being composed around it.
- **The placeholder resolves the theme itself.** Konva paints concrete color
  strings, so rather than thread a palette through every scene surface, the
  component reads `data-theme` off the document root — the single place the app
  records the resolved theme (`app/renderer/contexts/app-context.tsx`) — and
  repaints on a `MutationObserver` when it changes. This is the package's only
  dependence on app-level DOM state, and it degrades to the system preference
  if the attribute has not been applied yet.
- **Authoring surfaces report; live outputs stay empty.**
  `MISSING_MEDIA_SURFACES` is `deck-editor`, `monitor`, and `list`. `show`,
  `stage`, `ndi-show` and `ndi-stage` are what the audience and performers
  actually see — `show` is the surface NDI captures — and they keep painting
  transparent. Our fault report must never reach a live output, which is the
  opposite of the NLE convention (DaVinci Resolve renders MEDIA OFFLINE into
  the timeline output) and is the right trade for a presentation tool. The
  operator's monitor mirrors the audience feed without being captured, so it is
  the surface where the warning belongs.
- **Backgrounds report too.** `SceneSlideBackgroundMedia` distinguishes
  "no media resolved yet" from "broken" and paints the placeholder in the
  broken case on the same surfaces, instead of always painting transparent.
- **A loaded derivative always wins.** The placeholder is suppressed whenever
  the proxy derivative is loaded, so ADR-0013's derivative-first rendering
  still paints real content rather than a fault report while the full source
  loads.
- **Thumbnail surfaces report only what they can know.** ADR-0013 keeps `list`
  derivative-only, so a full source is never decoded there and cannot be
  observed as broken; on `list` the placeholder is driven by a broken *proxy*
  alone.
- **The placeholder scales down instead of clipping.** Glyph and label are
  sized from the element box and dropped below the sizes at which they stop
  being legible (label under 220×132, glyph under a 40px box), so a slide tile
  degrades to the red field and border rather than to unreadable marks.
- **Both DOM thumbnail components use the error tokens.** The bin thumbnail's
  missing state moves from `bg-tertiary`/`text-tertiary` to
  `bg-error_primary`/`text-error`/`border-error_subtle`, and the overlay
  thumbnail gains the missing state it never had. Their copy is unified to
  "Missing media", matching the canvas label, so one condition reads the same
  everywhere.

## Consequences

- A missing file is now visible as a fault everywhere the operator authors or
  previews, and invisible on every surface an audience can see.
- The transparency checkerboard behind the scene frame no longer doubles as an
  accidental missing-media indicator: an opaque red field covers it, so the
  checker means only "transparent scene" again.
- `@lumacast/canvas` now reads one app-level DOM attribute (`data-theme`). It
  imports nothing from `app/`, so the architecture boundary is intact, but the
  attribute name is a shared convention that has to move in step if the app's
  theming mechanism changes.
- A missing source in a slide tile still shows nothing when the asset never had
  a derivative to break: the tile has no way to learn the source is gone
  without decoding it, which `list` may not do. Reporting that case needs main
  to carry a truthful "source missing" flag on the asset (main already has
  `isBrokenMediaSource` in `packages/persistence-sqlite/src/media-source-utils.ts`)
  through the snapshot into the render scene. Deferred, not designed here.
- The placeholder's two palettes are hard-coded hex rather than bound to the
  CSS custom properties they were derived from, because Konva cannot resolve a
  `var()`. A palette change in `theme.css` does not propagate to them.
