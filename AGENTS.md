# Agent Instructions

Be concise. Be explicit. Do not leave ambiguous decisions hidden in implementation.

## Working Model

- Gather only the context needed for the task.
- Start from the user's request and the directly affected files.
- Expand into tests, docs, wider code search, or GitHub context only when ambiguity, risk, or task size justifies it.
- Avoid loading unrelated context just because it exists.
- Combine the user's request with the project context you intentionally gathered.
- If the objective is not at least 95% clear, ask the user before implementing.
- If the objective is clear but details are discoverable, proceed and learn from the codebase.
- Stop and ask when a decision has high architectural, security, data, or product impact.
- Take initiative on clear, low-risk issues found while working.
- Ask before fixing issues that may be intentional, disputed, broad, architectural, security-sensitive, or data-sensitive.
- Tell the user when you fix an adjacent issue.

## Git And GitHub

- Never create a branch unless the user explicitly asks for one.
- Never commit, push, open a PR, merge, or close issues without explicit permission.
- Reconfirm before each branch, commit, push, PR, merge, or issue-closing action unless the user clearly grants autonomous control for that work.
- Create or update GitHub issues intentionally when a bug, deferred decision, missing spec, or follow-up is worth tracking outside the current change.
- Before creating an issue, weigh severity, likelihood, project direction, duplication, and whether the current task should fix it instead.
- If the user says to ignore or drop something, do not track or fix it.
- If the user says to skip something for now, track it only when it is still worth doing later.

## Tests

- Add or update tests for every behavior change.
- Cover normal behavior, failure cases, boundaries, and regressions that could plausibly break.
- Prefer focused tests near the changed behavior, then broaden only when shared contracts are affected.
- Never run the relevant tests unless the user explicitly asks for one.
- In GitHub issues, keep test work in its own "Test plan" section; acceptance criteria state behavioral outcomes only, never test passes.
- Test-plan items are guidance: they are never required to close an issue.

## UI Copy

- Do not add instructional descriptions or explainer notes for app-specific
  controls and behavior. Use concise labels and let the interaction teach the
  workflow.
- Explanatory copy is reserved for errors, destructive consequences, empty
  states, or when the user explicitly requests it.

## Layering Rules

`node tool/check_electron_architecture.mjs` is the executable authority for the
Electron `app/` tree boundaries. It parses static ES imports/exports only,
rejects unsupported dynamic patterns, and runs the rules below against every
committed file. `npm run check:architecture` checks the tree;
`npm run test:architecture` runs its fixture graphs.

- Domain/core policy (`app/core`) imports no Electron, React, renderer,
  database, main-process, native, or feature code.
- The database layer (`app/database`) imports no renderer, feature, or React
  code.
- Main (`app/main`) is the process composition root and imports no renderer or
  feature code.
- The renderer imports no Electron, main-process modules, or database code; it
  reaches main only through the typed `castApi` IPC contract in `app/core`.
- UI/rendering primitives (`app/renderer/components`, `utils`, `types`) import
  no feature implementations.
- A feature may not import another feature; allowed feature dependencies are
  directed, documented, public edges only. Bidirectional feature dependencies
  (cycles) must be removed, never allow-listed. Until the feature web is
  refactored, `feature-isolation` and `feature-cycle` violations are reported as
  warning-level refactor debt (exit 0) and must not be allow-listed; they flip
  to hard errors once the feature web is refactored.
- Features import no screens or application shell (`App.tsx`, `main.tsx`,
  `workbench-screen-router.tsx`); screens and the shell are the composition
  boundaries. When a feature exposes a public entry point (`index.ts`), imports
  of it must go through that entry point.
- Observability is consumed through a port; only screens, the shell, and the
  observability feature itself may reference it directly.
- Only the NDI engine-session boundary (`app/main/ndi`) may touch the native
  module (`@lumacast/ndi-native`) or reference raw NDI host commands
  (`NdiHostCommand`, `NdiHostEvent`). `ndi-service-proxy.ts` is the sole host
  command writer; everything else reaches NDI through `NdiServiceLike`.

Current exceptions live in the checker's frozen allow-list. Adding an exception
means editing the allow-list in the script *and* saying why and who removes it,
in the script. Unused entries fail the check, so the allow-list can only
shrink. `feature-isolation` and `feature-cycle` are warning-level (exit 0) until
the feature web is refactored; they are reported as refactor debt and must not
be allow-listed, and become hard errors once the refactor lands.

## Docs

- Keep docs thin and useful.
- Do not create local issue specs, phase plans, roadmaps, or agent-workflow documents.
- Put issue-specific designs, implementation plans, decisions, and acceptance notes in GitHub issue comments. For work spanning multiple issues, comment on the root issue and cross-reference the related issues.
- Use GitHub issues for unresolved work that should be tracked.
- Update docs when behavior, architecture, commands, or contracts actually change.
- When a code change materially alters application behavior or an architectural concern, update `docs/ARCHITECTURE.md` in the same change. Architectural concerns include component responsibilities, system boundaries, data flow, public or internal contracts, persistence, security and trust boundaries, integrations, and operational behavior.
- Record each such decision in `docs/adr/` as part of the same change. Amend an existing ADR only when the change refines that ADR's current decision without obscuring its history. Create the next numbered ADR when the decision is new, cross-cutting, materially changes a prior decision, or supersedes one; mark superseded decisions explicitly rather than rewriting history.
- Purely mechanical work that preserves behavior and architecture, such as renaming, formatting, equivalent refactoring, or swapping an implementation behind an unchanged contract, does not require an architecture update or ADR.