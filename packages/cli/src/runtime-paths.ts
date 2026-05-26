import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Directory containing `runtime/api` and `runtime/web` when installed from npm. */
export function resolvePackagedRuntimeDir(cliDirname: string): string | null {
  const runtimeDir = join(cliDirname, 'runtime');
  const apiMain = join(runtimeDir, 'api', 'main.js');
  if (existsSync(apiMain)) return runtimeDir;
  return null;
}

/** Next standalone server entry (monorepo or flat layout). */
export function resolveWebServerEntry(webRuntimeDir: string): string | null {
  const candidates = [
    join(webRuntimeDir, 'apps/web/server.js'),
    join(webRuntimeDir, 'server.js'),
  ];
  for (const entry of candidates) {
    if (existsSync(entry)) return entry;
  }
  return null;
}

export function resolveWebServerCwd(webRuntimeDir: string, serverEntry: string): string {
  const appWebCwd = join(webRuntimeDir, 'apps/web');
  if (serverEntry.startsWith(appWebCwd)) return appWebCwd;
  return dirname(serverEntry);
}
