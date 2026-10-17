# ADR-0094: LumaStream image slideshow sources

## Status

Accepted

## Context

Stream supports one imported image per image source, but does not support OBS's
built-in Image Slideshow source. Collections need to preserve ordered slide
assets and playback settings, and portable collection bundles need to include
every referenced slide.

## Decision

Add an `slideshow` source kind with an ordered list of managed image asset IDs,
a duration from 1 to 600 seconds, and a loop setting. The renderer uses the
existing staged image elements and scene composition clock to advance slides.
Users can add, reorder, and remove images in source properties; at least one
image remains in each slideshow. Collection validation rejects malformed or
oversized lists, and collection bundles export and remap all slide assets.

## Consequences

Slideshow image data follows the same managed-media trust boundary as still
images. Timing is a renderer concern and does not add a new main-process media
service. Collections created before this source was added remain unchanged.

## Alternatives considered

- Treat a slideshow as a single image with a renderer-only playlist: rejected
  because persistence and portable collection export must know every asset.
- Implement an external VLC playlist source: rejected because it requires an
  optional third-party runtime and exceeds the built-in image slideshow need.
