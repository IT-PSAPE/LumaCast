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

`dart run tool/check_layering.dart` is the authority for these boundaries:

- A feature may not import another feature, except `shared`, `composition`,
  `dynamics`, and `transitions`.
- `lib/core`, `lib/state`, and the data layer may not import features, and no
  feature imports `lib/app` — that is the composition root, so it is the one
  place allowed to name the concrete feature set (ADR-0038).
- `lib/state` declares no widgets or custom painters.
- Only `lib/core/engine` imports `luma_engine`.
- The data package imports neither Flutter nor Riverpod.
- Only `lib/core/engine/session/` issues transport, arming and voice commands.
  Per-source voices used to be written from three unconnected regimes over one
  flat id space, so "exactly one writer of the voice atomic" was unenforceable
  by reading the code; routing those calls through `EngineSession` only helps if
  nothing bypasses it.

Adding an exception means editing the allow-list in the script *and* saying why,
in the script.

## Docs

- Keep docs thin and useful.
- Do not create local issue specs, phase plans, roadmaps, or agent-workflow documents.
- Put issue-specific designs, implementation plans, decisions, and acceptance notes in GitHub issue comments. For work spanning multiple issues, comment on the root issue and cross-reference the related issues.
- Use GitHub issues for unresolved work that should be tracked.
- Update docs when behavior, architecture, commands, or contracts actually change.
- When a code change materially alters application behavior or an architectural concern, update `docs/ARCHITECTURE.md` in the same change. Architectural concerns include component responsibilities, system boundaries, data flow, public or internal contracts, persistence, security and trust boundaries, integrations, and operational behavior.
- Record each such decision in `docs/adr/` as part of the same change. Amend an existing ADR only when the change refines that ADR's current decision without obscuring its history. Create the next numbered ADR when the decision is new, cross-cutting, materially changes a prior decision, or supersedes one; mark superseded decisions explicitly rather than rewriting history.
- Purely mechanical work that preserves behavior and architecture, such as renaming, formatting, equivalent refactoring, or swapping an implementation behind an unchanged contract, does not require an architecture update or ADR.