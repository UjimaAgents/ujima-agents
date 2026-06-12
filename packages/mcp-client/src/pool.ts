import type { MCPDef } from '@ujima/shared';
import {
  isConnectionClosedError,
  type ConnectOptions,
  type MCPConnection,
  type ToolCallContext,
  type ToolCallResult,
  type ToolInfo,
} from './connection';
import { connectMCPWithCacheRecovery } from './cache-recovery';

export interface PoolGetOptions {
  /**
   * Agent requesting this connection. When the MCP def has
   * `isolation: 'per-agent'`, each agent gets its own dedicated process.
   * Ignored for shared MCPs (the default).
   */
  agentId?: string;
  /**
   * Optional caller-local path scopes. Pooling ignores these because they
   * affect wrapper behavior, not which MCP process should be reused.
   */
  scopePaths?: string[];
  /**
   * Working directory the spawned MCP child process should run in.
   * Almost always the agent's org workspace_root — keeps filesystem
   * outputs (Playwright screenshots, etc.) inside the workspace
   * instead of leaking into the daemon's CWD. Two callers requesting
   * the same MCP with DIFFERENT cwds will get separate processes
   * (the cwd is part of the pool key).
   */
  cwd?: string;
}

export interface MCPPool {
  get(def: MCPDef, opts?: PoolGetOptions): Promise<MCPConnection>;
  has(mcpId: string, opts?: PoolGetOptions): boolean;
  size(): number;
  closeOne(mcpId: string, opts?: PoolGetOptions): Promise<void>;
  closeAll(): Promise<void>;
}

function poolKey(def: MCPDef, opts?: PoolGetOptions): string {
  const isolated = (def as { isolation?: string }).isolation === 'per-agent';
  // The cwd MUST be part of the key — two callers asking for the
  // same MCP from different workspace roots cannot share a process.
  // The child's CWD is fixed at spawn time and a Playwright running
  // for org A would write screenshots into org B's workspace if we
  // pooled them together.
  const cwdSuffix = opts?.cwd ? `::cwd::${opts.cwd}` : '';
  if (isolated && opts?.agentId) return `${def.id}::agent::${opts.agentId}${cwdSuffix}`;
  return `${def.id}${cwdSuffix}`;
}

export function createMCPPool(defaults: ConnectOptions = {}): MCPPool {
  const connections = new Map<string, MCPConnection>();
  const pending = new Map<string, Promise<MCPConnection>>();

  async function spawn(
    def: MCPDef,
    key: string,
    cwd: string | undefined,
  ): Promise<MCPConnection> {
    const connectOptions: ConnectOptions = cwd
      ? { ...defaults, cwd }
      : defaults;
    const p = connectMCPWithCacheRecovery(def, connectOptions).then(
      ({ connection: raw, recovery }) => {
        if (recovery) {
          // Single-line breadcrumb so operators can see why this MCP
          // is suddenly downloading every cold start. The Test path
          // surfaces this same condition to the UI as a chip.
          console.warn(
            `[mcp-pool] "${def.id}": retried with isolated npm cache (${recovery.cacheDir}) — host npm cache looks corrupted`,
          );
        }
        const wrapped = wrapWithReconnect(raw, () => {
          // On closed-connection fault, detach from cache so the next
          // call spawns a fresh process. Forward the same cwd so the
          // respawned child stays in the agent's workspace.
          if (connections.get(key) === wrapped) connections.delete(key);
          return spawn(def, key, cwd);
        });
        connections.set(key, wrapped);
        pending.delete(key);
        return wrapped;
      },
      (err: unknown) => {
        pending.delete(key);
        throw err;
      },
    );
    pending.set(key, p);
    return p;
  }

  return {
    async get(def, opts) {
      const key = poolKey(def, opts);
      const existing = connections.get(key);
      if (existing?.isOpen()) return existing;

      const inflight = pending.get(key);
      if (inflight) return inflight;

      return spawn(def, key, opts?.cwd);
    },

    has(mcpId, opts) {
      // Best-effort: callers without a def can only check the shared bucket.
      const key = opts?.agentId ? `${mcpId}::agent::${opts.agentId}` : mcpId;
      const c = connections.get(key);
      return !!c && c.isOpen();
    },

    size() {
      let n = 0;
      for (const c of connections.values()) if (c.isOpen()) n++;
      return n;
    },

    async closeOne(mcpId, opts) {
      const key = opts?.agentId ? `${mcpId}::agent::${opts.agentId}` : mcpId;
      const c = connections.get(key);
      if (c) {
        await c.close();
        connections.delete(key);
      }
    },

    async closeAll() {
      const all = [...connections.values()];
      connections.clear();
      await Promise.allSettled(all.map((c) => c.close()));
    },
  };
}

/**
 * Wraps a raw MCPConnection so that a closed-connection fault on callTool
 * transparently respawns the process and retries once. Second failure is
 * surfaced to the caller — we don't loop because a genuinely dead MCP
 * shouldn't wedge the agent.
 */
function wrapWithReconnect(
  initial: MCPConnection,
  respawn: () => Promise<MCPConnection>,
): MCPConnection {
  let current = initial;

  async function swap(): Promise<void> {
    try {
      await current.close();
    } catch {
      /* already gone */
    }
    current = await respawn();
  }

  const wrapped: MCPConnection = {
    id: initial.id,
    def: initial.def,
    async listTools(): Promise<ToolInfo[]> {
      try {
        return await current.listTools();
      } catch (err) {
        if (!isConnectionClosedError(err)) throw err;
        await swap();
        return current.listTools();
      }
    },
    async callTool(
      ctx: ToolCallContext,
      toolName: string,
      args: unknown,
    ): Promise<ToolCallResult> {
      try {
        const result = await current.callTool(ctx, toolName, args);
        if (!current.isOpen()) {
          // callTool marked itself closed based on a content-level error.
          // Retry once after respawn.
          await swap();
          return current.callTool(ctx, toolName, args);
        }
        return result;
      } catch (err) {
        if (!isConnectionClosedError(err)) throw err;
        await swap();
        return current.callTool(ctx, toolName, args);
      }
    },
    async close(): Promise<void> {
      await current.close();
    },
    isOpen(): boolean {
      return current.isOpen();
    },
  };

  return wrapped;
}
