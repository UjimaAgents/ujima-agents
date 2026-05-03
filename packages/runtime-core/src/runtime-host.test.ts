import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeHost, sanitizeMcpArgs } from './runtime-host';
import { createBufferLogger } from './logger';
import type { LLMProvider } from '@ujima/llm/legacy';
import type { AgentDef } from '@ujima/shared';
import { createPathResolver } from './path-resolver';

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

  it('starts slim tasks from an ad hoc task-file team and preserves sequence order', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ujima-host-'));
    const root = await mkdtemp(join(tmpdir(), 'ujima-workspace-'));
    const host = await createRuntimeHost(
      {
        homeDir: home,
        loadAgent: async (_workspaceId, agentId) => makeAgent(agentId),
        loadTeam: async () => undefined,
        resolveMCPDef: async (_workspaceId, id) => { throw new Error(`no mcp ${id}`); },
        getProvider: stubProvider,
      },
      {},
    );
    const workspace = host.workspaces.create({ id: 'ws-ad-hoc', root_path: root, label: 'demo' });

    try {
      const started = await host.startTask({
        workspaceId: workspace.id,
        sessionId: 'session-ad-hoc',
        prompt: 'Review the landing page',
        taskId: 'task-ad-hoc',
        executionMode: 'slim',
        agentIds: ['frontend-bob', 'frontend-alice'],
        sequence: ['frontend-bob', 'frontend-alice'],
      });

      expect(started.team.team_id).toBe('task-ad-hoc');
      expect(started.team.agents).toEqual(['frontend-bob', 'frontend-alice']);
      expect(started.task.execution_mode).toBe('slim');

      const result = await started.handle.result;
      expect(result.agentResults[0]?.agentId).toBe('frontend-bob');
    } finally {
      await host.shutdown({ drainMs: 100 });
    }
  });

  it('sanitizes MCP path args against optional agent scope paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujima-host-scope-'));
    await mkdir(join(root, 'apps', 'web'), { recursive: true });
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await writeFile(join(root, 'apps', 'web', 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(root, 'apps', 'api', 'server.ts'), 'export {};\n', 'utf8');
    const resolver = await createPathResolver({
      root,
      scopePaths: [join(root, 'apps', 'web')],
    });

    await expect(
      sanitizeMcpArgs(
        { filePath: 'apps/api/server.ts' },
        resolver,
      ),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });

    await expect(
      sanitizeMcpArgs(
        { cwd: 'apps/web', inputPath: 'apps/web/index.ts' },
        resolver,
      ),
    ).resolves.toEqual({
      cwd: await resolver.resolve('apps/web'),
      inputPath: await resolver.resolve('apps/web/index.ts'),
    });

    await expect(
      sanitizeMcpArgs(
        { paths: ['../../etc/passwd'] },
        resolver,
      ),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });

    await expect(
      sanitizeMcpArgs(
        { filePaths: ['apps/web/index.ts'] },
        resolver,
      ),
    ).resolves.toEqual({
      filePaths: [await resolver.resolve('apps/web/index.ts')],
    });

    await expect(
      sanitizeMcpArgs(
        { args: ['feature/foo'], branchName: 'feature/bar' },
        resolver,
      ),
    ).resolves.toEqual({
      args: ['feature/foo'],
      branchName: 'feature/bar',
    });
  });
});

function makeAgent(agentId: string): AgentDef {
  return {
    id: agentId,
    name: agentId,
    persona: 'helpful',
    model: 'mock-model',
    mcp: 'workspace-tools',
    permissions: {
      allowed_tools: [],
      blocked_tools: [],
      rate_limit: {
        calls_per_minute: 30,
        max_session_tokens: 100_000,
      },
    },
    communication: {
      publishes: [],
      subscribes: [],
    },
    escalation: {
      conditions: [],
      escalate_to: 'human',
    },
  };
}
