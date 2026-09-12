# ADR 0034: Project-level slide tags

Status: Accepted

## Context

Operators need reusable, custom labels for slide ranges. A tag changes the existing slide caption color and must update every assigned slide when its name or color changes. Copying tag styling into slide elements would make later tag edits stale and would mix operator metadata with rendered output.

## Decision

Store tag definitions once at project scope in `slide_tags`. Each presentation or lyric slide may refer to one definition through nullable `slides.tag_id`. The permitted color keys are the playlist-separator palette, shared as a composition-domain value. Tags are metadata and never add a canvas element.

The repository exposes create, update, delete, and many-slide assignment mutations through the typed IPC contract. Every mutation returns a snapshot patch. Tag updates patch the definition, so all captions that resolve the same ID change immediately. Deletion clears referencing slides in the same transaction and patches those slides before the tag is removed. Slide and item duplication preserve `tag_id`.

Tags and assignments participate in full snapshots, incremental history patches, and project backup/recovery. Migration v34 adds the table and nullable foreign key. Restore validates tag references and inserts definitions before slides.

## Consequences

Renaming or recoloring one tag updates all assigned captions without rewriting slide content. A slide has one caption color source, which keeps multi-slide context actions deterministic. Removing a tag leaves its slides untagged. Deck bundles remain content-transfer artifacts and do not carry project-level tag definitions; full project backups preserve them.
