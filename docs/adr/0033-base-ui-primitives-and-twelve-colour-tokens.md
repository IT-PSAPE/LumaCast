# ADR 0033: Base UI primitives and semantic colour roles

Status: Accepted

## Decision

The suite's shared UI primitives in `packages/ui/src` are built on Base UI (`@base-ui/react`). Menus, context menus, dropdowns, dialogs, confirmations, popovers, tabs, accordions, checkboxes, toggles, buttons, sliders, switches, fields, inputs, number fields, selects, scroll areas, and tooltips use the corresponding Base UI part for behaviour, keyboard interaction, focus management, and ARIA. Components with no Base UI equivalent (the colour picker's saturation area, the rename field, drag-sorted lists, split panes, virtualised collections) are composed from Base UI parts where a part fits and keep bespoke code only for what Base UI lacks. Existing component APIs remain available; temporary read-only state and interaction cancellation are additive contracts.

Overlays keep three app conventions on top of Base UI: they portal into the `#overlay-root` layer, they carry `data-popover-content` or `data-context-menu-owned` so the keyboard-shortcut guards and click-outside logic can recognise them, and they register with the workbench overlay stack while open.

`packages/ui/src/theme.css` defines the shared colour system in two tiers: 26 base values (a grey ramp, brand 400–600, red, orange and green 400–600) and semantic roles. The neutral surface/text/border roles and `brand`, `error`, `warning`, `success` remain the foundation; tinted surfaces use opacity modifiers. Contrast-safe `brand-solid`, `error-solid`, `warning-solid`, and `success-solid` fills pair with `on-solid` text for small action and badge labels. Solid primary hover and pointer-pressed states use the opaque, darker `brand-solid-hover` role. The solid roles remain independent of semantic text colours so brighter dark-mode accents do not reduce white-label contrast below 4.5:1. Tailwind's default palette is switched off. Light values live in `@theme`; dark values override neutral and semantic roles under `[data-theme="dark"]`.

Keyboard focus has a foreground-derived `focus-ring` fallback inset inside the control, so clipped editor chrome does not hide it. Components with their own focus ring or wrapper treatment override the fallback. A Slider's visually hidden native input exposes keyboard focus through `:has(input:focus-visible)` on its visible thumb, including a system outline in forced-colour mode. Forced-colour mode restores a system outline because box-shadow rings are suppressed there; pointer focus does not acquire this fallback.

Secondary typography has shared `caption` (11px/1.5) and `annotation` (10px/1.4)
roles. Caption covers secondary facts and helper prose; annotation covers short
secondary data such as zoom and file format. Keep annotation out of control
labels, errors, and essential instructions. Monospaced shortcuts and timestamps
retain their separate leading rather than inheriting a sans-serif text role.

## Slider pointer ownership refinement (2026-11-08)

The shared scalar Slider retains Base UI's keyboard, native input, semantics,
and rendering, while `use-slider-pointer.ts` owns pointer capture and one
pointer ID. Public Control/Thumb event handlers prevent Base UI's pointer start;
local touch-start capture prevents a second legacy gesture. This avoids the
installed library's global release handling, which can terminate a primary
drag when another pointer ends. Callback filtering alone cannot preserve that
drag; replacing the whole control with a native range would also replace its
rendering. Natively disabling a temporarily busy input loses keyboard focus.

The public `useSliderInteraction` recipe supplies complete guarded Root,
Control, and Thumb bindings, a measurement ref, and semantic focus styling.
The styled Slider and Cast's inspector, hue, and alpha controls share this
wiring while retaining their own visuals. Bindings own their handlers and refs;
consumers add visual and ARIA props without overriding that authority. A Track
or full-surface Control defines the travel geometry. Inset focus suits clipped
frames; outside focus stays clear of arbitrary colors inside colored thumbs.

`readOnly` rejects edits without disabling or replacing the input.
`interactionKey` identifies the edited resource, and `onCancel` lets its owner
discard a draft. Busy, identity, geometry, and capture changes retire pointer
authority; keyboard/native-input edits supersede an active pointer. The adapter
owns step rounding, RTL/vertical geometry, and capture cleanup, so regressions
cover those contracts alongside normal consumers and rendered focus behavior.
Scalar and range controls expose native-input focus on the visible thumb or
frame. They mask pointer-initiated focus until keyboard input or focus leaves the
control; moving between range thumbs retains the current modality. Range seek
and filled-range drag paths that retain focus do not set the pointer mask.
Native `:focus-visible` remains the keyboard authority. This preserves the same
indication on older Chromium versions whose programmatic focus heuristics differ.

## Consequences

Keyboard and screen-reader behaviour comes from shared Base UI implementations instead of per-component hand-rolled logic. Palette and contrast decisions stay in the shared theme rather than in component-specific literals. The unused imported design-system token set is gone; semantic text, tinted surfaces, solid fills, and keyboard focus now have explicit jobs instead of treating opacity as a solution for every state. Quaternary and active surfaces fold into `bg-tertiary`. Base UI renders popups through its own positioner, so overlay geometry is no longer computed by `useAnchorPosition`. Source and unit checks complement rendered keyboard, theme, contrast, and forced-colour verification; they do not establish complete accessibility conformance.
