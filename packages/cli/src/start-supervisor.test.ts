import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { superviseChildren } from './start-supervisor.js';

function createMockChild(autoExitOnKill = false) {
  const emitter = new EventEmitter();
  const state = { killed: false, exitCode: null as number | null };

  const child = emitter as unknown as ChildProcess;
  Object.defineProperty(child, 'exitCode', {
    get: () => state.exitCode,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(child, 'killed', {
    get: () => state.killed,
    enumerable: true,
    configurable: true,
  });
  child.kill = () => {
    state.killed = true;
    if (autoExitOnKill) {
      state.exitCode = 0;
      queueMicrotask(() => emitter.emit('exit', 0, 'SIGTERM'));
    }
    return true;
  };

  return {
    child,
    state,
    exit(code: number, signal: NodeJS.Signals | null = null) {
      state.exitCode = signal ? 128 : code;
      emitter.emit('exit', code, signal);
    },
  };
}

describe('superviseChildren', () => {
  it('fails when the first child exits 0 unexpectedly and waits for the sibling', async () => {
    const api = createMockChild(true);
    const web = createMockChild(true);

    const resultPromise = superviseChildren(
      [
        { child: api.child, label: 'API' },
        { child: web.child, label: 'web UI' },
      ],
      { shutdownTimeoutMs: 200 },
    );

    api.exit(0);

    await expect(resultPromise).resolves.toBe(1);
    expect(web.state.killed).toBe(true);
  });

  it('resolves when the first child exits non-zero and stops the sibling', async () => {
    const api = createMockChild(true);
    const web = createMockChild(true);

    const resultPromise = superviseChildren(
      [
        { child: api.child, label: 'API' },
        { child: web.child, label: 'web UI' },
      ],
      { shutdownTimeoutMs: 200 },
    );

    api.exit(1);

    await expect(resultPromise).resolves.toBe(1);
    expect(web.state.killed).toBe(true);
  });

  it('waits for both children during graceful shutdown', async () => {
    const api = createMockChild();
    const web = createMockChild();
    let graceful = false;

    const resultPromise = superviseChildren(
      [
        { child: api.child, label: 'API' },
        { child: web.child, label: 'web UI' },
      ],
      {
        isGracefulShutdown: () => graceful,
        shutdownTimeoutMs: 200,
      },
    );

    graceful = true;
    api.exit(0);
    web.exit(0);

    await expect(resultPromise).resolves.toBe(0);
    expect(web.state.killed).toBe(false);
  });

  it('resolves on spawn error and stops the sibling', async () => {
    const api = createMockChild();
    const web = createMockChild();

    const resultPromise = superviseChildren(
      [
        { child: api.child, label: 'API' },
        { child: web.child, label: 'web UI' },
      ],
      { shutdownTimeoutMs: 200 },
    );

    api.child.emit('error', new Error('ENOENT'));

    await expect(resultPromise).resolves.toBe(1);
    expect(web.state.killed).toBe(true);
  });
});
