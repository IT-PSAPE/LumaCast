import type { AgentConfig, AgentMcpStatus } from '@lumacast/protocol';

/**
 * The MCP host as the IPC layer sees it.
 *
 * Only the *transport* lives behind this interface: binding a loopback port,
 * accepting `mcp-remote` connections, authenticating bearer tokens. Client
 * records (create, revoke, re-permission) are config, not transport, and are
 * handled in `app/main/ipc.ts` against `AgentConfigStore` — so a user can add
 * and remove clients with the server switched off, and turning the server on
 * never has to reconcile two sources of truth.
 *
 * `NoopMcpService` below is the default binding, so every `agent:*Mcp*` RPC
 * answers correctly before the host itself exists (it lands separately).
 * `setAgentMcpService` in `app/main/ipc.ts` swaps in the real one.
 */
export interface AgentMcpServiceLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): AgentMcpStatus;
  /** Subscribes to status changes; returns an unsubscribe function. */
  onStatus(callback: (status: AgentMcpStatus) => void): () => void;
  /**
   * Tells a running host about a client roster change (create/revoke/
   * re-permission) without restarting it. Optional — and a safe no-op when
   * absent or when the host isn't running — because `NoopMcpService` has no
   * transport to refresh.
   */
  refreshClients?(): void;
}

/**
 * Stands in for the real host. It reports the configured `enabled` flag
 * truthfully and `running: false` always — the user's preference is stored
 * even though nothing serves it yet, which is what makes the settings UI
 * honest rather than fictional.
 */
export class NoopMcpService implements AgentMcpServiceLike {
  constructor(private readonly loadConfig: () => AgentConfig) {}

  async start(): Promise<void> {
    // No transport to start yet.
  }

  async stop(): Promise<void> {
    // No transport to stop yet.
  }

  status(): AgentMcpStatus {
    const config = this.loadConfig();
    return {
      enabled: config.mcp.enabled,
      running: false,
      port: null,
      endpoint: null,
      clients: config.mcp.clients,
      lastError: null,
    };
  }

  onStatus(): () => void {
    // Nothing ever changes asynchronously without an RPC that already returns
    // the fresh status, so there is nothing to notify.
    return () => {};
  }
}
