import crypto from 'node:crypto';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ImageContent,
  type ReadResourceResult,
  type TextContent,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpCallResult,
  McpContent,
  McpHostClient,
  McpHostCommand,
  McpHostEvent,
  McpResourceSpec,
} from './mcp-host-protocol';
import type { ActionToolDefinition } from '@lumacast/protocol';

/**
 * The MCP host (ADR-0039): a utility process, forked by `McpService`
 * (`app/main/mcp/mcp-service-proxy.ts`), that speaks MCP Streamable HTTP on a
 * loopback-only `http.Server` at `/mcp`. It is a protocol translator only —
 * it never touches the repository, the filesystem, or the agent config file.
 * Every tool call and resource read a connected client makes is forwarded to
 * main as a `call` event over `process.parentPort` (mirroring
 * `persistence-host.ts`/`ndi-host.ts`) and answered by exactly one
 * `call-result` command.
 *
 * Security happens entirely in `handleRequest`, before anything reaches the
 * SDK transport: Origin check (DNS rebinding), then path, then bearer auth.
 */

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('mcp-host must run as an Electron utility process (process.parentPort is null)');
}

const HOST_NAME = 'lumacast';
const HOST_VERSION = '1.0.0';
const CLIENT_SEEN_THROTTLE_MS = 60_000;

interface SessionEntry {
  server: Server;
  transport: StreamableHTTPServerTransport;
  clientId: string;
  clientName: string;
}

let httpServer: http.Server | null = null;
let boundPort = 0;
let currentClients: McpHostClient[] = [];
let currentTools: ActionToolDefinition[] = [];
let currentResources: McpResourceSpec[] = [];
const sessions = new Map<string, SessionEntry>();
const pendingCalls = new Map<string, (result: McpCallResult) => void>();
const lastClientSeenAt = new Map<string, number>();

// ---------------------------------------------------------------------------
// Token verification — deliberately re-implemented rather than imported from
// `app/main/agent/permission-policy.ts` (same sha256-hex algorithm as
// `hashMcpToken`/`verifyMcpToken` there). The host is bundled standalone
// (`electron.vite.config.ts`) and stays decoupled from the rest of
// `app/main/agent`; the two copies must move in step, the same convention
// `resolveLocalMediaSourcePath` uses across the persistence utility-process
// boundary (see docs/ARCHITECTURE.md, Managed Media Capabilities).
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8');
  const right = Buffer.from(b, 'utf-8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Every client is compared even after a match, so response time does not leak which position matched. */
function verifyToken(token: string): McpHostClient | null {
  if (token.length === 0) return null;
  const candidate = hashToken(token);
  let matched: McpHostClient | null = null;
  for (const client of currentClients) {
    if (hashesMatch(client.tokenHash, candidate)) matched = client;
  }
  return matched;
}

function bearerTokenFromHeader(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

/** DNS-rebinding guard: an absent Origin is allowed (most non-browser MCP clients omit it); a present one must name this exact loopback host and port. */
function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false;
  const originPort = url.port ? Number(url.port) : 80;
  return originPort === boundPort;
}

function noteClientSeen(clientId: string): void {
  const last = lastClientSeenAt.get(clientId) ?? 0;
  const now = Date.now();
  if (now - last < CLIENT_SEEN_THROTTLE_MS) return;
  lastClientSeenAt.set(clientId, now);
  emit({ type: 'client-seen', clientId });
}

// ---------------------------------------------------------------------------
// Main <-> host call correlation
// ---------------------------------------------------------------------------

function sendCall(message: Extract<McpHostEvent, { type: 'call' }>): Promise<McpCallResult> {
  return new Promise<McpCallResult>((resolve) => {
    pendingCalls.set(message.requestId, resolve);
    emit(message);
  });
}

function callTool(clientId: string, actionId: string, params: unknown): Promise<McpCallResult> {
  return sendCall({ type: 'call', requestId: crypto.randomUUID(), clientId, kind: 'tool', actionId, params });
}

function readResource(clientId: string, uri: string): Promise<McpCallResult> {
  return sendCall({ type: 'call', requestId: crypto.randomUUID(), clientId, kind: 'resource', uri });
}

function toToolContent(content: McpContent): TextContent | ImageContent {
  return content.type === 'image'
    ? { type: 'image', data: content.data, mimeType: content.mimeType }
    : { type: 'text', text: content.text };
}

function toResourceContents(uri: string, content: McpContent[]): ReadResourceResult['contents'] {
  return content.map((piece) =>
    piece.type === 'image'
      ? { uri, mimeType: piece.mimeType, blob: piece.data }
      : { uri, mimeType: 'text/plain', text: piece.text },
  );
}

// ---------------------------------------------------------------------------
// Per-session MCP server
// ---------------------------------------------------------------------------

function createMcpServer(client: McpHostClient): Server {
  const server = new Server({ name: HOST_NAME, version: HOST_VERSION }, { capabilities: { tools: {}, resources: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: currentTools.map(
      (tool): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as unknown as Tool['inputSchema'],
      }),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await callTool(client.id, request.params.name, request.params.arguments ?? {});
    if (!result.ok) return { content: [{ type: 'text', text: result.error }], isError: true };
    return { content: result.content.map(toToolContent), isError: false };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: currentResources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    const uri = request.params.uri;
    const result = await readResource(client.id, uri);
    if (!result.ok) throw new Error(result.error);
    return { contents: toResourceContents(uri, result.content) };
  });

  return server;
}

// ---------------------------------------------------------------------------
// HTTP request handling
// ---------------------------------------------------------------------------

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && !isAllowedOrigin(origin)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
    return;
  }

  const token = bearerTokenFromHeader(req.headers.authorization);
  const client = verifyToken(token);
  if (!client) {
    res.writeHead(401, { 'content-type': 'text/plain', 'WWW-Authenticate': 'Bearer' }).end('Unauthorized');
    return;
  }
  noteClientSeen(client.id);

  const sessionHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    await existing.transport.handleRequest(req, res);
    if (req.method === 'DELETE') sessions.delete(sessionId!);
    return;
  }

  if (sessionId !== undefined || req.method !== 'POST') {
    // A known-shaped session id that names no live session, or a GET/DELETE
    // with none at all, has nothing to attach to.
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
    return;
  }

  // No session header on a POST: only valid as an `initialize` call, which
  // the transport itself enforces (a non-initialize request here gets its
  // own 400 from the transport).
  const server = createMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  await server.connect(transport);
  await transport.handleRequest(req, res);
  if (transport.sessionId) {
    sessions.set(transport.sessionId, { server, transport, clientId: client.id, clientName: client.name });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function emit(event: McpHostEvent): void {
  parentPort.postMessage(event);
}

function startServer(command: Extract<McpHostCommand, { type: 'start' }>): void {
  if (httpServer) return; // already started; a second 'start' is a no-op.
  currentClients = command.clients;
  currentTools = command.tools;
  currentResources = command.resources;

  const server = http.createServer((req, res) => {
    void handleMcpRequest(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
  });
  httpServer = server;

  const tryListen = (port: number): void => {
    const onListenError = (error: NodeJS.ErrnoException): void => {
      server.off('error', onListenError);
      if (error.code === 'EADDRINUSE' && port !== 0) {
        tryListen(0);
        return;
      }
      httpServer = null;
      emit({ type: 'error', message: error.message });
    };
    server.once('error', onListenError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onListenError);
      const address = server.address();
      boundPort = typeof address === 'object' && address !== null ? address.port : port;
      emit({ type: 'ready', port: boundPort });
    });
  };
  tryListen(command.port ?? 0);
}

async function stopServer(): Promise<void> {
  for (const session of sessions.values()) {
    try {
      await session.transport.close();
    } catch {
      // Best-effort: the peer may already be gone.
    }
  }
  sessions.clear();
  pendingCalls.clear();
  const server = httpServer;
  httpServer = null;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  emit({ type: 'stopped' });
}

parentPort.on('message', (event: { data: McpHostCommand }) => {
  const command = event.data;
  switch (command.type) {
    case 'start':
      startServer(command);
      break;
    case 'update-clients':
      currentClients = command.clients;
      break;
    case 'stop':
      void stopServer();
      break;
    case 'call-result': {
      const resolve = pendingCalls.get(command.requestId);
      if (!resolve) return;
      pendingCalls.delete(command.requestId);
      resolve(command.result);
      break;
    }
  }
});
