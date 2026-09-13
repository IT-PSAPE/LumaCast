# ADR-0037: Agent Actions Execute in the Renderer

## Status

Accepted

## Date

2026-09-13

## Context

Two new callers need to act on the application programmatically: the in-app
assistant, whose runtime lives in the main process, and an MCP server that
exposes the same vocabulary to external clients. Both start life in main.

The obvious wiring — let main call `CastRepository` directly — breaks three
things the application already depends on:

- **Undo history lives in the renderer.** `app/renderer/contexts/app-store.ts`
  owns `undoStack`/`redoStack` and the patch/snapshot entries ADR-0009
  describes. A mutation that main applied on its own would be invisible to
  Cmd-Z, so an agent could make changes the user cannot walk back.
- **Live-show verbs only exist in the renderer.** Take, overlay activation,
  transport, stage arming, macro execution: 69 of the 174 canonical
  `ActionId`s have no repository operation behind them at all.
- **Mutation serialization already exists, once.** The store's
  `enqueueStoreWork` is the single point that orders mutations against each
  other. A second writer in main would race it.

The permission model is also a renderer concern in practice: the user answers
the prompt, and the show-safety interlock is a judgement about what is live on
an output right now.

## Decision

- Main never touches the repository on an agent's behalf. It sends an
  **action request** to the renderer and waits for a response.
- `packages/protocol/src/agent-actions.ts` is the wire contract:
  `AgentActionRequest` (principal, `ActionId`, params, the permission decision
  main already resolved, interlock flag, batch id) travels main → renderer over
  `AGENT_ACTION_EVENTS.request`; exactly one `AgentActionResponse` returns over
  the `agentRespondAction` RPC. The response is the untrusted leg and is
  decoded with `decodeAgentActionResponse` before it settles anything.
- `packages/protocol/src/action-bindings.ts` is the execution map:
  `ACTION_RPC_BINDINGS` gives every `site: 'main'` action its RPC method and
  positional argument order, and `RendererActionParams` types every
  `site: 'renderer'` action's parameters. A compile-time assertion fails the
  build if an `ActionId` has neither.
- `app/main/agent/action-broker.ts` correlates requests with responses. Its
  promise always resolves with an `AgentActionResponse`: a missing window or an
  expired timeout resolves as `failed`, an abort as `cancelled`. An `ask`
  request has no timeout, because it is waiting on a person.
- `app/renderer/features/agent/use-agent-action-dispatcher.ts` is the gate.
  It processes requests strictly sequentially, resolves permission, flushes the
  active editor's staged edits before any write, executes, and answers. Main
  actions that return a `SnapshotPatch` are applied through
  `useCast().mutatePatch`, so an agent's change joins the same undo history as
  the user's own edits.
- **Show-safety interlock**: a `broadcast` action always prompts while an NDI
  output is enabled, regardless of the principal's matrix, and that prompt
  withholds "Always allow" — a standing grant is exactly what the interlock
  exists to prevent.
- **Result normalization**: a mutation answers with
  `{ ok: true, changed: { <table>: { upserted, deleted } } }`, never a raw
  patch. Agent-facing media references are asset ids, resolved to the
  snapshot's managed `src` on the way in.
- **Batching**: `beginHistoryBatch`/`endHistoryBatch` on the store collapse an
  agent turn's mutations into one `{ kind: 'snapshot' }` history entry, so a
  twenty-action turn costs the user one undo rather than twenty.

## Consequences

- Every agent-originated effect is observable at one place, in one order, with
  one permission check. There is no second write path to audit.
- An agent cannot act while no window exists; the broker fails those requests
  with a clear message rather than silently queueing them.
- The dispatcher is a single-mount hook. Two instances would each answer every
  request and race their responses, so it is mounted once in `App.tsx`.
- `slide.render`, `slide.renderContactSheet`, `element.setRichText`,
  `element.group`, `element.ungroup`, `element.align`, and
  `element.distribute` — declared in the vocabulary ahead of their
  implementation, answering `failed: 'Not implemented'` in the interim — are
  now `site: 'renderer'` actions, executed against the canvas context and the
  `features/render` slide-image pipeline. `document.extractText` remains
  `site: 'main'`, bound to the `agentExtractDocumentText` RPC.
- `slide.selectRange` has no shared state to drive — slide range selection is
  component-local to each browser — and is refused rather than approximated.
