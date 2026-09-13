import type { ActionToolDefinition } from '@lumacast/protocol';

/**
 * The typed, structured-clone-safe wire contract between `mcp-host.ts` (the
 * utility process that speaks MCP Streamable HTTP) and `McpService` in main
 * (`mcp-service-proxy.ts`), mirroring the same `process.parentPort` /
 * `utilityProcess` command-and-event shape `persistence-host.ts`/`ndi-host.ts`
 * already use.
 *
 * The host is a protocol translator only: it never touches the repository,
 * files, or config. Every tool call and resource read a connected MCP client
 * makes crosses back to main as a `call` event and is answered by exactly one
 * `call-result` command carrying the same `requestId`.
 */

/** One MCP client record the host needs to authenticate and identify a caller. Never carries the raw bearer token — only its hash. */
export interface McpHostClient {
  id: string;
  name: string;
  tokenHash: string;
}

/** A resource the host can list in `resources/list`. Parameterized resources (e.g. `lumacast://playlist/{id}`) are readable but deliberately not listed here — see `mcp-host.ts`. */
export interface McpResourceSpec {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** One piece of content in a tool result or resource read, before the host maps it into the MCP-shaped `TextContent`/`ImageContent`/`*ResourceContents`. */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string /* base64 */; mimeType: string };

/** What `McpService.handleCall` answers with; `error` is shown to the model/client verbatim, never a raw exception. */
export type McpCallResult = { ok: true; content: McpContent[] } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Main -> host
// ---------------------------------------------------------------------------

export type McpHostCommand =
  | { type: 'start'; port: number | null; clients: McpHostClient[]; tools: ActionToolDefinition[]; resources: McpResourceSpec[] }
  | { type: 'update-clients'; clients: McpHostClient[] }
  | { type: 'stop' }
  | { type: 'call-result'; requestId: string; result: McpCallResult };

// ---------------------------------------------------------------------------
// Host -> main
// ---------------------------------------------------------------------------

export type McpHostEvent =
  | { type: 'ready'; port: number }
  | { type: 'error'; message: string }
  | { type: 'client-seen'; clientId: string }
  | { type: 'call'; requestId: string; clientId: string; kind: 'tool' | 'resource'; actionId?: string; params?: unknown; uri?: string }
  | { type: 'stopped' };
