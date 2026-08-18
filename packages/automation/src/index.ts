// Public entry point for @lumacast/automation (issue #219, wave W2). This
// package is the automation domain model — cues, macros, and trigger
// bindings — plus the headless cue-description helper the macro editor UI
// renders labels from. The deterministic macro/cue *runtime* (run
// bookkeeping, delays, cancel/revert) is a later wave (#219 W8); it stays in
// app/renderer/features/automation/automation-context.tsx for now.
export * from './model';
export * from './describe-cue';
