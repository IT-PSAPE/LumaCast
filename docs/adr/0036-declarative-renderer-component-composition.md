# ADR-0036: Declarative renderer component composition

## Status

Accepted.

## Decision

Compose renderer UI from named, self-contained components whose visual states
and markup are colocated. Reuse the compound-part convention already established
by Base UI-backed primitives such as `Tabs.*`, `Dialog.*`, `EmptyState.*`, and
feature-owned structures such as `Section.*` and `ResourceDrawer.*`. Screens and
features write the concrete parts explicitly at the point where they render.

Do not build unique UI through one-use `ReactNode` arrays, component registries,
or configuration arrays that separate the visible state from its markup. Keep a
one-use label, option, icon, class, or derived value at its use site. Lift a value
or state only when it is reused, has domain meaning, or must coordinate consumers
above the owning component.

Shared primitives may normalize their explicitly composed children into the
metadata required by an underlying UI library. That internal collection is
plumbing for the compound API, not a caller-authored registry of visible states.

This decision does not ban conditional control flow. Validation, event routing,
async cancellation, hook synchronization, algorithms, exhaustive domain
dispatch, virtualization and geometry, and renderer/NDI hot paths keep direct
guards when those guards are the clearest implementation. Do not introduce
generic `When` or `Maybe` components merely to conceal a condition.

## Consequences

Searching for an empty, loading, selected, or variant state leads to the
component that renders it. Unique screen structure remains readable as JSX
instead of requiring reconstruction from data declarations. Compound APIs add
small local components where a repeated visual structure has meaningful parts;
they do not become a second application-state layer. Some intentional control
flow remains, and review must distinguish UI indirection from guards that protect
correctness or performance.
