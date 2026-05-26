import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { superviseChildren } from './start-supervisor.js';

function mockChild(): ChildProcess {
  const emitter = new EventEmitter();
  const state = { killed: false };
  return Object.assign(emitter, {
    exitCode: null,
    get killed() {
      return state.killed;
    },
    kill: () => {
      state.killed = true;
    },
  }) as unknown as ChildProcess;
}

describe('superviseChildren', () => {
  it('resolves when the first child exits non-zero and marks siblings killed', async () => {
    const api = mockChild();
    const web = mockChild();

    const resultPromise = superviseChildren([
      { child: api, label: 'API' },
      { child: web, label: 'web UI' },
    ]);

    api.emit('exit', 1, null);

    await expect(resultPromise).resolves.toBe(1);
    expect(web.killed).toBe(true);
  });

  it('resolves on spawn error without waiting for the sibling', async () => {
    const api = mockChild();
    const web = mockChild();

    const resultPromise = superviseChildren([
      { child: api, label: 'API' },
      { child: web, label: 'web UI' },
    ]);

    api.emit('error', new Error('ENOENT'));

    await expect(resultPromise).resolves.toBe(1);
    expect(web.killed).toBe(true);
  });
});
