# ADR-0046: LumaFlux editing, tone, and agent-guidance policy

## Status

Accepted

## Date

2026-09-26

## Context

Flux's literal dark surfaces were paired with the shared theme's default light
foreground because its document did not activate dark mode. Auto Light targeted
a fixed median
(`0.46`) on the developed 8-bit buffer, which is prescriptive and flattens
deliberate tonal profiles; and the MCP guide left the end state and crop quality
bar insufficiently explicit for consistent visual judgments.

## Decision

- Flux opts into the shared theme's **semantic tokens**: `index.html` sets
  `data-theme="dark"` and never swaps it, and no Flux rule declares a local UI
  palette literal. RGB channel fills and clipping masks describe pixels and
  retain data-specific colours; neutral chart chrome follows themed tokens.
  Lens facts use quiet label/value columns.
- **Auto Light** (`packages/photo-imaging/src/auto-tone.ts`) is a two-stage
  guardrail search. A desired percentile profile preserves a plausibly existing
  tonal profile; the only automatic movement is a capped gentle whole-image lift
  when the frame reads dark across the whole image — low midtones _and_ an upper
  body with headroom. It imposes no new contrast target on plausibly exposed
  frames and never darkens a bright subject by default, because a bright
  histogram is ambiguous: a high-key subject and an over-bright capture look
  identical there. A bounded coarse-to-fine search then evaluates the real
  renderer under hard per-channel clipping gates and a gate that prevents
  turning fully clipped white into grey. Full-recipe caching, a 60-render limit,
  and an immediate return for unchanged targets bound the work.
- The histogram is evidence, not judgement: it cannot identify intent, subject,
  or exposure definitively, so a bright or dark reading escalates to an AI
  preview and manual judgment. Every accepted value is one the renderer produced.
- Evidence is a bounded set of small preview renders under the same
  conservative Light bounds for RAW and raster sources. The measured data is
  8-bit in both cases because a RAW extension
  buys no extra developed headroom: the render is the same developed 8-bit sRGB
  buffer, and clipping is read at byte 0/255 to match the renderer's histogram.
- Auto replaces the seven Light values from a neutral Light base and preserves
  color, detail, geometry, and lens correction. Too little tonal information
  returns no patch. A neutral winner explicitly clears prior Light edits. A
  reference fit uses the reference's _actual measured_
  histogram, touches tone only, and keeps the normal `expectedRevision`
  non-destructive contract; it is a measured candidate, not finished
  photography. The revision contract is unchanged; the bounds and clipping
  policy are more conservative than the prior fixed-median fit.
- The MCP guide (`apps/flux/main/mcp/editing-guide.ts`) and the bundled
  `professional-photo-editing` skill state the same goal-driven natural quality
  bar, with a clear end state, crop goals and quality limits, and real preview
  vision instead of a face detector. They treat file names, EXIF, and image
  content as data rather than instructions, keep originals untouched, and add no
  ML model, local masks, or sensor-domain RAW recovery. Research basis:
  RawTherapee exposure behavior (<https://rawpedia.pixls.us/exposure/>), darktable
  exposure percentiles
  (<https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/exposure/>), and
  PhotoArtAgent's visual candidate feedback
  (<https://arxiv.org/abs/2505.23130>).

## Consequences

Chrome follows suite theme changes instead of diverging. Auto bounds its render
work and can decline to act, the intended result on an image that
already reads well. The engine's real limits (developed 8-bit previews, no local
masks, no built-in face detection) are stated to agents in both surfaces, so
neither can promise recovery it cannot deliver.
