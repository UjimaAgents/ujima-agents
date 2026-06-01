import type { MCPDef } from '@ujima/shared';
import { connectMCP, type MCPConnection, type ConnectOptions } from './connection';

export interface CacheRecovery {
  isolatedCache: true;
  reason: 'npm-cache-corrupted';
  cacheDir: string;
}

export interface ConnectResult {
  connection: MCPConnection;
  recovery?: CacheRecovery;
}

const NPM_CACHE_SIGNATURE = /(EEXIST|EACCES)[\s\S]*?_cacache\//;

export function looksLikeNpmCacheCorruption(message: string): boolean {
  return NPM_CACHE_SIGNATURE.test(message);
}

function isolatedCacheDir(defId: string): string {
  const safe = defId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `/tmp/ujima-mcp-cache-${safe}`;
}

type Connector = (def: MCPDef, options?: ConnectOptions) => Promise<MCPConnection>;

// Connect with one-shot self-healing for the case where a spawned npm/npx MCP
// fails because the user's global npm cache (~/.npm/_cacache) is corrupted —
// usually an orphan tmp file from a prior killed npm run leaves an EEXIST/
// EACCES rename trap that every subsequent spawn re-hits. We retry once with
// NPM_CONFIG_CACHE pointing at an ephemeral per-MCP dir, which sidesteps the
// broken global cache without mutating it. Non-stdio transports and non-npm
// failures fall through unchanged. `connector` is injectable for tests.
export async function connectMCPWithCacheRecovery(
  def: MCPDef,
  options: ConnectOptions = {},
  connector: Connector = connectMCP,
): Promise<ConnectResult> {
  try {
    const connection = await connector(def, options);
    return { connection };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Skip retry if caller supplied a pre-built transport (we can't
    // re-inject env into it), the transport isn't stdio, or the failure
    // doesn't look like npm cache corruption.
    if (
      options.transport ||
      def.transport !== 'stdio' ||
      !looksLikeNpmCacheCorruption(message)
    ) {
      throw err;
    }
    const cacheDir = isolatedCacheDir(def.id);
    const retryDef: MCPDef = {
      ...def,
      env: { ...(def.env ?? {}), NPM_CONFIG_CACHE: cacheDir },
    };
    const connection = await connector(retryDef, options);
    return {
      connection,
      recovery: { isolatedCache: true, reason: 'npm-cache-corrupted', cacheDir },
    };
  }
}
