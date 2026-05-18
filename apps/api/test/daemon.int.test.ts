import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';

const PKG_ROOT = resolve(__dirname, '..');
const ENTRY = join(PKG_ROOT, 'dist', 'main.js');
const DIRTY_FLAG = 'runtime.dirty';

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    execSync('bun run build', { cwd: PKG_ROOT, stdio: 'inherit' });
  }
}, 60_000);

interface Ready {
  home: string;
  child: ReturnType<typeof spawn>;
  logs: string[];
}

async function startDaemon(extraEnv?: Record<string, string>): Promise<Ready> {
  const home = await mkdtemp(join(tmpdir(), 'ujima-daemon-'));
  const port = await reservePort();
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      UJIMA_HOME: home,
      UJIMA_LOG_LEVEL: 'info',
      UJIMA_PORT: String(port),
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const logs: string[] = [];
  child.stderr!.on('data', (d: Buffer) => logs.push(d.toString('utf8')));
  // Wait for 'runtime: ready'
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      if (s.includes('"runtime: ready"') || s.includes('runtime: ready')) {
        child.stderr!.off('data', onData);
        resolvePromise();
      }
    };
    child.stderr!.on('data', onData);
    child.once('exit', (code) => rejectPromise(new Error(`daemon exited before ready (code=${code})\n${logs.join('')}`)));
    setTimeout(() => rejectPromise(new Error(`timeout waiting for ready\n${logs.join('')}`)), 15_000);
  });
  return { home, child, logs };
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        rejectPromise(new Error('failed to reserve port'));
        return;
      }
      server.close(() => resolvePromise(address.port));
    });
  });
}

interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

async function waitForExit(child: ReturnType<typeof spawn>, ms: number): Promise<ExitInfo> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ code: null, signal: null, timedOut: true }), ms);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, timedOut: false });
    });
  });
}

describe('ujima-runtime daemon', () => {
  it.skipIf(process.platform === 'win32')(
    'starts, writes dirty flag, shuts down cleanly on SIGTERM, and clears flag',
    async () => {
    const { home, child } = await startDaemon();
    try {
      expect(existsSync(join(home, DIRTY_FLAG))).toBe(true);
      const pidStr = await readFile(join(home, DIRTY_FLAG), 'utf8');
      expect(Number.parseInt(pidStr.trim(), 10)).toBe(child.pid);

      child.kill('SIGTERM');
      const exit = await waitForExit(child, 10_000);
      expect(exit.timedOut).toBe(false);
      // Graceful: exits via process.exit(143); some node builds may also report the signal.
      expect(exit.code === 143 || exit.signal === 'SIGTERM').toBe(true);
      await waitFor(() => !existsSync(join(home, DIRTY_FLAG)), 5_000);
      expect(existsSync(join(home, DIRTY_FLAG))).toBe(false);
    } finally {
      if (!child.killed) child.kill('SIGKILL');
      await rm(home, { recursive: true, force: true });
    }
  },
  );

  it('detects a prior dirty shutdown and logs a warning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ujima-daemon-dirty-'));
    await writeFile(join(home, DIRTY_FLAG), '99999', 'utf8');
    const port = await reservePort();
    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        UJIMA_HOME: home,
        UJIMA_LOG_LEVEL: 'info',
        UJIMA_PORT: String(port),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const logs: string[] = [];
    child.stderr!.on('data', (d: Buffer) => logs.push(d.toString('utf8')));

    try {
      await waitForLog(logs, 'recovering from dirty shutdown', 5_000);
    } finally {
      child.kill('SIGTERM');
      await waitForExit(child, 5_000);
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function waitForLog(logs: string[], needle: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (logs.join('').includes(needle)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(logs.join('')).toContain(needle);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
