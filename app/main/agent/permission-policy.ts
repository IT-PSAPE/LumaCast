import crypto from 'node:crypto';
import type {
  AgentConfig,
  AgentMcpClient,
  AgentPermissionDecision,
  AgentPrincipal,
  AgentPrincipalPermissions,
} from '@lumacast/protocol';
import type { ActionRiskClass } from '@lumacast/commands';

/**
 * Resolves *whether* an agent principal may run an action, ahead of the
 * renderer being asked to run it.
 *
 * The split with `use-agent-action-dispatcher.ts` is deliberate (ADR-0037):
 * main decides `auto`/`ask`/`deny` from the stored matrix plus this session's
 * grants and never sends a `deny` across the boundary at all; the renderer
 * owns the prompt, the show-safety interlock, and execution.
 */

/**
 * Identifies one principal for grant bookkeeping: `'in-app'` for the
 * assistant panel, `'mcp:<clientId>'` for an external client. Deliberately
 * *not* per-thread — a user who answers "always allow" in one chat does not
 * expect to be asked again in the next one, and the config's `inApp`
 * permissions are themselves a single, app-wide setting.
 */
export type PrincipalKey = string;

export function principalKey(principal: AgentPrincipal): PrincipalKey {
  return principal.kind === 'in-app' ? 'in-app' : `mcp:${principal.clientId}`;
}

/**
 * "Always allow" answers, held in memory for the life of the process.
 *
 * Not persisted on purpose: a standing grant that survives a restart is a
 * permission change, and permission changes belong in the settings UI where
 * the user can see and revoke them — not in a prompt answered mid-task. A
 * relaunch is therefore the guaranteed way back to the configured matrix.
 */
export class SessionGrants {
  private readonly granted = new Map<PrincipalKey, Set<ActionRiskClass>>();

  grant(key: PrincipalKey, risk: ActionRiskClass): void {
    const existing = this.granted.get(key);
    if (existing) {
      existing.add(risk);
      return;
    }
    this.granted.set(key, new Set([risk]));
  }

  has(key: PrincipalKey, risk: ActionRiskClass): boolean {
    return this.granted.get(key)?.has(risk) ?? false;
  }

  /** Clears one principal's grants, or every principal's when `key` is omitted. */
  clear(key?: PrincipalKey): void {
    if (key === undefined) {
      this.granted.clear();
      return;
    }
    this.granted.delete(key);
  }
}

/**
 * The permission settings that apply to one principal. `null` means the
 * principal is unknown — an MCP client id that is not (or is no longer) in
 * the config — and the caller must refuse rather than fall back to any
 * default.
 */
export function resolvePrincipalPermissions(
  config: AgentConfig,
  principal: AgentPrincipal,
): AgentPrincipalPermissions | null {
  if (principal.kind === 'in-app') return config.inApp;
  const client = config.mcp.clients.find((candidate) => candidate.id === principal.clientId);
  return client ? client.permissions : null;
}

export interface ActionDecision {
  decision: AgentPermissionDecision;
  /** Passed to the renderer so the show-safety interlock can apply even to an `auto` action. */
  interlockEnabled: boolean;
}

/**
 * Combines the stored matrix with this session's grants:
 *
 * - `deny` in the matrix is absolute — a session grant can never override it,
 *   because the only way to record one is to have been asked, and a denied
 *   class is never asked about.
 * - `auto` in the matrix, or any session grant for the class, runs silently.
 * - anything else prompts.
 */
export function decideAction(
  permissions: AgentPrincipalPermissions,
  grants: SessionGrants,
  key: PrincipalKey,
  risk: ActionRiskClass,
): ActionDecision {
  const interlockEnabled = permissions.showSafetyInterlock;
  const configured = permissions.matrix[risk];
  if (configured === 'deny') return { decision: 'deny', interlockEnabled };
  if (configured === 'auto' || grants.has(key, risk)) return { decision: 'auto', interlockEnabled };
  return { decision: 'ask', interlockEnabled };
}

// ---------------------------------------------------------------------------
// MCP bearer tokens
// ---------------------------------------------------------------------------

/** SHA-256, lowercase hex — the exact form stored in `AgentMcpClient.tokenHash`. */
export function hashMcpToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8');
  const right = Buffer.from(b, 'utf-8');
  // `timingSafeEqual` throws on a length mismatch, which would itself leak
  // length through an exception; a stored hash is always 64 hex characters,
  // so a differing length is simply not a match.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Finds the MCP client a bearer token authenticates as, or `null`.
 *
 * Every client is compared even after a match is found: returning early would
 * make the response time depend on the matching client's position in the
 * list, which is a (small, but free to avoid) oracle over the client set.
 */
export function verifyMcpToken(config: AgentConfig, token: string): AgentMcpClient | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const candidateHash = hashMcpToken(token);
  let matched: AgentMcpClient | null = null;
  for (const client of config.mcp.clients) {
    if (hashesMatch(client.tokenHash, candidateHash)) matched = client;
  }
  return matched;
}
