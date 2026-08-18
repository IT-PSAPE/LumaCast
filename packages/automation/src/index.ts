// Public entry point for @lumacast/automation (issue #219). This package is
// the automation domain model — Cues, Macros, and Trigger Bindings — the
// headless cue-description helper the macro editor UI renders labels from,
// the Trigger event contract, and (wave W8) the deterministic Macro/Cue
// runtime core: Macro Run bookkeeping, delays, Cancel/Revert, Scope exit
// sweeps, loop iteration, and trigger firing. The React provider
// (app/renderer/features/automation/automation-context.tsx) supplies real
// ports and keeps React state orchestration plus persistence/CRUD I/O.
export * from './model';
export * from './describe-cue';
export * from './events';
export * from './runtime';
