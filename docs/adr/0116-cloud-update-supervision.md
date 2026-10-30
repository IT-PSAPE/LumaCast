# ADR-0116: Cloud owns update supervision

## Status

Accepted. Refines ADR-0044's suite-management boundary and supersedes Cast's
independent runtime update checks.

## Date

2026-10-27

## Context

Cast and Cloud could independently check for updates. Update dialogs in Cast
interrupt presentation work and duplicate the suite manager's responsibility.
The requested workflow is background availability notifications from Cloud,
with users choosing when to download and install.

## Decision

- Remove Cast's runtime updater, menu commands, and updater IPC/preload API.
- Cloud owns managed-app discovery through its existing release catalog and
  its own availability checks through the existing `cloud-feed` updater.
- Keep Cloud running after window close with an accessible system-tray menu
  for reopening, checking, and quitting. Normal startup still opens its window.
- Check installed-app availability every six hours when background checks are
  enabled. Keep launch checking independently configurable. Deduplicate
  notifications by app/version within the running session.
- Background work only checks and notifies. Disable automatic downloads and
  installation on quit in Cloud's self-updater; keep explicit manual install
  operations and existing permission/integrity checks.
- Preserve release feeds and installer metadata for the catalog and older
  shipped clients. No other app acquires a dependency on Cloud's runtime.

## Consequences

Cast can run without update network traffic or prompts. Cloud must be running
for background notifications, and native delivery follows the operating
system's notification settings. Quitting Cloud stops monitoring. Session-only
deduplication avoids adding persistent notification history; another session
may report a newly observed release again. Existing install/update permissions
and verified installer placement remain unchanged.
