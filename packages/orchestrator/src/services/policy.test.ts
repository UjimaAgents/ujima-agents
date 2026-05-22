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
    ).toMatchObject({ allowed: false });
  });

  describe('filesystem access to soul.md', () => {
    it('allows a role scoped to apps/web to read soul.md there', async () => {
      await writeFile(join(workspaceRoot, 'apps', 'web', 'soul.md'), 'I am the soul.\n', 'utf8');

      const team = loadAgentTeam({
        name: 'Soul Org',
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
            name: 'root-reader',
            title: 'Root Reader',
            instructions: 'Can read soul.md.',
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
          'root-reader',
          'view',
          'read',
          join(workspaceRoot, 'apps', 'web', 'soul.md'),
        ),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('blocks a role without access to apps/web', () => {
      const team = loadAgentTeam({
        name: 'Soul Org',
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
            name: 'web-reader',
            title: 'Web Reader',
            instructions: 'Can only read apps/web.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/api'],
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
          'web-reader',
          'view',
          'read',
          join(workspaceRoot, 'apps', 'web', 'soul.md'),
        ),
      ).toMatchObject({
        allowed: false,
        reason: expect.stringContaining('outside allowed scopes'),
      });
    });

    it('requires approval for hidden or secret-looking reads', async () => {
      await writeFile(join(workspaceRoot, '.env'), 'TOKEN=secret\n', 'utf8');

      const team = loadAgentTeam({
        name: 'Secret Org',
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
            name: 'secret-reader',
            title: 'Secret Reader',
            instructions: 'Can inspect root files.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['.'],
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
          'secret-reader',
          'view',
          'read',
          join(workspaceRoot, '.env'),
        ),
      ).toEqual({
        allowed: true,
        requiresApproval: true,
        reason: 'Path "' + join(workspaceRoot, '.env') + '" requires approval',
      });
    });

    it('bypasses approval for writes inside .ujima-goals', async () => {
      const team = loadAgentTeam({
        name: 'Goal Org',
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
            name: 'goal-writer',
            title: 'Goal Writer',
            instructions: 'Can manage goal artifacts.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['.'],
            tools: ['write', 'edit', 'multiedit'],
            channels: ['general'],
          },
        ],
        agents: [],
        channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      } as Record<string, unknown>);

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
              'filesystem',
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

    it('channel.post is allowed without approval (messaging is the substrate)', () => {
      const team = buildTeam();
      // Pre-fix: this returned `{ requiresApproval: true }` and paused the run.
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.post', 'message'),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('channel.reply / channel.dm are allowed without approval', () => {
      const team = buildTeam();
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.reply', 'message'),
      ).toEqual({ allowed: true, requiresApproval: false });
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.dm', 'message'),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('channel.list / channel.read are allowed (read action)', () => {
      const team = buildTeam();
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.list', 'read'),
      ).toEqual({ allowed: true, requiresApproval: false });
      expect(
        checkToolPolicy(team, 'frontend-engineer', 'channel.read', 'read'),
      ).toEqual({ allowed: true, requiresApproval: false });
    });

    it('channel ids are not run through the workspace-boundary check', () => {
      const team = buildTeam();
      // Pre-fix: passing `general` (or `dm:alex`) as resourcePath triggered
      // assertWorkspaceBoundary, which resolved it against workspaceRoot and
      // either rejected for escape or for being outside `apps/web`.
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

    it('self.note is always allowed even when the role does not list it', () => {
      // Per the channels-as-substrate principle: an agent must be able to
      // think to itself even if its role omits self.note from `tools`.
      const team = loadAgentTeam({
        name: 'Quiet Org',
        workspace: { root: workspaceRoot },
        providers: {
          openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
        },
        roles: [
          {
            name: 'silent-role',
            title: 'Silent',
            instructions: 'No declared tools beyond filesystem.',
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
        checkToolPolicy(team, 'silent-role', 'self.note', 'message'),
      ).toEqual({ allowed: true, requiresApproval: false });
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

    it('rejects self.note when wakeReason === mention (escape-hatch closed)', () => {
      const team = buildTeam();
      const result = checkToolPolicy(team, 'engineer', 'self.note', 'message', undefined, {
        wakeReason: 'mention',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/mandatory-reply/);
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

    it('allows self.note for non-mention wake reasons', () => {
      const team = buildTeam();
      expect(
        checkToolPolicy(team, 'engineer', 'self.note', 'message', undefined, {
          wakeReason: 'channel-read',
        }),
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
