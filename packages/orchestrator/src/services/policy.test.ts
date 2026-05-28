import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentTeam, type AgentTeamHandle } from '@ujima/framework';
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

  function teamWithRole(role: Record<string, unknown>) {
    return loadAgentTeam({
      name: 'Policy Org',
      workspace: { root: workspaceRoot },
      providers: {
        openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
      },
      roles: [role],
      agents: [],
      channels: [{ name: 'general', kind: 'general', topic: 'General' }],
    } as Record<string, unknown>);
  }

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
          tools: [],
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
        'view',
        'read',
        join(workspaceRoot, 'apps', 'web', 'index.ts'),
      ),
    ).toMatchObject({ allowed: true, requiresApproval: false });

    expect(
      checkToolPolicy(
        team,
        'frontend-engineer',
        'view',
        'read',
        join(workspaceRoot, 'apps', 'api'),
      ),
    ).toEqual({ allowed: true, requiresApproval: false });
  });

  describe('filesystem path policy', () => {
    it('requires approval for sensitive-path reads even inside role scope', async () => {
      await writeFile(join(workspaceRoot, '.env'), 'TOKEN=secret\n', 'utf8');

      const team = teamWithRole({
        name: 'secret-reader',
        title: 'Secret Reader',
        instructions: 'Can inspect root files.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['.'],
        tools: [],
        channels: ['general'],
      });

      expect(
        checkToolPolicy(
          team,
          'secret-reader',
          'view',
          'read',
          join(workspaceRoot, '.env'),
        ),
      ).toMatchObject({ allowed: true, requiresApproval: true });
    });

    it('bypasses approval for writes inside .ujima-goals', async () => {
      const team = teamWithRole({
        name: 'goal-writer',
        title: 'Goal Writer',
        instructions: 'Can manage goal artifacts.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['.'],
        tools: ['write', 'edit', 'multiedit'],
        channels: ['general'],
      });

      expect(
        checkToolPolicy(
          team,
          'goal-writer',
          'write',
          'write',
          join(workspaceRoot, '.ujima-goals', 'plan.md'),
        ),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('does not require approval for write/edit/multiedit inside role scope', () => {
      const team = teamWithRole({
        name: 'web-writer',
        title: 'Web Writer',
        instructions: 'Can edit apps/web.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['write', 'edit', 'multiedit'],
        channels: ['general'],
      });

      for (const toolId of ['write', 'edit', 'multiedit']) {
        expect(
          checkToolPolicy(
            team,
            'web-writer',
            toolId,
            'write',
            join(workspaceRoot, 'apps', 'web', 'index.ts'),
          ),
        ).toEqual({ allowed: true, requiresApproval: false });
      }
    });

    it('requires approval for edits outside role scope', () => {
      const team = teamWithRole({
        name: 'web-writer',
        title: 'Web Writer',
        instructions: 'Can edit apps/web.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['write', 'edit', 'multiedit'],
        channels: ['general'],
      });

      expect(
        checkToolPolicy(
          team,
          'web-writer',
          'edit',
          'write',
          join(workspaceRoot, 'apps', 'api', 'index.ts'),
        ),
      ).toMatchObject({ allowed: true, requiresApproval: true });
    });

    it('allows reads outside role scope without approval', () => {
      const team = teamWithRole({
        name: 'web-reader',
        title: 'Web Reader',
        instructions: 'Can inspect apps/web.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: [],
        channels: ['general'],
      });

      expect(
        checkToolPolicy(
          team,
          'web-reader',
          'view',
          'read',
          join(workspaceRoot, 'apps', 'api', 'src', 'main.ts'),
        ),
      ).toEqual({ allowed: true, requiresApproval: false });
    });
  });

  // Regression coverage for two bugs in the channel-tool surface:
  //   1. checkToolPolicy was forcing channel.* writes through the approval
  //      gate (`requiresApproval: action !== 'read'`), pausing every run on
  //      the first message. Only the legacy `message` toolId was exempt.
  //   2. channel.post / .reply / .dm / .read were passing channel/message
  //      ids as `resourcePath`, so workspace-boundary + per-role scope checks
  //      rejected them as "outside allowed scopes" for narrow roles like
  //      `frontend-engineer` (scope `apps/web`).
  describe('channel.* tools', () => {
    function buildTeam(): AgentTeamHandle {
      return loadAgentTeam({
        name: 'Channel Org',
        workspace: { root: workspaceRoot },
        providers: {
          openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
        },
        roles: [
          {
            name: 'frontend-engineer',
            title: 'Frontend Engineer',
            instructions: 'Stay in apps/web.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/web'], // narrow scope — channel ids must NOT be path-checked
            tools: [
              'write',
              'channel.post',
              'channel.reply',
              'channel.dm',
              'channel.list',
              'channel.read',
            ],
            channels: ['general'],
          },
        ],
        agents: [],
        channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      } as Record<string, unknown>);
    }

    it('allows baseline channel tools without workspace path checks', () => {
      const team = buildTeam();
      for (const toolId of [
        'channel.post',
        'channel.reply',
        'channel.dm',
        'channel.read',
        'channel.list',
      ] as const) {
        const action = toolId === 'channel.read' || toolId === 'channel.list' ? 'read' : 'message';
        expect(checkToolPolicy(team, 'frontend-engineer', toolId, action)).toEqual({
          allowed: true,
          requiresApproval: false,
        });
      }
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.post', 'message', 'general'),
      ).toEqual({ allowed: true, requiresApproval: false });
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.dm', 'message', 'dm:alex'),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('channel.* posting and read tools are baseline-allowed regardless of role.tools', () => {
      // Design choice: channel.post / channel.reply / channel.dm /
      // channel.read / channel.list / message / schedule are baseline
      // conversational primitives. Every agent gets them in its
      // palette (via ALWAYS_AVAILABLE_AGENT_TOOLS) regardless of
      // what role.tools declares. Fine-grained access restrictions
      // (e.g., "junior-qa can't DM senior-*") belong to the
      // permissions middleware, NOT the role.tools allowlist.
      const team = loadAgentTeam({
        name: 'Channel Org',
        workspace: { root: workspaceRoot },
        providers: {
          openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
        },
        roles: [
          {
            name: 'silent-role',
            title: 'Silent',
            instructions: 'Role with no channel tools listed.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/web'],
            tools: ['filesystem'], // role doesn't list channel.* — should still be allowed
            channels: ['general'],
          },
        ],
        agents: [],
        channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      } as Record<string, unknown>);

      // All baseline conversational tools are allowed for every role.
      for (const toolId of ['channel.post', 'channel.reply', 'channel.dm', 'channel.read', 'channel.list', 'message', 'schedule']) {
        expect(
          checkToolPolicy(team, 'silent-role', toolId, 'message'),
        ).toEqual({ allowed: true, requiresApproval: false });
      }
    });

  });

  describe('mandatory-reply enforcement (L3)', () => {
    function buildTeam(): AgentTeamHandle {
      return loadAgentTeam({
        name: 'Mention Org',
        workspace: { root: workspaceRoot },
        providers: {
          openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
        },
        roles: [
          {
            name: 'engineer',
            title: 'Engineer',
            instructions: 'Reply when tagged.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/web'],
            tools: ['filesystem', 'channel.read', 'channel.reply'],
            channels: ['general'],
          },
        ],
        agents: [],
        channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      } as Record<string, unknown>);
    }

    it('rejects channel.pass when wakeReason === mention', () => {
      const team = buildTeam();
      const result = checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
        wakeReason: 'mention',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/mandatory-reply/);
    });

    it('rejects deprecated self.note in favor of memory tools', () => {
      const team = buildTeam();
      expect(checkToolPolicy(team, 'engineer', 'self.note', 'message')).toEqual({
        allowed: false,
        requiresApproval: false,
        reason: 'self.note was removed; use memory.write / memory.recall instead.',
      });
      expect(checkToolPolicy(team, 'engineer', 'memory.write', 'message')).toEqual({
        allowed: true,
        requiresApproval: false,
      });
    });

    it('rejects channel.pass in direct-message threads', () => {
      const team = buildTeam();
      const result = checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
        threadId: 'dm:member-a:member-b',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/direct-message/);
    });

    it('allows channel.pass for non-mention wake reasons', () => {
      const team = buildTeam();
      expect(
        checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
          wakeReason: 'channel-read',
        }),
      ).toEqual({ allowed: true, requiresApproval: false });
      expect(
        checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
          wakeReason: 'dm',
        }),
      ).toEqual({ allowed: true, requiresApproval: false });
      // Programmatic runs without wakeReason also pass through.
      expect(
        checkToolPolicy(team, 'engineer', 'channel.pass', 'message'),
      ).toEqual({ allowed: true, requiresApproval: false });
    });


    it('keeps channel.reply available for mention runs (the contract IS to reply)', () => {
      const team = buildTeam();
      const result = checkToolPolicy(
        team,
        'engineer',
        'channel.reply',
        'message',
        undefined,
        { wakeReason: 'mention' },
      );
      expect(result.allowed).toBe(true);
    });
  });
});
