import type { MCPDef } from '@ujima/shared';
import {
  connectMCP,
  isConnectionClosedError,
  type ConnectOptions,
  type MCPConnection,
  type ToolCallContext,
  type ToolCallResult,
  type ToolInfo,
} from './connection';

export interface PoolGetOptions {
  /**
   * Agent requesting this connection. When the MCP def has
   * `isolation: 'per-agent'`, each agent gets its own dedicated process.
   * Ignored for shared MCPs (the default).
   */
  agentId?: string;
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
  if (isolated && opts?.agentId) return `${def.id}::agent::${opts.agentId}`;
  return def.id;
}

export function createMCPPool(defaults: ConnectOptions = {}): MCPPool {
  const connections = new Map<string, MCPConnection>();
  const pending = new Map<string, Promise<MCPConnection>>();

  async function spawn(def: MCPDef, key: string): Promise<MCPConnection> {
    const p = connectMCP(def, defaults).then(
      (raw) => {
        const wrapped = wrapWithReconnect(raw, () => {
          // On closed-connection fault, detach from cache so the next
          // call spawns a fresh process.
          if (connections.get(key) === wrapped) connections.delete(key);
          return spawn(def, key);
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

      return spawn(def, key);
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
