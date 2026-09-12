# ADR 0032: DOM-rendered inline text editing

Status: Accepted

## Decision

While a text element is being edited on the canvas, the inline editor's `contentEditable` renders the element's text visibly and the canvas stops drawing that element's text (`SceneNodeText` `hideText`, threaded through `renderSceneNodeContent`). The element's background fill, stroke, and shadow keep rendering on the canvas. Text, caret, and selection therefore come from one layout engine, the browser's, and nothing is measured or cached to position them.

The editor's geometry is declarative. A frame sits exactly on the element bounds in screen pixels and carries the element's rotation, flip, and opacity with the same transform order as the Konva group. The frame is a column flexbox whose `justify-content` is the element's vertical alignment; that one rule reproduces both canvas placements: content shorter than the box is aligned inside it, and content taller than the box overflows the way the canvas overflows it (equally above and below for middle, upward for bottom, downward for top). The editable fills the frame's width and takes its height from its content. The one remaining shared computation is the auto-fit font size, taken from the same `computeAutoFitRichTextFontSize` the canvas uses, recomputed from the live body on every change. The toolbar reads the rendered text's top from the DOM so it sits above overflowing text.

The editor styles the DOM from the element: resolved run color, weight, style, decorations and em-ratio sizes on run spans; box font, alignment, uppercase transform, text stroke, and text shadow on the root; list markers as `::before` content whose column width is the canvas-measured marker width in em. A selection that must stay visible while a toolbar field holds focus is painted through the CSS Custom Highlight API over the tracked model range, never by rewriting markup.

A text box grows to hold what is typed into it. On every live change and on commit, `fitTextElementToBody` lays the body out with the canvas's own `prepareRichLayout` and, when the text is taller than the box, grows the box to the text: a middle-aligned box grows equally up and down, a bottom-aligned box upward, a top-aligned box downward, which is exactly where the canvas already drew the overflowing text, so nothing moves on commit. A box never shrinks below its authored height, and auto-fit boxes are left alone because there the font fits the box.

This supersedes the earlier rule that the canvas is the only render path during editing and that the editor is a transparent overlay aligned to the canvas layout.

## Consequences

Caret, highlight, and text can no longer disagree, and re-opening an element lays out exactly as it did while typing, because both derive from the same DOM content. The visual swap on enter and exit is between two renderers of the same text; they agree on frame, size, alignment, line height, and marker column, and may differ by sub-pixel glyph placement or word-break edge cases. Text stroke inside position is approximated by a centered stroke while editing. The frame outline stays on the element bounds, the same box the transformer shows, so overflowing text extends past it in edit and view mode alike.
