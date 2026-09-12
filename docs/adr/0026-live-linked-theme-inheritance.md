# ADR 0026: Live linked theme inheritance

Status: Accepted

## Context

Items stored a theme ID and element provenance, but styling was copied into slide rows and refreshed by an explicit synchronization operation. Theme edits therefore did not consistently update the audience output. Existing local edits must survive the move to live inheritance.

## Decision

Resolve linked presentation and lyric slide appearance from the current theme through the composition package. Preserve authored text and explicit local property overrides. Local backgrounds continue to win through `backgroundSource`. Theme drafts are projected through the renderer composition context so preview and live surfaces use the same inherited styling without a manual synchronization step.

Store override keys durably on linked elements, including nested children. New edits compare before and after values so unrelated properties do not become overrides. Legacy differences are preserved conservatively because historical data cannot distinguish a deliberate edit from an old copied value.

Use deterministic identities for newly inherited elements. Deleting an inherited element locally records a visibility override so it does not reappear on the next resolution. Detachment materializes the resolved appearance and removes the link; deleting a theme must preserve the appearance of linked items. Those mutations belong in repository transactions rather than a sequence of renderer writes.

Do not resize existing slides when theme dimensions change. Slide dimensions remain an item-level choice. Overlay theme retirement is separate (ADR-0025).

## Consequences

Theme changes propagate through the shared read path rather than rewriting every linked slide. Override metadata must survive persistence, history, duplication, and import/export. An old divergent property can remain pinned after migration; this intentionally favors preserving existing local appearance over guessing the author's historical intent.
