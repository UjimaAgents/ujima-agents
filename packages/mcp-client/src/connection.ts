import type { MCPDef } from '@ujima/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { buildTransport } from './transport';

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  // Mirrors the MCP spec's `annotations.destructiveHint`. We carry it
  // through verbatim so the classifier and admin UI can read the
  // server's own intent before falling back to verb heuristics.
  destructive?: boolean;
}

export interface ToolCallResult {
  content: unknown;
  isError?: boolean;
}

export interface ToolCallContext {
  agentId: string;
  taskId?: string;
  sessionId?: string;
}

export interface MCPConnection {
  readonly id: string;
  readonly def: MCPDef;
  listTools(): Promise<ToolInfo[]>;
  callTool(ctx: ToolCallContext, toolName: string, args: unknown): Promise<ToolCallResult>;
  close(): Promise<void>;
  isOpen(): boolean;
}

export interface ConnectOptions {
  clientName?: string;
  clientVersion?: string;
  transport?: Transport;
  onToolCall?: (
    ctx: ToolCallContext,
    mcpId: string,
    toolName: string,
    args: unknown,
    result: ToolCallResult,
    durationMs: number,
  ) => void | Promise<void>;
}

type QueueItem = () => Promise<void>;

export async function connectMCP(
  def: MCPDef,
  options: ConnectOptions = {},
): Promise<MCPConnection> {
  const transport = options.transport ?? buildTransport(def);
  const client = new Client(
    { name: options.clientName ?? 'ujima', version: options.clientVersion ?? '0.1.0' },
    { capabilities: {} },
  );

  const stderrChunks: string[] = [];
  if (transport instanceof StdioClientTransport) {
    const s = transport.stderr;
    if (s) {
      s.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stderrChunks.push(text);
        while (stderrChunks.join('').length > 4000) stderrChunks.shift();
      });
    }
  }

  try {
    await client.connect(transport);
  } catch (err) {
    const stderr = stderrChunks.join('').trim();
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(stderr ? `${base} — child stderr: ${stderr}` : base);
  }

  let open = true;
  const queue: QueueItem[] = [];
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await next();
      }
    } finally {
      draining = false;
    }
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await work());
        } catch (err) {
          reject(err as Error);
        }
      });
      void drain();
    });
  }

  return {
    id: def.id,
    def,

    async listTools() {
      return enqueue(async () => {
        const res = await client.listTools();
        return res.tools.map((t) => {
          const annotations = (t as { annotations?: { destructiveHint?: boolean } })
            .annotations;
          const destructive =
            typeof annotations?.destructiveHint === 'boolean'
              ? annotations.destructiveHint
              : undefined;
          return {
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            ...(destructive !== undefined ? { destructive } : {}),
          };
        });
      });
    },

    async callTool(ctx, toolName, args) {
      const start = Date.now();
      let result: ToolCallResult;
      try {
        result = await enqueue<ToolCallResult>(async () => {
          const res = await client.callTool({
            name: toolName,
            arguments: (args ?? {}) as Record<string, unknown>,
          });
          return {
            content: res.content,
            isError: typeof res.isError === 'boolean' ? res.isError : undefined,
          };
        });
      } catch (err) {
        if (isConnectionClosedError(err)) {
          open = false;
          void client.close().catch(() => {
            /* already closed */
          });
        }
        throw err;
      }
      if (isConnectionClosedError(resultErrorText(result))) {
        // MCP returned a content error (not a throw) indicating the browser/
        // backend process has been torn down. Drop the connection so the pool
        // respawns on the next get().
        open = false;
        void client.close().catch(() => {
          /* already closed */
        });
      }
      const duration = Date.now() - start;
      if (options.onToolCall) {
        await options.onToolCall(ctx, def.id, toolName, args, result, duration);
      }
      return result;
    },

    async close() {
      if (!open) return;
      open = false;
      await client.close();
    },

    isOpen() {
      return open;
    },
  };
}

/**
 * Signals from long-running backend MCPs (Playwright, Puppeteer-MCP, headless
 * browsers, etc.) that the underlying process/page/context has been torn down
 * out from under us. When we see one of these the connection is no longer
 * usable — a retry against the same handle will just error again.
 *
 * Matches the user-facing messages Playwright MCP emits:
 *   "Target page, context or browser has been closed"
 *   "Target closed"
 *   "Protocol error ...: Target closed"
 *   "Browser has been closed"
 * Plus transport-level signals.
 */
export function isConnectionClosedError(input: unknown): boolean {
  const text = extractErrorText(input);
  if (!text) return false;
  const lowered = text.toLowerCase();
  return (
    lowered.includes('target page, context or browser has been closed') ||
    lowered.includes('target closed') ||
    lowered.includes('browser has been closed') ||
    lowered.includes('browser context has been closed') ||
    lowered.includes('session closed') ||
    lowered.includes('transport is closed') ||
    lowered.includes('connection closed')
  );
}

function extractErrorText(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message;
  if (typeof input === 'object') {
    const maybe = input as { message?: unknown };
    if (typeof maybe.message === 'string') return maybe.message;
  }
  return undefined;
}

function resultErrorText(result: ToolCallResult): string | undefined {
  if (!result.isError) return undefined;
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const piece of content as unknown[]) {
    if (piece && typeof piece === 'object') {
      const maybe = piece as { type?: unknown; text?: unknown };
      if (maybe.type === 'text' && typeof maybe.text === 'string') parts.push(maybe.text);
    }
  }
  return parts.join('\n') || undefined;
}
