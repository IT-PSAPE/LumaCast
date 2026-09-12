# Macro is the scope and lifecycle unit (no Cue Groups)

The macro lifecycle proposal (issue #70) originally introduced a separate **Cue Group** entity to
own scoping, looping, and lifecycle targeting. We rejected that: a **Macro** is already an ordered
container of cues, so we folded scope, looping, and lifecycle control directly into the Macro and
dropped Cue Groups entirely. The Macro is the single unit that is triggered, scoped, looped, and
cancelled/reverted. This keeps one mental model instead of two overlapping container concepts.

We also decided **Revert** (the lifecycle undo) uses a **static per-cue inverse** map
(`overlay.activate` → clear that overlay, `*.arm` → `*.clear`, `*.set` → `*.clear`) applied only to
cues a run actually executed — rather than snapshotting and restoring prior on-screen state.
Snapshot/restore was rejected because restoring pre-macro content causes surprising flicker and
re-appearance of old content in a live presentation; operators want a macro's effects gone, then
set the next state themselves. Note that single-slot layer inverses (video/audio/stage/media) are
*unconditional clears*, not "restore the previous arm": reverting a run that armed video V clears
whatever is armed now, even if something else replaced V. Only overlays revert by specific id.

Delays are stored on the **macro step** (`action_steps`), not on the **cue**. Cues are
content-deduped and shared across macros, so a delay placed on the shared cue row would leak into
every macro using that cue (and the `flow.wait` migration could double-count). Delays are a
per-occurrence property, so they belong on the step.

The runtime also owns two guardrails on top of that model:

- **Loop pacing is a deadline floor, not an added delay.** A looping macro yields between
  iterations often enough to stay cancellable and keep the renderer responsive, but authored
  cue-step delays still set the cadence when they already exceed the floor. We explicitly rejected
  "always add a minimum delay" because it would silently slow currently-correct macros.
- **Revert bookkeeping is bounded by canonical cue identity.** A run records only the first
  application of each cue object, then applies static inverses in reverse first-application order.
  We rejected per-iteration undo logs because they grow unbounded on long-running loops while
  producing the same steady-state clears for idempotent inverses.

Because **Cancel** intentionally leaves applied effects live, any operator control that targets all
running macros must be described as cancellation, not stop/reset/revert. The renderer therefore
exposes a global cancel surface for active macro runs, while keeping Revert as a separate lifecycle
action with different semantics.

Both choices are hard to reverse (they shape the data model and the operator's mental model),
surprising to a future reader (who might expect a Group entity or a true state rollback), and the
result of weighing real alternatives.
