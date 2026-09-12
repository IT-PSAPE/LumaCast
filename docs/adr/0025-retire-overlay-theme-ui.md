# ADR 0025: Retire overlay theme UI

Status: Accepted

## Context

An overlay is already a reusable single-slide visual. Applying an overlay theme only copied its styling and elements; overlays never stored a theme link.

## Decision

Remove overlay themes from theme creation, browsing, search, and apply controls. Duplicate an overlay to reuse its design. Keep the legacy overlay-theme model and storage readable for project and backup compatibility.

## Consequences

Existing overlays retain their appearance without migration because they already contain their elements and background. Historical overlay-theme records are preserved but are no longer offered in the editing workflow. Presentation and lyric themes remain live-linked.
