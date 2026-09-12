# ADR 0033: Base UI primitives and a twelve-token colour system

Status: Accepted

## Decision

The renderer's shared UI primitives in `app/renderer/components` are built on Base UI (`@base-ui/react`). Menus, context menus, dropdowns, dialogs, confirmations, popovers, tabs, accordions, checkboxes, toggles, buttons, sliders, switches, fields, inputs, number fields, selects, scroll areas, and tooltips use the corresponding Base UI part for behaviour, keyboard interaction, focus management, and ARIA. Components with no Base UI equivalent (the colour picker's saturation area, the rename field, drag-sorted lists, split panes, virtualised collections) are composed from Base UI parts where a part fits and keep bespoke code only for what Base UI lacks. Each component keeps its existing exported API so feature code is unaffected; the change is internal to the component library.

Overlays keep three app conventions on top of Base UI: they portal into the `#overlay-root` layer, they carry `data-popover-content` or `data-context-menu-owned` so the keyboard-shortcut guards and click-outside logic can recognise them, and they register with the workbench overlay stack while open.

`app/renderer/theme.css` defines the colour system in two tiers: 26 base values (a grey ramp, brand 400–600, red, orange and green 400–600) and twelve semantic tokens: `bg-primary`, `bg-secondary`, `bg-tertiary`, `text-primary`, `text-secondary`, `text-tertiary`, `border-primary`, `border-secondary`, and `brand`, `error`, `warning`, `success` in any namespace. Hover, pressed, tinted and disabled states are opacity modifiers on those tokens. Tailwind's default palette is switched off. Light values live in `@theme`; dark values override the same twelve variables under `[data-theme="dark"]`.

## Consequences

Keyboard and screen-reader behaviour comes from one audited implementation instead of per-component hand-rolled logic, and focus rings now render because `ring-brand` resolves to a token. A palette experiment is an edit to 26 base values or twelve semantic lines and touches no component. The imported design-system tokens (443 variables across palettes, semantics, Tailwind namespaces and an unused utility set) are gone, so a class such as `bg-error_solid-hover` no longer exists; the equivalent is `bg-error/90`. Quaternary and active surfaces fold into `bg-tertiary`, which removes one step of surface depth that the base values can restore if wanted. Base UI renders popups through its own positioner, so overlay geometry is no longer computed by `useAnchorPosition`.
