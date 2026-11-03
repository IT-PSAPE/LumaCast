# ADR-0120: Stream presentation sources and shared playback sessions

## Status

Accepted

## Context

Stream's image slideshow supports ordered images, but its single-file picker
prevented importing a complete slideshow at once. Operators also need to import
presentation files and choose pages while preserving Studio Mode's committed
configuration. Playback position must remain consistent between Preview,
Program, and matching sources in other scenes instead of returning to a stale
page or restarting a player at each transition.

## Decision

Keep single-media import unchanged and add an ordered, atomic multi-image
picker for slideshow creation and additions. Both enforce the existing
100-image limit before copying and remove new assets if an import fails.

Add a `presentation` source with ordered managed PNG pages. A main-owned worker
converts local PPTX through office-kit and PDF through PDFium, using Sharp for
PNG encoding. No document is uploaded or sent to an installed office suite.
Google Slides is supported through exported PPTX or PDF files. Imports preserve
page order and aspect ratio, cap documents at 50 MB and 100 pages, constrain
archive expansion and raster dimensions, and terminate conversion after 60
seconds. Conversion completes before pages are committed to managed media;
failure removes temporary output and newly copied pages.

Playback uses static slides. Unsupported PowerPoint visuals trigger an error
asking for a PDF export rather than importing a visibly incomplete deck.
PowerPoint font substitution and rendering differences remain possible; PDF
exports provide the authored page appearance. Animations, embedded media, and
live Google Slides synchronization are not part of this source.

Use a session-local runtime resource for matching media across logical source
IDs: video/audio asset and kind, ordered slideshow/presentation page list, or
normalized browser URL and viewport. Keep editor IDs, transforms, and mixer
controls independent. Native inputs retain origin-specific identity.

Page position lives in a runtime cursor store, separate from authored source
configuration. A legacy saved `slideIndex` seeds a new cursor once. Previous,
Next, and Reset affect every matching Preview, Program, and outgoing view
immediately; boundaries clamp. The selected matching resource is used when
possible, with a source selector when several are available. These commands
never rewrite project or Program snapshots, so Transition cannot roll the
cursor back. Automatic advancement is off unless explicitly enabled, including
older sources with an omitted flag. Manual navigation pauses it until the
operator explicitly enables it again in Properties.

Keep player positions, cursor state, and browser DOM state while a graph
reference remains. Acquire browser pages only on their first active view, then
throttle rather than close them outside active views. Pause inactive media and slide
clocks. Reset on entering Program is opt-in and applies only to a new on-air
activation, never to a resource continuously present across a transition.
Visible Program configuration wins over outgoing and Preview configuration;
hidden aliases do not retain resources. Hiding the final visible alias releases
the player/capture/page and audio route. Keep slide cursors and media playback state
as lightweight metadata while a hidden graph reference remains; browser pages
reload on re-show. Clear these
sessions on collection changes or after the last graph reference is removed.
Profile changes preserve matching resources while applying output settings.

Presentation pages and authored playback configuration survive project reload
and portable collection export without the original document. Runtime cursors,
playheads, and browser sessions are not persisted across app restarts. Packaged builds
stage the renderer's licensed fonts outside `app.asar` for the native rasterizer.

## Consequences

Stream gains bounded document parsing, a worker bundle, pinned renderer
dependencies, and a Node.js 22.18 minimum. Conversion does not block the main
window. Imported pages follow the existing managed-media trust boundary and
collection bundle validation.

## Alternatives considered

- Require LibreOffice or PowerPoint: rejected because installation and automation
  differ across supported hosts and add an external runtime requirement.
- Use a hosted document viewer: rejected because playback should work offline
  and presentation files should remain local.
- Store live playback position in each source snapshot: rejected because a
  transition can restore a stale page and separate scene copies restart media.
- Close inactive browser pages immediately: rejected because it discards form,
  navigation, and application state needed when returning to a scene.
