# ADR-0045: LumaChord, the Lyric-Video Maker

## Status

Accepted. Adds a fourth app to the layout and release pipeline of ADR-0043;
ADR-0044's suite manager gains LumaChord as a managed identity.

## Date

2026-09-26

## Context

LumaCast can bind a lyric deck to an audio track and record markers so slides
advance in time with the song during a live show. That timing only ever exists
inside a running show: nothing could turn it into a finished, shareable video,
and the markers themselves could not leave the app. Producing a lyric video
today means rebuilding the timing by hand in a general video editor.

The suite already has most of the rendering: `@lumacast/composition` holds
the text element and rich-text model, and `@lumacast/canvas` draws it with
Konva. What was missing was a timeline, a document, an interchange format for
timed lyrics, and an export pipeline, which no app in the repository had.

## Decision

- **A new app, `apps/chord` (LumaChord, `com.lumacast.chord`).** It is a
  self-contained Electron app on the same shell, release gate, feed, and
  workflow as the others, registered in `tool/release-version.mjs`, the CI
  wrapper `chord.yml`, and the suite registry so LumaCloud can install it.
- **`@lumacast/markers` is the interchange format.** A kernel-only package
  holds the codecs for timed lyric cues: the suite's own CSV
  (`order,timestamp,text`, RFC 4180 quoting, `HH:MM:SS.mmm` timestamps) and,
  because users already have them, LRC and SRT. LumaCast exports its
  audio-sync markers through it, and LumaChord imports and exports through
  it, so the timing recorded for a show becomes the timing of the video.
- **The project is a JSON document.** A `.lumachord` file carries the
  composition size and frame rate, the audio and background media
  references (absolute paths the user chose), one universal theme, and the
  cues. A cue inherits the theme unless it is detached, in which case it
  carries an override of the same shape. Text style and rich-text runs use
  the composition types unchanged so the canvas package renders a cue
  without an adapter. The renderer owns the document, its undo history, and
  the dirty state; main owns files, dialogs, and the menu.
- **Media reaches the renderer through an admitted-path scheme.** Main serves
  `lumachord://file/<path>` with Range support for only the paths the user
  admitted through a dialog, a drop, or a project file. The renderer never
  sees a raw filesystem path outside that allow-list.
- **Export is rendered in the renderer and encoded with WebCodecs.** The
  export engine draws every frame of the composition through the same Konva
  stage the preview uses, encodes it with the browser's `VideoEncoder`
  through mediabunny (MPL-2.0, pure TypeScript), muxes the decoded audio, and
  streams the container to a file sink in main. Supported outputs are MP4,
  MOV, WebM, and MKV with H.264, HEVC, VP9, or AV1 video and AAC or Opus
  audio; audio-only exports as M4A, MP3, or WAV; and a PNG of one frame.
  Background video is decoded frame-accurately for export rather than
  captured from a playing element. No native encoder binary ships with the
  app, and no GPL component is introduced.
- **The timeline follows video-editor conventions.** A transport with frame
  stepping, a scrubbable ruler, a waveform audio track, a lyric track of
  draggable and trimmable clips with snapping, split at playhead, marquee and
  multi-selection, zoom around the cursor, playhead following, and a
  tap-to-mark mode that times imported plain lyrics while the song plays.

## Consequences

Timing recorded in LumaCast is reusable, and a finished lyric video is one
export away. The CSV is the contract between the two apps and is now
covered by the shared package's tests.

Export speed and codec availability depend on Chromium's WebCodecs on each
platform. H.264 and AAC are hardware-backed on macOS and Windows; where a
codec is missing the engine falls back to one the platform can encode or to
the bundled AAC and MP3 software encoders. Fonts are the machine's installed
fonts, as in LumaCast, so an exported video looks as it did on the machine
that rendered it.

Media references are absolute paths, so a project moved to another machine
must have its audio and background re-imported.

## Document navigation and export retirement (2026-11-08)

The renderer shell coordinates New, Open, recent files, and OS-open requests
as one pending action with Save/Discard/Cancel protection. Main sends raw path
intents; reading a replacement file cannot race consent or another open request.
Consent belongs to an exact loaded-document session and revision, including
same-ID replacement. Cancelled pickers, failed saves, and edits during prompts
preserve the current document. Choosing Save on close retains the existing
stay-open behavior.

Native close waits for the mounted renderer to decide from its live store.
The debounced native dirty mirror can lag edits, so it cannot authorize close.
After accepted close, main retires that window's export registry and replays
native close. The renderer synchronously vetoes a changed revision or session
at that final boundary; asynchronous drain alone cannot guarantee the approved
document is still current. A veto restores a fresh registry only after its
predecessor drains. Renderer replacement and quit use the same ownership fence.

Export sinks stage in exclusive sibling temporary files. Complete ordered
positional writes, sync, and close precede atomic replacement; failures and
cancellation clean up only the captured temporary file. The first close or
abort wins, and an accepted close cannot later report successful cancellation.
Retirement blocks new admissions, drains accepted publication, and aborts other
staged work. Cleanup failure retains ownership for retry instead of forgetting
an open handle or deleting the prior export.

## Bounded export decoding and track completion (2026-11-08)

Export requests retain their API and loaded-document session through path
choice, preparation, progress, and publication. Setup failure and cancellation
release acquired resources; obsolete work cannot replace a successor's status.
Publication seals only immediately before main accepts the final file close.

Audio and video feed the muxer in timestamp order, awaiting track completion
as each track ends. Unequal tails retain their original content; audio is not
padded or trimmed to match saved duration metadata. Audio and background-video
inputs use 8 MiB range caches. Background video keeps only current/lookahead
samples and two
alternating canvases, whose combined RGBA allocation must fit 128 MiB. This
canvas budget is separate from browser/codec buffers. Ambiguous timestamp
precision is rejected rather than silently choosing the wrong frame.

The existing MediaBunny dependency needs a pinned lifecycle correction to make
early track completion awaitable and failure-safe; see ADR-0123 for the patch,
verification, source-distribution, and removal contract.
