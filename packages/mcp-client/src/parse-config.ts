import { MCPDef } from '@ujima/shared';

export interface ParseConfigResult {
  defs: MCPDef[];
  warnings: string[];
}

export function parseMCPConfigJSON(input: string): ParseConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  return parseMCPConfigObject(parsed);
}

export function parseMCPConfigObject(input: unknown): ParseConfigResult {
  if (!isRecord(input)) {
    throw new Error('Expected a JSON object with an "mcpServers" field');
  }

  const serversRaw =
    'mcpServers' in input ? input.mcpServers : 'servers' in input ? input.servers : input;

  if (!isRecord(serversRaw)) {
    throw new Error('"mcpServers" must be an object keyed by server id');
  }

  const warnings: string[] = [];
  const defs: MCPDef[] = [];

  for (const [id, rawValue] of Object.entries(serversRaw)) {
    if (!isRecord(rawValue)) {
      warnings.push(`Skipping "${id}": entry is not an object`);
      continue;
    }
    try {
      defs.push(coerceOne(id, rawValue));
    } catch (err) {
      warnings.push(`Skipping "${id}": ${(err as Error).message}`);
    }
  }

  return { defs, warnings };
}

function coerceOne(id: string, raw: Record<string, unknown>): MCPDef {
  const command = typeof raw.command === 'string' ? raw.command : undefined;
  const urlRaw =
    typeof raw.url === 'string'
      ? raw.url
      : typeof raw.endpoint === 'string'
        ? raw.endpoint
        : undefined;

  const explicitTransport = typeof raw.transport === 'string' ? raw.transport : undefined;
  const transport = (explicitTransport ??
    (command ? 'stdio' : urlRaw?.includes('/sse') ? 'sse' : urlRaw ? 'http-streamable' : 'stdio')) as MCPDef['transport'];

  const argsRaw = Array.isArray(raw.args) ? raw.args.filter((x) => typeof x === 'string') : [];
  const envRaw = isRecord(raw.env)
    ? Object.fromEntries(
        Object.entries(raw.env).filter(([, v]) => typeof v === 'string') as [string, string][],
      )
    : {};
  const headersRaw = isRecord(raw.headers)
    ? Object.fromEntries(
        Object.entries(raw.headers).filter(([, v]) => typeof v === 'string') as [string, string][],
      )
    : undefined;

  const defInput = {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    description: typeof raw.description === 'string' ? raw.description : '',
    category: typeof raw.category === 'string' ? raw.category : 'general',
    transport,
    command,
    args: argsRaw,
    env: envRaw,
    ...(headersRaw && Object.keys(headersRaw).length > 0 ? { headers: headersRaw } : {}),
    url: urlRaw,
  };

  return MCPDef.parse(defInput);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
