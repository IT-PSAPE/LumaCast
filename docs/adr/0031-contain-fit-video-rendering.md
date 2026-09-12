# ADR 0031: Contain-fit video rendering

Status: Accepted

## Decision

Render every video with contain fitting. The decoded frame keeps its aspect ratio, the longest constrained dimension fills the available bounds, and the other dimension is centered with unused space around it. This applies to canvas video elements, the program video layer, video backgrounds, thumbnails, media pickers, filmstrip frames, and NDI output because those surfaces share the canvas rendering path.

Images keep their existing cover/contain/fill choices. New video backgrounds store `contain`; existing video backgrounds that carry `cover` or `fill` remain compatible but render as contain. Filmstrip extraction writes aspect-preserving frames rather than stretching each sample into a fixed 16:9 bitmap.

## Consequences

Portrait, square, and unusual-aspect videos remain fully visible and never stretch or crop. Video elements may show the slide or output background in unused horizontal or vertical space. Existing projects do not require a data migration.
