# ADR-0122: Stream project persistence during close

## Status

Accepted

## Context

Stream coalesces project edits for 250 ms. Destroying its renderer during that
interval discarded the latest edit, and quitting did not await accepted store
writes. Increasing save frequency alone would still leave a gap between a
renderer update and completion of the filesystem operation.

## Decision

Keep the debounce and make graceful shutdown an explicit persistence boundary.
Each renderer API session owns an ordered autosave drain; edits synchronously
queue their project with its collection and profile IDs. The drain includes
revisions queued during a write and retains a failed final revision for retry.
Workspace transitions flush the previous owner before changing IDs and block
edits while that transition is pending.

Before native close, application quit, Windows session close, or renderer reload,
main keeps the renderer alive and requests a final flush. The renderer freezes project edits
before flushing. Main accepts only the matching request's acknowledgement from
the trusted main frame, then drains accepted ProjectStore operations before
teardown. Repeated close/quit requests share that work. Store loads join the
same operation queue so they observe preceding writes.

The renderer prevents DOM beforeunload and delegates destruction to main.
Main bypasses that app-owned prevention for an approved close/quit, or reissues
one reload of the app document after the same acknowledgement and store drain.
A pending close/quit supersedes a reload. Product Quit actions call a trusted,
argument-free main-process quit port. Electron exposes the same prevention event
for renderer `window.close()` and reload, without an intent discriminator, so
product actions do not rely on that ambiguous DOM method. Arbitrary DevTools
`window.close()` can reload the document after persisting it; native window
controls and product Quit retain their close/quit behavior.

This owns same-document reloads;
Stream has no trusted in-app navigation that must preserve another destination.

A failed write or a 10-second acknowledgement timeout cancels destruction,
resumes editing, and reports the failure. The renderer remains frozen through
output teardown after a successful flush.

## Consequences

Graceful close preserves the latest accepted project revision while retaining
normal autosave coalescing. Unmount-only flush is best-effort; native shutdown
uses the acknowledgement boundary. A renderer crash, forced process kill, or
power loss cannot recover edits that never reached main. A destroyed renderer
still permits already accepted store operations to drain. A failed initial load
retains window chrome and allows Retry without replacing or clearing user data.
