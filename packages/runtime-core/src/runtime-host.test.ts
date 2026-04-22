import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeHost } from './runtime-host';
import { createBufferLogger } from './logger';
import type { LLMProvider } from '@ujima/llm';

function stubProvider(): LLMProvider {
  throw new Error('no provider configured');
}

describe('createRuntimeHost', () => {
  it('opens db at configured path and shuts down cleanly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ujima-host-'));
    const logger = createBufferLogger();
    const host = await createRuntimeHost(
      {
        homeDir: home,
        logger,
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w, id) => { throw new Error(`no mcp ${id}`); },
        getProvider: stubProvider,
      },
      {},
    );
    expect(host.dbPath).toContain('ujima.db');
    expect(host.homeDir).toBe(home);
    expect(host.listTasks()).toHaveLength(0);
    await host.shutdown({ drainMs: 100 });
    expect(logger.entries.some((e) => e.message === 'runtime-host: shutdown complete')).toBe(true);
  });

  it('rejects startTask when workspace row is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ujima-host-'));
    const host = await createRuntimeHost(
      {
        homeDir: home,
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w, id) => { throw new Error(`no mcp ${id}`); },
        getProvider: stubProvider,
      },
      {},
    );
    try {
      await expect(
        host.startTask({
          workspaceId: 'does-not-exist',
          sessionId: 's1',
          prompt: 'hi',
          teamId: 't1',
        }),
      ).rejects.toThrow(/workspace "does-not-exist"/);
    } finally {
      await host.shutdown({ drainMs: 100 });
    }
  });

  it('refuses to start tasks after shutdown', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ujima-host-'));
    const host = await createRuntimeHost(
      {
        homeDir: home,
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w, id) => { throw new Error(`no mcp ${id}`); },
        getProvider: stubProvider,
      },
      {},
    );
    await host.shutdown({ drainMs: 100 });
    await expect(
      host.startTask({ workspaceId: 'x', sessionId: 's', prompt: 'p', teamId: 't' }),
    ).rejects.toThrow(/shutting down/);
  });
});
