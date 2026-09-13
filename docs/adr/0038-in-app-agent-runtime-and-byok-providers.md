# ADR-0038: The In-App Agent Runtime Lives in Main, on the User's Own Key

## Status

Accepted

## Date

2026-09-13

## Context

ADR-0037 settled how an agent's *effects* happen: main asks, the renderer
executes. It left open where the agent itself runs — the loop that calls a
model, reads its tool calls, and decides what to do with the results.

Three things push that loop into the main process:

- **Credentials.** LumaCast is bring-your-own-key. A provider API key is
  stored in the OS keychain via `safeStorage` and must never be readable from
  the renderer, which loads application UI and, through media, user content.
  A renderer-side loop would need the key in the renderer.
- **Filesystem reads.** `media.import`, `media.replaceSource` and
  `document.extractText` take a path nobody just picked in a dialog. Deciding
  whether that path may be read is a trust decision, and the renderer is the
  untrusted side of the IPC boundary.
- **Lifetime.** A run outlives a component, a panel, and a route change. The
  renderer is free to unmount the chat panel mid-run.

The MCP host (landing separately) needs the same permission resolution, the
same action vocabulary, and the same broker, from a process with no window at
all — which is another reason not to make any of it renderer-shaped.

## Decision

- **`app/main/agent/agent-runtime.ts` owns one run per thread.**
  `sendMessage` returns a `runId` immediately and streams `AgentThreadEvent`s
  over `AGENT_EVENTS.threadEvent`; a second `sendMessage` for a running thread
  rejects. Provider misconfiguration (`not-configured`, `no-credential`,
  `agent-disabled`) is reported as a `run_error` event on the thread rather
  than a rejected call, because it is the run's failure and the user is
  looking at the thread.
- **Tools come from the action registry, not a hand-written list.**
  `buildActionToolDefinitions` turns every `ActionId` into a tool whose
  JSON Schema is the same declaration `decodeActionParams` validates against.
  A new action is offered to the model the moment it exists.
  `project.getSnapshot`, the four `logs.*` actions, and both `clipboard.*`
  actions are withheld: the first would exhaust the context window, and the
  rest read data the user did not put in the conversation.
- **One undo batch per assistant turn.** A turn's tool calls run sequentially
  inside `broker.beginBatch`/`endBatch`, so a twenty-action turn costs the
  user one Cmd-Z — and a model's next call sees the previous call's result,
  which parallel execution would not guarantee.
- **Invalid input never reaches the renderer.** An unknown tool name, params
  that fail `decodeActionParams`, or a `deny` decision are answered as tool
  errors inside main. The user is only ever prompted about an action that is
  well-formed and permitted in principle.
- **`app/main/agent/permission-policy.ts` resolves the decision.**
  `auto` when the matrix says so or a session grant exists, `deny` when the
  matrix says so (a session grant can never override it), `ask` otherwise.
  Grants recorded from an "Always allow" answer are in-memory only: a
  permission change that survives a restart belongs in settings, where it is
  visible and revocable.
- **Filesystem actions are authorized in main.** `media.import`,
  `media.replaceSource` and `document.extractText` bind to dedicated
  `agentImportMedia`/`agentReplaceMediaSource`/`agentExtractDocumentText`
  RPCs that take a raw path. `PathAuthorizer` checks it against the user's
  granted roots, and the handler then uses the returned realpath — never the
  string the caller sent. The renderer no longer mints a `cast-media:`
  capability for these, because it has no user gesture to base one on.
- **Tool results are capped at 100 KB** for the model. The stored message part
  keeps the full value.
- **MCP client records are config, not transport.** Creating a client mints a
  32-byte token, stores only its SHA-256 (`AgentMcpClient.tokenHash`), and
  returns the token once with a paste-ready `mcp-remote` snippet.
  `AgentMcpServiceLike` covers only the transport, defaulting to
  `NoopMcpService` until the host lands.
- **OpenCode Zen is a first-class mixed-protocol provider.** Its default base
  URL is `https://opencode.ai/zen/v1`; the adapter intersects the live Zen
  `/models` catalog with public Models.dev metadata for display names,
  capabilities, limits, free status, and protocol selection. GPT/Grok/Muse
  requests use OpenAI Responses, Claude/Qwen use Anthropic Messages, Gemini
  uses `streamGenerateContent`, and remaining models use Chat Completions.
  Family fallbacks preserve routing when optional metadata is unavailable.
  Models.dev never receives the user's Zen credential.

## Consequences

- The renderer never holds a provider key and never opens a provider
  connection. A compromised renderer can spend the user's key only through the
  `agent:*` RPCs, under the permission matrix.
- A run survives the chat panel unmounting, and reconnecting is a matter of
  reading the persisted thread.
- Agent-originated filesystem reads are refused by default: with no granted
  root, all three actions fail regardless of the permission matrix.
- `MAX_ITERATIONS = 25` bounds a looping model. A run that hits it finishes as
  `max_iterations` with everything it did already persisted, rather than being
  discarded.
- Session grants die on relaunch, so a user who over-granted mid-task gets back
  to their configured matrix by restarting.
- A provider that reports no usage leaves `usage` null rather than guessing;
  token accounting is per-message and only as good as the provider's own
  reporting.
- Zen's catalog remains live even if Models.dev is unavailable; in that case
  the UI derives readable names from model IDs and omits unknown limits.
