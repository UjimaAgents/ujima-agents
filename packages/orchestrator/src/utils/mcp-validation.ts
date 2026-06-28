export interface McpConnectivityInput {
  transport: string;
  command?: string;
  url?: string;
}

export function validateMcpConnectivity(input: McpConnectivityInput): void {
  if (input.transport === 'stdio') {
    if (!input.command || input.command.trim().length === 0) {
      throw new Error('stdio MCP servers require a command');
    }
  } else {
    if (!input.url || input.url.trim().length === 0) {
      throw new Error(`${input.transport} MCP servers require a url`);
    }
  }
}
