import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentTeam, type AgentTeamHandle } from '@ujima/framework';
import { checkToolPolicy, resolveShellExecutePolicy } from './policy.js';

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

  });

  describe('resolveShellExecutePolicy', () => {
    it('maps each shell approval mode', () => {
      expect(resolveShellExecutePolicy('allow_all')).toEqual({
        requiresApproval: false,
        shellAutoReview: false,
      });
      expect(resolveShellExecutePolicy('always_review')).toEqual({
        requiresApproval: true,
        shellAutoReview: false,
      });
      expect(resolveShellExecutePolicy('auto_review')).toEqual({
        requiresApproval: true,
        shellAutoReview: true,
      });
      expect(resolveShellExecutePolicy(undefined)).toBeNull();
    });
  });

  describe('shell approval modes', () => {
    it.each([
      ['allow_all', false, false] as const,
      ['always_review', true, false] as const,
      ['auto_review', true, true] as const,
    ])('handles shell approval mode %s', (mode, requiresApproval, shellAutoReview) => {
      expect(
        checkToolPolicy(
          teamWithRole({
            name: 'shell-runner',
            title: 'Shell Runner',
            instructions: 'Can run shell when enabled.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['.'],
            tools: ['shell'],
            channels: ['general'],
          }),
          'shell-runner', 'shell', 'execute', '.',
          { effectiveShellApprovalMode: mode },
        ),
      ).toEqual({ allowed: true, requiresApproval, shellAutoReview });
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

    // The gate must agree with the wake-time palette on peer-aware pass:
    // agent↔agent DMs keep channel.pass (so the self-chatter loop can
    // terminate); human DMs keep the forced-reply contract. The caller
    // resolves `dmPeerIsAgent` from the authoritative member roster, so
    // the gate simply honours that flag.
    it('allows channel.pass in an agent↔agent DM (dmPeerIsAgent: true)', () => {
      const team = buildTeam();
      expect(
        checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
          threadId: 'dm:m-1:m-2',
          dmPeerIsAgent: true,
        }),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('rejects channel.pass in a human DM (dmPeerIsAgent: false)', () => {
      const team = buildTeam();
      const result = checkToolPolicy(team, 'engineer', 'channel.pass', 'message', undefined, {
        threadId: 'dm:m-1:m-9',
        dmPeerIsAgent: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/direct-message/);
    });
  });
});
