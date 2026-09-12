# ADR 0024: Independent playback schedules

Status: Accepted

## Context

Operators need bulk slide durations and audio marker timing without adding a second slide activation mechanism or making a content item own its playback bindings.

## Decision

Persist independent `PlaybackSchedule` records. A slide-timing schedule refers to an item and an ordered list of slide IDs and durations. Its ordering does not mutate the item's slide order. An audio-sync schedule refers to an audio asset, an optional item, and timed slide markers. UI records have stable IDs per item or audio asset.

The automation package owns deterministic clock decisions. A renderer provider supplies the monotonic clock, exact audio playhead, and existing slide activation boundary. Scheduled activations emit the existing slide activation/take triggers so slide automation continues to work.

An enabled audio binding has priority over timed slides, including while paused or manually suspended. Manual output changes suspend audio synchronization until Resume. Audio seeks select the destination marker without replaying skipped slide cues. Timed schedules hold their final slide.

Schedules participate in snapshot patches, undo/redo, and full project backups. Missing content is not reconstructed by a schedule. Recording an unbound audio draft is supported; enabling requires valid destinations.

## Consequences

Timing and audio bindings borrow content identities without duplicating slides. Duration editing uses one reorderable modal; audio recording and destination editing live beside the audio transport. Deleting or replacing referenced content can leave a schedule needing correction.
