import type { MCPDef } from '@ujima/shared';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export function buildTransport(def: MCPDef): Transport {
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
      });
    }
    case 'sse': {
      if (!def.url) {
        throw new Error(`MCP "${def.id}": sse transport requires a url`);
      }
      return new SSEClientTransport(new URL(def.url));
    }
    case 'http-streamable': {
      if (!def.url) {
        throw new Error(`MCP "${def.id}": http-streamable transport requires a url`);
      }
      return new StreamableHTTPClientTransport(new URL(def.url));
    }
    default: {
      const _exhaustive: never = def.transport;
      throw new Error(`Unsupported transport: ${String(_exhaustive)}`);
    }
  }
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
