# ADR-0103: SRT streaming output

## Status

Accepted

## Context

Stream's live output accepted only RTMP and RTMPS destinations and always muxed
the encoded stream as FLV. SRT is a common low-latency transport that carries
MPEG-TS and supports caller, listener, and rendezvous modes through FFmpeg URL
options. The pinned shared LGPL FFmpeg build includes the SRT protocol.

## Decision

Keep the live output engine and encoder path, but infer SRT from an `srt://`
destination. Require an explicit host and port, accept FFmpeg SRT options in
the query string, reject URL user information and fragments, and mux SRT output
as MPEG-TS. Preserve FLV muxing for RTMP and RTMPS.

## Consequences

- Existing RTMP/RTMPS destinations and reconnect behavior remain unchanged.
- SRT settings such as mode, latency, stream ID, and encryption passphrase are
  supplied using FFmpeg's documented URL options.
- Stream does not expose a separate service catalog or SRT property form yet.
