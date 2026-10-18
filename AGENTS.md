# Agent Instructions

Be concise. Be explicit. Do not leave ambiguous decisions hidden in implementation.

## Working Model

- Start from the user's requested outcome, not an assumed implementation.
- Locate the smallest relevant subsystem and inspect enough surrounding code to understand its contracts, callers, data flow, existing patterns, and nearby tests.
- Prefer discovering project-specific details from the repository over asking the user.
- Ask only when an unresolved decision would materially change product behavior, architecture, data, security, destructive actions, or the user's intended outcome.
- If the requested outcome already authorizes an architectural or data change, do not stop merely because the implementation has architectural or data consequences.
- Form the smallest complete implementation that satisfies the request and preserves unrelated behavior.
- Follow existing project patterns unless there is a concrete reason to change them.
- Use the project's existing package manager, tooling, conventions, and dependency choices. Avoid introducing new dependencies when the existing stack can solve the problem cleanly.
- Do not expand the task into unrelated refactoring, cleanup, or redesign.
- Fix adjacent defects only when they directly interfere with the requested work and the correction is unambiguous and low-risk. Otherwise report or track them.
- Treat destructive commands, migrations, production operations, secrets, and irreversible changes as higher-risk actions and confirm when the user's request does not already clearly authorize them.
- After implementation, run the smallest relevant verification and broaden it when shared contracts are affected.
- Do not consider work complete merely because code was written. Distinguish implemented, verified, and intentionally deferred work.
- Finish by summarizing what changed, what was verified, and any unresolved decisions or risks.

## Git And GitHub

- Never create a branch unless the user explicitly asks for one.
- Never commit, push, open a PR, merge, or close issues without explicit permission.
- Reconfirm before each branch, commit, push, PR, merge, or issue-closing action unless the user clearly grants autonomous control for that work.
- Create or update GitHub issues intentionally when a bug, deferred decision, missing spec, or follow-up is worth tracking outside the current change.
- Before creating an issue, weigh severity, likelihood, project direction, duplication, and whether the current task should fix it instead.
- If the user says to ignore or drop something, do not track or fix it.
- If the user says to skip something for now, track it only when it is still worth doing later.

## Tests

- Add or update tests when behavior changes and the project has an established test path for that behavior.
- Cover the important normal path, plausible failure cases, boundaries, and regressions relevant to the change.
- Prefer focused tests near the changed behavior, then broaden only when shared contracts are affected.
- Run the smallest relevant verification after meaningful changes. Broaden to wider tests, type checks, builds, or end-to-end checks when the affected surface justifies it.
- Ask before running unusually expensive, destructive, external, production-facing, or otherwise high-impact verification.
- In tracked work, keep acceptance criteria focused on behavioral outcomes. Keep verification steps separate where useful.
- If relevant verification is skipped, blocked, or fails for reasons outside the change, say so explicitly.

## UI Copy

- Prefer interfaces that are understandable through labels, grouping, hierarchy, and interaction rather than explanatory text.
- Keep labels concise and avoid adding instructional copy when the interaction is already clear.
- Add explanatory copy when users cannot reasonably infer meaning, required input, consequences, permissions, or unusual behavior from the interface itself.
- Use supporting copy where it materially helps with errors, destructive actions, empty states, onboarding, domain-specific settings, or other high-consequence interactions.

## Docs

- Keep docs thin, useful, and aligned with the repository's existing documentation conventions.
- Do not create local issue specs, phase plans, roadmaps, or agent-workflow documents unless the project already uses them or the user asks for them.
- Keep task-specific planning and decisions with the task's source of truth. Keep durable technical knowledge in the repository.
- Use the project's existing issue tracker for unresolved work that should remain visible after the current task.
- Update user or developer documentation when externally meaningful behavior, commands, setup, or contracts change.
- Update architecture documentation when architecture actually changes.
- Do not assume every repository uses `docs/ARCHITECTURE.md` or `docs/adr/`; follow the structure already established by the project.
- Create or update an ADR when the work introduces a durable architectural decision with meaningful alternatives, constraints, or consequences that future maintainers would otherwise have to rediscover.
- Purely mechanical work that preserves behavior and architecture, such as renaming, formatting, equivalent refactoring, or swapping an implementation behind an unchanged contract, does not require architecture documentation or an ADR.