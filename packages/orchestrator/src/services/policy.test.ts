import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentTeam } from '@ujima/framework';
import { checkToolPolicy } from './policy.js';

describe('checkToolPolicy', () => {
  let workspaceRoot: string;
  let daemonCwd: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-policy-root-'));
    daemonCwd = await mkdtemp(join(tmpdir(), 'ujima-policy-cwd-'));
    await mkdir(join(workspaceRoot, 'apps', 'web'), { recursive: true });
    await mkdir(join(workspaceRoot, 'apps', 'api'), { recursive: true });
    await writeFile(join(workspaceRoot, 'apps', 'web', 'index.ts'), 'export const ok = true;\n', 'utf8');
    process.chdir(daemonCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(daemonCwd, { recursive: true, force: true });
  });

  it('evaluates relative workspace scopes against the workspace root instead of process cwd', () => {
    const team = loadAgentTeam({
      name: 'Policy Org',
      workspace: { root: workspaceRoot },
      providers: {
        openai: {
          kind: 'openai',
          defaultModel: 'gpt-5.4',
          models: ['gpt-5.4'],
        },
      },
      roles: [
        {
          name: 'frontend-engineer',
          title: 'Frontend Engineer',
          instructions: 'Stay in apps/web.',
          provider: 'openai',
          model: 'gpt-5.4',
          workspaceScopes: ['apps/web'],
          tools: ['filesystem'],
          channels: ['general'],
        },
      ],
      agents: [],
      channels: [{ name: 'general', kind: 'general', topic: 'General' }],
    } as Record<string, unknown>);

    expect(
      checkToolPolicy(
        team,
        'frontend-engineer',
        'filesystem',
        'read',
        join(workspaceRoot, 'apps', 'web', 'index.ts'),
      ),
    ).toMatchObject({ allowed: true, requiresApproval: false });

    expect(
      checkToolPolicy(
        team,
        'frontend-engineer',
        'filesystem',
        'read',
        join(workspaceRoot, 'apps', 'api'),
      ),
    ).toMatchObject({ allowed: false });
  });
});
