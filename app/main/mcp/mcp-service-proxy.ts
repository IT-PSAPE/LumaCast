import { utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron';
import { nowIso } from '@lumacast/kernel';
import {
  buildActionToolDefinitions,
  actionIdFromToolName,
  decodeActionParams,
  CodecError,
  type AgentActionResponse,
  type AgentMcpStatus,
  type AgentPrincipal,
  type AgentMcpClient,
} from '@lumacast/protocol';
import { ACTION_METADATA, type ActionId, type ActionRiskClass } from '@lumacast/commands';
import type { AgentActionBroker } from '../agent/action-broker';
import type { AgentConfigStore } from '../agent/agent-config-store';
import { EXCLUDED_ACTION_IDS, serialiseToolResult } from '../agent/agent-runtime';
import { SessionGrants, decideAction, principalKey, resolvePrincipalPermissions } from '../agent/permission-policy';
import type { AgentMcpServiceLike } from './mcp-service';
import type { McpCallResult, McpHostClient, McpHostCommand, McpHostEvent, McpResourceSpec } from './mcp-host-protocol';

/**
 * The main-process half of the MCP transport (ADR-0039): forks `mcp-host.js`
 * (bundled by `electron.vite.config.ts`'s utility-host plugin), keeps it fed
 * with the current tool/client roster, and answers every `call` event the
 * host forwards by running the *same* permission resolution and
 * `AgentActionBroker` dispatch the in-app assistant uses (ADR-0037/0038) —
 * there is no second execution path to keep in sync.
 *
 * Lifecycle mirrors the persistence/NDI utility-process hosts: fail-stop, no
 * auto-restart on an unexpected exit (ADR-0014). `start()`/`stop()` resolve
 * once the fork (or its teardown) is under way; they do not wait for the
 * host's own `ready`/`stopped` round trip to update `status()`, matching how
 * the NDI proxy's construction does not block on its own `ready` event.
 */

const DEFAULT_STOP_TIMEOUT_MS = 2_000;

/** Resources listable via `resources/list`. Parameterized ones (playlist/{id}, item/{type}/{id}, slide/{id}[/image]) are read-only capabilities documented in the ADR, not enumerable — the host forwards any `resources/read` uri and main decides whether it maps to something real. */
const MCP_STATIC_RESOURCES: McpResourceSpec[] = [
  {
    uri: 'lumacast://project/overview',
    name: 'Project overview',
    description: 'Playlist/item counts and other project-level summary stats.',
    mimeType: 'application/json',
  },
  {
    uri: 'lumacast://playlists',
    name: 'Playlists',
    description: 'Every playlist in the project.',
    mimeType: 'application/json',
  },
];

export type McpServiceConfigStore = Pick<AgentConfigStore, 'load' | 'update'>;
export type McpServiceBroker = Pick<AgentActionBroker, 'request' | 'beginBatch' | 'endBatch'>;
export type McpHostFork = (
  modulePath: string,
  args: string[],
  options: { serviceName: string; stdio: 'pipe' },
) => UtilityProcess;

export interface McpServiceDeps {
  configStore: McpServiceConfigStore;
  broker: McpServiceBroker;
  grants: SessionGrants;
  getWindow: () => BrowserWindow | null;
  /** Absolute path to the bundled `mcp-host.js`. */
  hostModulePath: string;
  /** Injectable `utilityProcess.fork` for tests; defaults to the real thing. */
  fork?: McpHostFork;
}

function toHostClients(clients: readonly AgentMcpClient[]): McpHostClient[] {
  return clients.map((client) => ({ id: client.id, name: client.name, tokenHash: client.tokenHash }));
}

/** `{mimeType, data}` extracted from a `data:<mime>;base64,<payload>` URL, or `null` when it doesn't parse. */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function extractDataUrl(result: unknown): string | null {
  if (result && typeof result === 'object' && 'dataUrl' in result) {
    const value = (result as { dataUrl?: unknown }).dataUrl;
    if (typeof value === 'string') return value;
  }
  return null;
}

/** Successful action results carrying a `dataUrl` (`slide.render`/`slide.renderContactSheet`) become image content; everything else is JSON text, capped the same way tool results are for the in-app assistant. */
function mapSuccessResult(result: unknown): McpCallResult {
  const dataUrl = extractDataUrl(result);
  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (parsed) return { ok: true, content: [{ type: 'image', data: parsed.data, mimeType: parsed.mimeType }] };
  }
  return { ok: true, content: [{ type: 'text', text: serialiseToolResult(result) }] };
}

/** Maps a `lumacast://` resource URI to the action + params that read it, or `null` for an unrecognized shape. */
function mapResourceUri(uri: string): { actionId: ActionId; params: unknown } | null {
  if (uri === 'lumacast://project/overview') return { actionId: 'project.getOverview' as ActionId, params: {} };
  if (uri === 'lumacast://playlists') return { actionId: 'playlist.list' as ActionId, params: {} };

  let match = /^lumacast:\/\/playlist\/([^/]+)$/.exec(uri);
  if (match) return { actionId: 'playlist.get' as ActionId, params: { id: match[1] } };

  match = /^lumacast:\/\/item\/(presentation|lyric)\/([^/]+)$/.exec(uri);
  if (match) {
    return {
      actionId: 'item.get' as ActionId,
      params: { ref: { type: match[1], id: match[2] }, includeSlides: true },
    };
  }

  // Checked before the bare slide pattern below, since both match a `/slide/<id>` prefix.
  match = /^lumacast:\/\/slide\/([^/]+)\/image$/.exec(uri);
  if (match) return { actionId: 'slide.render' as ActionId, params: { slideId: match[1] } };

  match = /^lumacast:\/\/slide\/([^/]+)$/.exec(uri);
  if (match) return { actionId: 'slide.get' as ActionId, params: { slideId: match[1], includeElements: true } };

  return null;
}

export class McpService implements AgentMcpServiceLike {
  private readonly configStore: McpServiceConfigStore;
  private readonly broker: McpServiceBroker;
  private readonly grants: SessionGrants;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly hostModulePath: string;
  private readonly fork: McpHostFork;

  private host: UtilityProcess | null = null;
  private running = false;
  private port: number | null = null;
  private endpoint: string | null = null;
  private lastError: string | null = null;
  private stopping = false;
  private pendingStopResolve: (() => void) | null = null;
  private readonly statusListeners = new Set<(status: AgentMcpStatus) => void>();

  constructor(deps: McpServiceDeps) {
    this.configStore = deps.configStore;
    this.broker = deps.broker;
    this.grants = deps.grants;
    this.getWindow = deps.getWindow;
    this.hostModulePath = deps.hostModulePath;
    this.fork = deps.fork ?? ((modulePath, args, options) => utilityProcess.fork(modulePath, args, options));
  }

  async start(): Promise<void> {
    if (this.host) return; // already forked (or forking)

    let host: UtilityProcess;
    try {
      host = this.fork(this.hostModulePath, [], { serviceName: 'mcp-host', stdio: 'pipe' });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitStatus();
      return;
    }
    this.host = host;
    this.lastError = null;

    host.stdout?.on('data', (chunk: Buffer | string) => {
      console.log(`[mcp-host] ${String(chunk)}`);
    });
    host.stderr?.on('data', (chunk: Buffer | string) => {
      console.error(`[mcp-host] ${String(chunk)}`);
    });
    host.on('message', (event: McpHostEvent) => this.handleHostEvent(event));
    host.on('exit', (code) => this.handleExit(code));

    const config = this.configStore.load();
    this.postToHost({
      type: 'start',
      port: config.mcp.port,
      clients: toHostClients(config.mcp.clients),
      tools: buildActionToolDefinitions((id) => !EXCLUDED_ACTION_IDS.has(id)),
      resources: MCP_STATIC_RESOURCES,
    });
  }

  async stop(): Promise<void> {
    const host = this.host;
    if (!host) {
      this.running = false;
      this.port = null;
      this.endpoint = null;
      this.emitStatus();
      return;
    }

    this.stopping = true;
    this.postToHost({ type: 'stop' });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingStopResolve = null;
        resolve();
      }, DEFAULT_STOP_TIMEOUT_MS);
      this.pendingStopResolve = () => {
        clearTimeout(timer);
        this.pendingStopResolve = null;
        resolve();
      };
    });

    try {
      host.kill();
    } catch {
      // Already gone.
    }
    this.host = null;
    this.stopping = false;
    this.running = false;
    this.port = null;
    this.endpoint = null;
    this.emitStatus();
  }

  status(): AgentMcpStatus {
    const config = this.configStore.load();
    return {
      enabled: config.mcp.enabled,
      running: this.running,
      port: this.port,
      endpoint: this.endpoint,
      clients: config.mcp.clients,
      lastError: this.lastError,
    };
  }

  onStatus(callback: (status: AgentMcpStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /** Call after a client is created, revoked, or re-permissioned so a running host's bearer check reflects the change immediately. No-op when the host is not forked. */
  refreshClients(): void {
    if (!this.host) return;
    const config = this.configStore.load();
    this.postToHost({ type: 'update-clients', clients: toHostClients(config.mcp.clients) });
  }

  private postToHost(command: McpHostCommand): void {
    try {
      this.host?.postMessage(command);
    } catch (error) {
      console.error('[McpService] Failed to post to host:', error);
    }
  }

  private emitStatus(): void {
    const status = this.status();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.warn('[McpService] Status listener threw:', error);
      }
    }
  }

  private handleHostEvent(event: McpHostEvent): void {
    switch (event.type) {
      case 'ready':
        this.running = true;
        this.port = event.port;
        this.endpoint = `http://127.0.0.1:${event.port}/mcp`;
        this.lastError = null;
        this.emitStatus();
        break;
      case 'error':
        this.lastError = event.message;
        this.emitStatus();
        break;
      case 'client-seen':
        this.recordClientSeen(event.clientId);
        break;
      case 'call':
        void this.handleCall(event);
        break;
      case 'stopped':
        this.pendingStopResolve?.();
        break;
    }
  }

  private handleExit(code: number | null): void {
    const wasStopping = this.stopping;
    this.host = null;
    this.running = false;
    this.port = null;
    this.endpoint = null;
    if (wasStopping) {
      this.stopping = false;
      this.pendingStopResolve?.();
      this.emitStatus();
      return;
    }
    // Fail-stop (ADR-0014 style): never auto-restarted. The user (or startup,
    // if `mcp.enabled`) triggers a fresh `start()`.
    this.lastError = `The MCP server stopped unexpectedly (exit code ${String(code)}).`;
    this.emitStatus();
  }

  private recordClientSeen(clientId: string): void {
    const config = this.configStore.load();
    if (!config.mcp.clients.some((client) => client.id === clientId)) return;
    const lastSeenAt = nowIso();
    this.configStore.update({
      mcp: {
        clients: config.mcp.clients.map((client) => (client.id === clientId ? { ...client, lastSeenAt } : client)),
      },
    });
  }

  private async handleCall(event: Extract<McpHostEvent, { type: 'call' }>): Promise<void> {
    const result = await this.executeCall(event);
    this.postToHost({ type: 'call-result', requestId: event.requestId, result });
  }

  private async executeCall(event: Extract<McpHostEvent, { type: 'call' }>): Promise<McpCallResult> {
    const config = this.configStore.load();
    const client = config.mcp.clients.find((candidate) => candidate.id === event.clientId);
    if (!client) return { ok: false, error: 'Unknown MCP client' };

    const principal: AgentPrincipal = { kind: 'mcp', clientId: client.id, clientName: client.name };

    let actionId: ActionId;
    let rawParams: unknown;
    if (event.kind === 'tool') {
      const resolved = actionIdFromToolName(event.actionId ?? '');
      if (!resolved) return { ok: false, error: `Unknown tool: ${event.actionId ?? ''}` };
      actionId = resolved;
      rawParams = event.params;
    } else {
      const mapped = mapResourceUri(event.uri ?? '');
      if (!mapped) return { ok: false, error: `Unknown resource: ${event.uri ?? ''}` };
      actionId = mapped.actionId;
      rawParams = mapped.params;
    }

    let params: unknown;
    try {
      params = decodeActionParams(actionId, rawParams, { boundary: 'mcp-tool', operation: actionId, path: '' });
    } catch (error) {
      const message = error instanceof CodecError || error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }

    const permissions = resolvePrincipalPermissions(config, principal);
    if (!permissions) return { ok: false, error: 'Unknown MCP client' };

    const key = principalKey(principal);
    const risk: ActionRiskClass = ACTION_METADATA[actionId].risk;
    const { decision, interlockEnabled } = decideAction(permissions, this.grants, key, risk);
    if (decision === 'deny') return { ok: false, error: 'Denied by permission settings' };

    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return { ok: false, error: 'LumaCast has no open window right now.' };
    }

    const batchId = this.broker.beginBatch(principal);
    let response: AgentActionResponse;
    try {
      response = await this.broker.request({ principal, actionId, params, decision, interlockEnabled, batchId });
    } finally {
      this.broker.endBatch(batchId, principal);
    }

    if ((response.outcome === 'succeeded' || response.outcome === 'failed') && response.alwaysAllow) {
      this.grants.grant(key, response.alwaysAllow);
    }
    if (response.outcome === 'succeeded') return mapSuccessResult(response.result);
    if (response.outcome === 'failed') return { ok: false, error: response.error };
    if (response.outcome === 'denied') return { ok: false, error: `Denied by the user (${response.reason})` };
    return { ok: false, error: 'Cancelled' };
  }
}
