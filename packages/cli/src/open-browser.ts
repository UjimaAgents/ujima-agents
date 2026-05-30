import { spawn } from 'node:child_process';
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT } from '@ujima/api-schema';
import {
  printInfoRow,
  printReadyLine,
  printSplash,
} from './cli-branding.js';

const DEFAULT_WEB_PORT = '3452';
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

export function buildWebUrl(): string {
  const port = process.env.WEB_PORT ?? DEFAULT_WEB_PORT;
  return `http://localhost:${port}`;
}

export function buildApiDisplayUrl(): string {
  const host = process.env.UJIMA_BIND_HOST ?? DEFAULT_BIND_HOST;
  const port = process.env.UJIMA_PORT ?? String(DEFAULT_BIND_PORT);
  const displayHost = host === '127.0.0.1' || host === '0.0.0.0' ? 'localhost' : host;
  return `http://${displayHost}:${port}`;
}

export function shouldSkipOpenBrowser(argv: string[]): boolean {
  if (argv.includes('--no-open')) return true;
  const env = process.env.UJIMA_NO_OPEN;
  if (env === '1' || env === 'true') return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

export async function waitForHttpReady(
  url: string,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3_000) });
      if (response.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export function printStackReady(opts: { webUrl: string; apiUrl: string; openedBrowser: boolean }): void {
  printSplash();
  printReadyLine('Stack Ready');
  printInfoRow('Web:', opts.webUrl, { underline: true });
  printInfoRow('API:', opts.apiUrl, { underline: true });
  if (opts.openedBrowser) {
    printInfoRow('Browser:', `Opened ${opts.webUrl}`, { dim: true });
  }
}

export function maybeOpenBrowserAfterStart(argv: string[]): void {
  if (shouldSkipOpenBrowser(argv)) return;

  const webUrl = buildWebUrl();
  const apiUrl = buildApiDisplayUrl();

  void (async () => {
    const ready = await waitForHttpReady(webUrl);
    let openedBrowser = false;
    if (ready) {
      openBrowser(webUrl);
      openedBrowser = true;
    }
    printStackReady({ webUrl, apiUrl, openedBrowser });
  })();
}
