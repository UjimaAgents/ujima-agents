import type { MCPDef, McpServer } from '@ujima/shared';

export interface McpRuntimeConnection {
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool(
    ctx: { agentId: string; taskId?: string; sessionId?: string },
    toolName: string,
    args: unknown,
  ): Promise<{ content: unknown; isError?: boolean }>;
}

export interface McpRuntimePool {
  get(
    def: MCPDef,
    opts?: { agentId?: string; scopePaths?: string[] },
  ): Promise<McpRuntimeConnection>;
}

export interface McpSecretReader {
  readSecret(keyRef: string): string | null;
}

export function mcpPermissionToolName(serverId: string, toolName: string): string {
  return `mcp:${encodeURIComponent(serverId)}:${encodeURIComponent(toolName)}`;
}

type McpRuntimeServer = Pick<
  McpServer,
  | 'id'
  | 'name'
  | 'description'
  | 'category'
  | 'transport'
  | 'command'
  | 'args'
  | 'envKeyRef'
  | 'url'
  | 'headersKeyRef'
  | 'isolation'
>;

export function materializeMcpDef(repo: McpSecretReader, server: McpRuntimeServer): MCPDef {
  const env = readSecretMap(repo, server.envKeyRef);
  const headers = readSecretMap(repo, server.headersKeyRef);
  return {
    id: server.id,
    name: server.name,
    version: '0.0.0',
    description: server.description,
    category: server.category,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    url: server.url,
    isolation: server.isolation,
  };
}

export function readSecretMap(
  repo: McpSecretReader,
  keyRef: string | undefined,
): Record<string, string> {
  if (!keyRef) return {};
  const raw = repo.readSecret(keyRef);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}
