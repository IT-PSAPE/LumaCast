# ADR-0039: The MCP Server Is a Loopback Utility-Process Protocol Translator

## Status

Accepted

## Date

2026-09-13

## Context

ADR-0038 named the MCP host as a second caller into the same agent action
pipeline the in-app assistant uses, but deferred where and how it actually
speaks the Model Context Protocol to an external client (Claude Desktop, an
IDE, `mcp-remote`). Three things shape that answer:

- **The transport does not belong in the main event loop.** MCP over
  Streamable HTTP means an `http.Server`, per-session state, and SSE streams
  living somewhere. Main already offloads exactly this kind of standing
  I/O — SQLite (ADR-0014) and the NDI sender — into a dedicated utility
  process rather than running it inline.
- **An external client is a different trust level than the in-app
  assistant.** The in-app agent runs on credentials only this app holds and
  is reachable only through Electron IPC. The MCP host binds a TCP port:
  anything on the machine (and, absent DNS-rebinding protection, a malicious
  web page) can reach it unless the transport itself refuses.
- **Nothing about executing an action should fork.** ADR-0037/0038 already
  built one path from a resolved `(principal, actionId, params)` to a
  renderer-executed result, with permission resolution, batching, and undo
  semantics settled. A second implementation of that path for MCP would be a
  second thing to keep correct.

## Decision

- **A third utility process, `app/main/mcp/mcp-host.ts`**, bundled to
  `out/main/mcp-host.js` by `electron.vite.config.ts`'s existing
  utility-host plugin (alongside `ndi-host.js`/`persistence-host.js`), runs an
  `http.Server` bound to **127.0.0.1 only** and speaks MCP Streamable HTTP at
  `POST`/`GET`/`DELETE /mcp`, using the SDK's low-level `Server` (raw JSON
  Schema tool definitions, not `McpServer.registerTool`, which would require
  authoring the vocabulary a second time in zod) and
  `StreamableHTTPServerTransport` in stateful mode (one SDK `Server` +
  transport pair per `Mcp-Session-Id`).
- **The host is a protocol translator only.** It never touches the
  repository, the filesystem, or the agent config file. Every `tools/call`
  and `resources/read` becomes a `call` message forwarded to main over the
  same `process.parentPort` command/event channel `persistence-host.ts` and
  `ndi-host.ts` already use, and is answered by exactly one `call-result`.
  `McpService` (`app/main/mcp/mcp-service-proxy.ts`) is the only thing on the
  main side that resolves a call: it decodes params
  (`decodeActionParams`), resolves the calling client's permissions
  (`resolvePrincipalPermissions`/`decideAction`, the same functions the
  in-app runtime uses), and — for anything not denied — calls the **same**
  `AgentActionBroker` the in-app assistant dispatches through. There is no
  second execution path.
- **Security happens entirely in the host, before anything reaches the SDK
  transport**, in this order: (1) an `Origin` header, if present, must name
  this exact loopback host and bound port, or the request is refused with
  403 (DNS-rebinding protection is a spec MUST; absent Origin is allowed,
  since most non-browser MCP clients send none); (2) any path other than
  `/mcp` is 404; (3) a `Bearer` token is required, hashed with the same
  sha256-hex algorithm `hashMcpToken` uses and compared in constant time
  against every configured client's `tokenHash` — an unknown or missing
  token is 401 with `WWW-Authenticate: Bearer`. The host re-implements this
  hashing/verification rather than importing
  `app/main/agent/permission-policy.ts`, the same "two copies that must move
  in step" precedent `resolveLocalMediaSourcePath` set across the
  persistence utility-process boundary (docs/ARCHITECTURE.md, Managed Media
  Capabilities) — the host is bundled standalone and stays decoupled from
  the rest of `app/main/agent`. Tokens are never logged.
- **One undo batch per call.** Each forwarded `call` runs inside its own
  `broker.beginBatch`/`endBatch` pair, so one MCP tool invocation costs the
  user exactly one undo entry — the same contract ADR-0038 gives one
  assistant turn, applied at the grain of one call instead of one turn,
  since an MCP client has no equivalent "turn" boundary to batch around.
- **A call requires an open window.** `McpService` checks `getWindow()`
  before dispatching to the broker (which would itself refuse a missing
  window, but with a generic message); MCP gets its own clear denial instead
  of a broker timeout. This is not new policy — ADR-0037 already made every
  agent-originated effect depend on a live renderer to execute it — just
  applied before the round trip rather than after.
- **Fail-stop, no auto-restart.** An unexpected host exit is reported through
  `status()` (`running: false`, a `lastError`) and never retried
  automatically, matching ADR-0014's persistence/NDI hosts: restarting a
  process whose in-flight state is unknown is worse than requiring an
  explicit `start()` (from settings, or the next app launch when
  `mcp.enabled`).
- **Config, not transport, is authoritative for clients.** Creating,
  revoking, or re-permissioning an MCP client (`app/main/ipc.ts`) writes
  `AgentConfigStore` and calls `McpService.refreshClients()`, which posts an
  `update-clients` command so a running host's bearer check reflects the
  change immediately, without a restart.
- **The configured port defaults to a fixed value (`43117`), not always
  ephemeral.** `AgentConfig.mcp.port: number | null` — `null` means
  ephemeral. A fixed default means the one-time `mcp-remote` config snippet
  a user pastes into another tool keeps working across app restarts; the
  host still falls back to an OS-assigned port itself if the configured one
  is already taken, and reports the real port back through `ready`.
- **Resources are read-only projections, forwarded opaquely.** The host
  advertises only the enumerable resources main gives it
  (`lumacast://project/overview`, `lumacast://playlists`) through
  `resources/list`; parameterized shapes
  (`lumacast://playlist/{id}`, `lumacast://item/{type}/{id}`,
  `lumacast://slide/{id}[/image]`) are readable but not listed — the host
  forwards any `resources/read` URI verbatim, and `McpService` alone decides
  whether it maps to a real action, keeping URI-to-action knowledge in one
  place. A `slide.../image` read (like the `slide.render`/
  `slide.renderContactSheet` tool results) maps a returned `dataUrl` to MCP
  image content (blob-encoded for a resource, inline `ImageContent` for a
  tool result).

## Consequences

- The MCP host can be killed, crash, or never start without taking any other
  utility process or the renderer down with it — it holds no state anything
  else depends on.
- An external client's blast radius is identical to the in-app assistant's:
  the same permission matrix, the same show-safety interlock, the same undo
  history. Auditing "what could an agent have done" means auditing one
  broker, not two.
- A stolen bearer token is a real credential (constant-time compare
  notwithstanding) — revocation is immediate only because `refreshClients()`
  pushes the change to a running host; a host that is not running has
  nothing to push to, but also nothing listening for the old token either.
- Tokens are never persisted in cleartext (only their hash), so a copied
  `agent-config.json` yields no usable credential — the same guarantee
  ADR-0038 already gave the in-app runtime's provider keys via `safeStorage`.
- Binding to 127.0.0.1 means an MCP client must run on the same machine (or
  reach it through the user's own SSH tunnel / port-forward); there is no
  remote-access story here, deliberately.
