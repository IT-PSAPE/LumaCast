# ADR-0051: Slide Exit Automation

## Status

Accepted

## Date

2026-10-11

## Context

Activate and Take bindings run on the incoming live slide. Operators also need
cleanup actions when a slide leaves output, including clearing layers before
the next slide is armed.

## Decision

- Add `slide.exit` to the existing trigger-binding vocabulary and its RPC,
  agent-action, and backup validators. Binding storage is already unconstrained
  text, so the database schema is unchanged.
- The headless automation runtime tracks the live slide identity. A change
  first applies outgoing macro scope policies, then fires Exit bindings once
  for the outgoing slide. A same-slide retake does not exit.
- `SlideProvider` announces a pending live identity before arming output.
  Exit cleanup therefore precedes arming; existing Activate and Take bindings
  continue to run after arming. The automation provider also observes live
  output to handle unarming, deletion, and generated-slide configuration changes.
- Exit-triggered macros run globally, including delayed steps. They cannot
  bind to an already-expired slide/item scope; explicit lifecycle controls
  remain available to cancel them.
- The slide automation menu, binding badge/menu, and macro trigger inspector
  expose Exit alongside Activate and Take.

## Consequences

Existing entrance bindings retain their behavior. Exit actions run on live
identity changes, independently of browsing or selection. Delayed Exit actions
can affect later output, as with other globally running macros.
