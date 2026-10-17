# ADR-0105: RIST streaming output

## Status

Accepted

## Context

Stream can publish using RTMP/RTMPS and SRT, but not RIST. OBS supports custom
RIST output URLs, and Stream's pinned FFmpeg build includes the RIST protocol.
FFmpeg muxes RIST streams as MPEG-TS.

## Decision

Accept `rist://` destinations with a host and port, allow FFmpeg RIST protocol
options in the query string, and select MPEG-TS muxing. Continue using FLV for
RTMP/RTMPS; SRT and RIST share the MPEG-TS path.

## Consequences

- Existing RTMP/RTMPS, SRT, reconnect, and status behavior remains unchanged.
- RIST profile, bandwidth, buffer, and encryption settings are supplied through
  FFmpeg URL options; Stream does not provide a separate property form yet.
