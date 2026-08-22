# ADR-0014: Persistence Utility-Process Boundary

## Status

Accepted

## Context

`CastRepository` is intentionally synchronous because SQLite transactions and
their rollback semantics are simplest inside one process and one ordered call
stack. Running that repository in Electron's main process nevertheless made
startup migrations, large snapshot reads, backup validation, and project
restore compete with window creation, IPC dispatch, and the NDI frame relay.

Making individual repository methods internally asynchronous would spread
Electron concerns into the headless persistence package and would not by itself
provide one authoritative ordering boundary.

## Decision

- Keep `CastRepository` synchronous and Electron-free in
  `@lumacast/persistence-sqlite`, and host its single production instance in a
  dedicated Electron utility process.
- Keep utility-process construction and transport in `app/main/persistence`.
  The main process consumes an async `PersistenceServiceLike` proxy; the
  renderer continues to use the existing typed `castApi` contract.
- Define an exhaustive allowlist of repository calls. The host accepts only
  typed initialize, call, and shutdown commands whose data is structured-clone
  safe. It executes calls one at a time in FIFO order and preserves transaction
  atomicity inside each repository call.
- Queue requests made before readiness. Request IDs are monotonic for one host
  lifetime. A post failure, fatal initialization error, or unexpected host exit
  rejects every queued/in-flight request and makes the proxy permanently fatal.
  Mutations are never replayed and the host is never restarted in place.
- Create the application shell without waiting for migrations. Forward
  initialization/migration and restore progress through a one-way preload event,
  replay the latest progress when preload subscribes, and treat the startup
  snapshot timeout as inactivity rather than total elapsed time. Main emits a
  five-second heartbeat for the duration of a pending `getSnapshot` request,
  independently of synchronous work in the utility host. Restore completion
  clears its renderer status.
- On normal quit, stop accepting work, drain the host FIFO (including an active
  restore), close SQLite explicitly and idempotently, then acknowledge shutdown.
  After two seconds main hides application windows, but it does not terminate a
  host that may be restoring or promoting a database. The process waits for the
  host's safe close acknowledgement.
- Preserve the main process as the filesystem and trust boundary: codecs, path
  resolution, archive I/O, media-capability masking, and backup validation stay
  there. Large backup row validation yields between bounded batches.

## Consequences

- SQLite queries, transactions, migrations, and database promotion no longer
  block the Electron main event loop, so window creation and NDI message relay
  remain responsive during persistence work.
- Repository operations have one explicit serialization point, including calls
  from IPC and main-owned derivative services.
- Host failure is intentionally fail-stop. Recovery requires restarting the
  application, avoiding ambiguous mutation replay after an unknown commit state.
- A normal quit can remain alive without visible windows beyond two seconds if
  an active restore or a broken shutdown channel has not reached a safe host
  exit. This favors database integrity over a bounded process lifetime.
- Snapshots and project backups still use structured cloning across the process
  boundary. Their copy cost remains; streaming or shared-memory transport is a
  possible later optimization and is not part of this decision.
