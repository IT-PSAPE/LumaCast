# ADR-0098: LumaStream RTMP reconnect

## Status

Accepted

## Context

Live output is encoded by a child FFmpeg process. A transient process or network
failure previously ended the stream immediately, even though the renderer could
continue providing program media.

## Decision

- Retry a failed output process up to five times with exponential delay capped
  at eight seconds.
- Keep the current session and destination transient. Recreate the encoder with
  the same validated settings, replay its WebM header, then replay buffered
  media in order.
- Bound recovery media to 64 MiB. Fail the session if the buffer fills or all
  retries are exhausted.
- Cancel scheduled retries when the user stops the stream.

## Consequences

Brief output-process interruptions can recover without a new user start
command. Long interruptions terminate with an error instead of growing memory
without limit. Reconnect can include a short media gap while the encoder and
network recover; it does not guarantee uninterrupted delivery or server-side
session continuity.
