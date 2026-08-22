# ADR-0010: Renderer Playback Hot-Path Isolation

## Status

Accepted

## Context

Issues #228, #230, and #232 exposed renderer hot paths that were coupled far more
widely than the visual behavior required.

First, every mounted `SceneStage` subscribed to the app-wide editing context,
even when the surface was read-only. That pulled thumbnail stages and the
off-screen NDI capture stages through selection, marquee, transform, inline
text, and status-text churn they could never use. The coupling was amplified by
fresh object identities coming back from the element-selection, inspector, and
history hooks, and by editor callbacks that closed over draft-flushed element
arrays.

Second, overlay dissolves used a provider-wide React clock. `PlaybackProvider`
updated a timestamp on a 33 ms timeout, then a second effect advanced overlay
lifecycle state from that timestamp. `CanvasProvider` consumed the resulting
timed overlay objects directly, rebuilt the layered program scene every tick,
and pushed that churn through the application root even though only the program
monitor and audience feed needed the changing opacity.

Both defects were live-show critical: they consumed frame budget on unrelated
surfaces before the program output painted, and they did so in code paths that
run continuously during editing or overlay animation.

The same coupling existed in the root application state contract: consumers
subscribed to broad context values even when they needed only cast data, NDI
status, or status-bar state. Provider value replacement consequently invalidated
unrelated subtrees.

## Decision

- `SceneStage` is split into explicit editable and read-only siblings.
  Read-only surfaces render the same scene traversal but never call
  `useElements()` or `useSceneStageEditor()`. They still own the NDI capture
  publish/cleanup effect so capture behavior remains identical.
- The element-selection, inspector-sync, and history hooks memoize their return
  objects. `useActiveEditorSource()` also shares a module-level empty-elements
  array for the non-editable fallthrough. This keeps the app-shell element
  context stable when its real inputs are unchanged.
- Editable stage callbacks that must see current draft geometry or current
  selection read those values from refs assigned in the render body, not from
  effect-written refs. That preserves same-frame drag/transform freshness across
  the draft buffer's rAF batching while letting the callback identities stay
  stable across unrelated renders.
- `PlaybackProvider` now exposes two overlay views:
  - a stable overlay membership/order set for general renderer consumers
    (`usePresentationLayers()`, `usePresentationRenderLayer()`, and therefore
    `CanvasProvider`)
  - a timed overlay-opacity view for the program-output path only
    (`useProgramOverlayPlayback()`)
- Overlay timing advances in a single state update. The provider still computes
  lifecycle transitions with the headless `@lumacast/playback` helpers, but it
  schedules animated steps on `requestAnimationFrame` instead of the old
  timeout-driven React clock, and applies the lifecycle advance plus the new
  opacity snapshot together.
- `CanvasProvider` builds the layered program scene from the stable overlay set
  with base per-element opacity intact. `useProgramOutput()` applies the current
  overlay opacity multiplier immediately before the scene reaches the program
  monitor or audience NDI feed. This preserves the existing per-element alpha
  compositing semantics; we explicitly do not collapse the dissolve onto a group
  opacity.
- Root application state lives in the selector-based Zustand app store.
  `useCast`, `useNdi`, `useNdiLiveState`, and the status selectors subscribe to
  deliberately narrow slices with shallow comparison, so diagnostics,
  operation status, theme changes, and snapshot mutations invalidate only the
  consumers that name those values. Provider code is bootstrap/subscription
  wiring, not a broad state-distribution context.

## Consequences

- Read-only stages no longer rerender because selection, marquee, transform,
  inline-text editing, or status text changed elsewhere in the renderer.
- The program monitor and audience feed still show the same dissolve timing and
  compositing behavior, but overlay animation frames no longer drag unrelated
  renderer consumers through the same commit path.
- Overlay timing now has a named renderer boundary: membership/order is broad,
  opacity/time is narrow. Future playback features that need per-frame changes
  must opt into the narrow program-output seam instead of threading animation
  time through `CanvasProvider`.
- The stage-editor callback identities are safer to depend on externally, but
  same-frame correctness remains anchored to render-body refs. A future refactor
  must preserve that invariant for any callback that seeds drag or transform
  geometry from draft state.
- App-wide state consumers must add or extend a narrow selector instead of
  reintroducing a single provider value whose identity changes for unrelated
  state.
