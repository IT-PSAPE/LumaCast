# ADR-0118: LumaStream Studio Program snapshots and resource ownership

## Status

Accepted

## Date

2026-10-27

## Context

Studio Mode needs to show edits and live captures in Preview without changing
the on-air picture or audio. The persisted project currently serves as both
editable configuration and the source of runtime activation, so draft source
changes can replace live resources, and preview playback can advance before a
scene is committed. Thumbnails also need to show the current composition without
creating another player for each scene.

## Decision

- Keep the persisted project as the editable draft. Build a volatile Program
  snapshot from the loaded root scene, all recursively referenced scenes,
  their source and audio configuration, and output configuration. Seed a new
  snapshot from the loaded project on startup or workspace change; do not
  persist on-air snapshots, runtime resources, or runtime IDs.
- Commit a draft snapshot only through an explicit Transition in Studio Mode.
  A changed reachable scene graph or output configuration can be transitioned
  even when the selected scene ID matches Program. Draft editing and
  undo/redo never mutate the committed snapshot. Non-Studio mode retains its
  existing live-edit behavior.
- Once a transition commits, retain the outgoing Program snapshot and its
  resources until the visual transition completes. Block another Transition
  while that outgoing graph is retained. Switch audio to the incoming Program
  when the transition begins; outgoing visual media may continue until the
  fade ends.
- Identify native resources by logical source and descriptor, and stateful
  media/browser resources by canonical resource descriptor across source IDs
  (ADR-0120). Allocate a session-local opaque UUID for each resource so
  runtime identity remains compatible with native IPC UUID validation. Share
  unchanged resources across Preview, Program, and outgoing snapshots; fork a
  resource when an asset, capture device/configuration, browser URL, browser
  viewport, or slideshow image list changes. Keep transforms, visibility,
  ordering, audio controls, and other non-resource configuration in the
  snapshot rather than the resource identity. Reusing an unchanged media
  resource preserves its playback position across transitions. When views
  share a resource, visible Program configuration takes priority over outgoing
  and Preview configuration; hidden aliases do not override an active view.
- Separate resource ownership from render activation. Native capture resources
  (camera, microphone, display/window, desktop-audio, and application-audio)
  remain warm while their resource has an effectively visible reference in the draft,
  Program, or outgoing scene graphs. Acquire lazy camera/microphone captures
  only when the source enters an active view scope; moving away from a scene or
  thumbnail does not tear down an already-running native capture. Removing or
  replacing the last graph reference releases it. This avoids reacquiring
  permission-sensitive captures on routine scene changes. Open browser pages
  on their first active view, then retain and throttle them while their resource
  remains visibly graph-owned so returning to a scene preserves DOM and navigation
  state. A hidden source or hidden ancestor cannot retain resources by itself;
  the last such owner releases captures, decoders, browser pages, and audio routes.
  Runtime IDs and resources remain session-only.
- Advance video/audio media playback and slideshow timers only for Program
  sources and retained outgoing visual sources. Render live camera and browser
  content in active Preview and thumbnail scopes. Gate every audio sink,
  including program buses and local monitoring, to Program; browser page audio
  must also remain inaudible in Preview. Show source audio meters after source
  processing and before source mute, volume, and output routing, so staged
  fader edits do not change the pre-fader capture level.
  Mute, volume, balance, filters, monitoring, and track-routing edits remain
  staged until Transition.
- Render scene thumbnails through the shared compositor and runtime media bank.
  Reuse current capture/browser frames and static image composition, render at
  reduced resolution at no more than about 10 frames per second while visible,
  and do not create independent media players for thumbnails.
- Show standard color bars for unavailable cameras, a broken-image placeholder
  for missing images, and explicit unavailable states for audio and source
  rows. Replace status-bar error text with brief color-coded notifications at
  the bottom right for action feedback.

## Consequences

Studio Mode has distinct draft and Program configuration lifetimes. A
Transition is a session action that commits the complete staged scene/source
configuration, including same-scene changes. Native capture cleanup follows
source-graph ownership rather than whether a source is currently rendered;
browser-page cleanup follows graph ownership after first activation. The outgoing visual graph
remains renderable through a fade. A restart stops outputs and reconstructs
Program from the loaded project; the previous on-air configuration and runtime
resources are not restored independently.

Preview remains useful for editing and source checks: active camera and browser
content stays live, capture meters remain visible before fader controls, and
static compositions and thumbnails remain current. Native capture sessions can
stay warm while their source remains in a draft or on-air graph, even after
leaving the visible Preview. Preview-only media stays paused; matching on-air
media shows the shared playhead. Browser audio and local monitoring remain
Program-gated. Explicit slide navigation is a shared runtime command affecting
all matching views without committing staged configuration (ADR-0120).

## Relationship to prior ADRs

- Supersedes ADR-0060's Preview media-playback behavior and extends its
  program-only audio gate to local monitoring.
- Extends ADR-0084 with shared resource ownership and a visible-thumbnail
  frame-rate cap; its reduced-resolution multiview decision remains in force.
- Supersedes ADR-0102's activation of media playback from Preview.
