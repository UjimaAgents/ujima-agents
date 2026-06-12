import type { MCPDef } from '@ujima/shared';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface BuildTransportOptions {
  /**
   * Working directory for stdio child processes. When set, the
   * spawned MCP runs with this CWD instead of inheriting the daemon's.
   * Critical for filesystem-touching MCPs (Playwright, Filesystem) so
   * relative file paths land in the agent's workspace, not in the
   * directory the daemon happened to be launched from.
   */
  cwd?: string;
}

export function buildTransport(
  def: MCPDef,
  options: BuildTransportOptions = {},
): Transport {
  switch (def.transport) {
    case 'stdio': {
      if (!def.command) {
        throw new Error(`MCP "${def.id}": stdio transport requires a command`);
      }
      return new StdioClientTransport({
        command: def.command,
        args: def.args,
        env: mergeEnv(def.env),
        stderr: 'pipe',
        ...(options.cwd ? { cwd: options.cwd } : {}),
      });
    }
    case 'sse': {
      if (!def.url) {
        throw new Error(`MCP "${def.id}": sse transport requires a url`);
      }
      return new SSEClientTransport(new URL(def.url), requestOptions(def.headers));
    }
    case 'http-streamable': {
      if (!def.url) {
        throw new Error(`MCP "${def.id}": http-streamable transport requires a url`);
      }
      return new StreamableHTTPClientTransport(new URL(def.url), requestOptions(def.headers));
    }
    default: {
      const _exhaustive: never = def.transport;
      throw new Error(`Unsupported transport: ${String(_exhaustive)}`);
    }
  }
}

function requestOptions(headers: Record<string, string> | undefined):
  | { requestInit: RequestInit }
  | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return { requestInit: { headers } };
}

function mergeEnv(defEnv: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v;
  }
  if (defEnv) {
    for (const [k, v] of Object.entries(defEnv)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}
