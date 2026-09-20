# ADR-0042: First-Class Timers

## Status

Accepted

## Date

2026-09-20

## Context

A "timer" was only a `TextBinding` kind on a text element, carrying its own
`timerDurationSeconds`/`timerFormat`. Its clock was a single global
`armedAtMs` set whenever a stage was taken (`packages/playback/src/stage-arming.ts`,
`resolveStageArmedAt`). There were no controls: changing a duration meant
opening the element and editing the binding, and restarting meant clearing
and re-taking the stage. Every timer on every stage shared the same clock.

## Decision

- Timers become a global named entity (`Timer`, `packages/composition/src/domain/timers.ts`),
  modelled on ProPresenter 7's timer panel: `countdown`, `countdown-to-time`,
  and `elapsed` kinds, each with `allowOverrun`, a display `format`, and an
  ordered list of colour `thresholds` that recolour linked text once crossed.
- Run state (`TimerRunState`: idle/running/paused, accumulated ms) is
  volatile and lives only in the renderer's `TimersProvider` — never
  persisted, matching the single-`BrowserWindow` app.
- Text elements only *link* to a timer by id (`TextBinding.timerId`); the
  legacy `timerDurationSeconds`/`timerFormat` fields are deprecated but still
  decoded so old bundles import.
- A dedicated Timers panel (a program-panel tab) is the control surface:
  create/rename/duplicate/delete, edit kind fields and thresholds, and
  start/pause/reset. The inspector's binding tab is relabelled "Text link".
- `timer.create`/`timer.update`/`timer.delete` are ordinary main-process
  mutations returning a `SnapshotPatch`, mirroring `slideTag.*`.
  `timer.start`/`timer.stop`/`timer.reset`/`timer.resetAll` are
  renderer-executed actions (ADR-0037), so the in-app agent and the MCP
  server can drive a running timer without a main-process round trip.
- Migration v36 adds the `timers` table and converts every legacy timer
  binding found in `slide_elements.payload_json` into a real `Timer` row
  (one per distinct duration/format pair) plus a `timerId` link. The old
  stage-arming clock and `resolveStageArmedAt` are removed entirely.

## Consequences

Thresholds only recolour linked text; they do not fire automation or cues —
that is deferred. `countdown-to-time` is always computed live from the wall
clock rather than from run state, so it needs no start/pause to display
correctly. Run state does not survive an app restart: every timer reopens
idle at its configured starting value. Deleting a timer does not clear or
warn its linked bindings; they keep `timerId` and render `--:--` until
relinked or the element is edited.
