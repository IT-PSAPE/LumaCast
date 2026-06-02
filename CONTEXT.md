# Automation (Macros & Cues)

The automation context drives presentation side-effects (overlays, media, stages, layers) from
triggers fired by slides, deck items, or app startup. This glossary fixes the language around
macros, cues, scope, and lifecycle so that code, UI, and discussion stay aligned.

## Language

**Macro**:
A named, ordered list of **Cues**. The unit of triggering, scope, looping, and lifecycle.
_Avoid_: Cue Group, Action Group — a Macro *is* the group; there is no separate grouping concept.

**Cue**:
One atomic side-effect (activate an overlay, set a media layer, arm a video, …). Cues are
content-deduped and shared across Macros, so a Cue is shared *identity*, not a per-use instance.
A Cue inherits its Macro's **Scope**.
_Avoid_: Action, Step (the DB tables are named `cues` / `action_steps`, but the domain term is Cue).

**Cue step** (macro step / `MacroCue`):
One ordered use of a **Cue** inside a **Macro**, carrying its own before/after **delays**. Delays
are per-step (per occurrence), not part of the shared Cue identity — the same Cue can appear with
different delays in different Macros.

**Scope**:
The context a Macro's lifetime is bound to. Levels: **global**, **deck item**, **slide**. The
*level* is authored on the Macro; the *concrete context* (which slide / deck item) is captured
from the trigger at run time.
_Avoid_: Context (overloaded), Boundary.

**Macro Run** (instance):
One triggered execution of a Macro, bound to a concrete Scope context, with its own run id.
Several Runs of the same Macro can be active at once — triggers **stack**, never dedupe.
_Avoid_: Execution, Invocation (use Run consistently).

**Scope exit**:
The moment a Run's bound context stops being live — advancing off the bound slide, or switching
to a different deck item. Global Runs never exit (until app close).

**Cancel**:
Stop a Run's pending delays and future loop iterations. Already-applied effects stay on screen.

**Revert**:
**Cancel** plus undo the Run's applied effects, using each Cue's static inverse (e.g.
`overlay.activate` → clear that overlay). Does **not** restore whatever was on screen *before*
the Macro ran.
_Avoid_: Clear — `*.clear` / `*.clearAll` are forward Cue kinds that put the screen into a clean
state; "Revert" is the lifecycle undo. Keep them distinct.

## Relationships

- A **Macro** contains one or more ordered **Cues**.
- A **Trigger Binding** fires a **Macro** (scoped/lifecycle-managed) or a bare **Cue** (always
  global fire-and-forget).
- A **Macro Run** belongs to exactly one **Scope** context, resolved from its trigger.
- **Scope exit** applies a Run's authored on-exit behavior: Cancel, Revert, or nothing.

## Example dialogue

> **Dev:** "If a slide triggers a looping Macro and the operator advances, what happens?"
> **Domain expert:** "The Run exits scope. If the Macro's on-exit is Cancel, pending delays and
> the next loop iteration stop but the overlay it already showed stays up. If it's Revert, that
> overlay is also cleared via its inverse."
> **Dev:** "And if they re-take the same slide while it's still running?"
> **Domain expert:** "A second Run stacks alongside the first — triggers never dedupe."

## Flagged ambiguities

- "Clear" meant both a forward Cue kind and the lifecycle undo — resolved: the lifecycle undo is
  **Revert**; "clear" refers only to the `*.clear` Cue kinds.
- "Group" implied a Cue Group entity — resolved: there is no Cue Group; the **Macro** is the group.

---

# Rich Text

Text boxes whose styling can vary *within* the box rather than applying uniformly to the
whole box. This glossary fixes the language around the content structure, the two levels of
styling, and how dynamic text relates to formatting, so code, UI, and discussion stay aligned.

## Language

**Rich Text**:
The capability of a text box to carry styling that varies within it (per word, phrase, or
character), as opposed to one uniform style for the whole box.
_Avoid_: Formatted text, styled text (too vague).

**Rich Body**:
The structured content of a text box — an ordered list of **Blocks**. The unit that replaces a
flat content string for authored (non-bound) text.
_Avoid_: Document, rich string, HTML.

**Block**:
One paragraph or one list item; the block-level unit of a **Rich Body**. A Block carries its own
list state (bullet vs. numbered, indent level) and contains one or more **Runs**.
_Avoid_: Line, node, paragraph node (a Block may wrap across several rendered lines).

**Run**:
A contiguous span of characters within a single **Block** that share the same **Run-level style**.
_Avoid_: Span, segment, fragment.

**Run-level style**:
Styling that may vary per character within a box: **color**, **weight**, **italic**, **underline**,
**strikethrough**. A Run stores only the attributes it *overrides*; unset attributes inherit the
**Box-level style**.
_Avoid_: Inline style, character style.

**Box-level style**:
Styling that applies uniformly to the whole text box and cannot vary per character: **font family**,
**font size**, alignment, vertical alignment, line height, case transform, auto-fit, stroke, shadow.
Box-level values are the defaults a Run inherits when it does not override them.
_Avoid_: Global style, default style (reserve "default" for the inherited-fallback role only).

**Bound text**:
A text box whose displayed content is generated at run time from a **Binding** (clock, timer, slide
text, notes). Bound text is always rendered with a single **Box-level style** — **Runs** do not apply
to it, because the content does not exist at authoring time.
_Avoid_: Dynamic style (the binding is dynamic; its styling is plain/box-level).

## Relationships

- A **Rich Body** contains one or more ordered **Blocks**.
- A **Block** contains one or more **Runs**, and carries its own list state.
- A **Run** carries only **Run-level style** overrides; anything unset resolves to the **Box-level style**.
- A box is either **Rich** (has a Rich Body) or plain/**Bound** (renders one Box-level style over a string).
- **Font size** is always **Box-level** and is managed at the component level, never per **Run**.

## Example dialogue

> **Dev:** "If a Run only sets color, where does its weight come from?"
> **Domain expert:** "The Box-level style. A Run stores overrides only — unset attributes inherit the box."
> **Dev:** "And a text box bound to the clock — can the operator make the seconds bold?"
> **Domain expert:** "No. Bound text has no Runs; it renders one Box-level style over the resolved string."

## Flagged ambiguities

- "Bold" was used to mean both the per-Run weight toggle and a fixed heavy weight — resolved: a Run's
  **weight** is a true numeric value; the editor exposes a regular↔bold toggle over it for v1.
- "Style" was overloaded across the box and the character span — resolved: **Box-level style** vs.
  **Run-level style** are distinct, and **font size** belongs only to the former.
