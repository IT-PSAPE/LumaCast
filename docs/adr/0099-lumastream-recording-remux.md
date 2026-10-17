# ADR-0099: LumaStream recording remux

## Status

Accepted

## Context

Some editing workflows require MP4 files even when the original recording was
saved in a crash-resilient container. Stream already bundles FFmpeg for
recording and streaming, but did not provide a way to convert compatible
recordings without another application.

## Decision

- Let users choose an MKV or WebM recording and an MP4 destination through
  native file dialogs.
- Remux by copying streams without transcoding. If the input codecs cannot be
  stored in MP4, report that remuxing failed and keep the original intact.
- Write to a temporary file in the destination directory and rename it into
  place only after FFmpeg completes successfully.
- Keep file access and FFmpeg process management in the main process, behind
  the trusted renderer IPC contract.

## Consequences

Compatible recordings can be repackaged quickly without another generation of
quality loss. Codec compatibility varies by recording, and Stream does not
transcode as part of this action. Failed remux attempts remove temporary output
and preserve the source file.
