# ADR-0107: LumaStream styled text sources

## Status

Accepted

## Context

Stream's initial text source only drew bold, unwrapped text at a fixed scale.
Its project data had no style contract, and long or multiline copy could escape
the source transform bounds. Stream renders scene sources with its own Canvas
compositor and must not advertise this feature as a platform GDI+ source.

## Decision

Persist a `textStyle` object on text sources for font family and size,
bold/italic, horizontal and vertical alignment, outline, drop shadow, and
background color/opacity. Project decoding supplies the default style when an
older text source does not include this object, and rejects malformed style
values or styling attached to non-text sources.

The renderer wraps words to the source width, preserves explicit newlines,
breaks overlong words at character boundaries, aligns the resulting line
block, and clips background, outline, shadow, and glyphs to the source
transform. Font family names refer to fonts installed on the host. Source
properties expose concise controls for text and the supported styles.

## Consequences

- Existing scene collections load with a readable, bold Segoe UI default and
  can be saved without a project-version migration.
- Preview, program, recording, and streaming share the same Canvas text
  rendering path.
- Text uses host font availability; this change does not package fonts or watch
  external text files.
