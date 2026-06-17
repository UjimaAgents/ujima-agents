import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAgentSystemPrompt, createAgent, defineRole, getPersonalityPreset } from './index.js';

describe('buildAgentSystemPrompt', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('includes the root-level workspace directories in the prompt', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-prompt-'));
    await mkdir(join(root, 'frontend'));
    await mkdir(join(root, 'backend'));
    await mkdir(join(root, 'cli'));

    const agent = createAgent('frontend-alice', 'frontend-engineer', 'thoughtful');
    const pmAgent = createAgent('pm', 'pm', 'direct');
    const role = defineRole({
      name: 'frontend-engineer',
      title: 'Frontend Engineer',
      instructions: 'Build the frontend.',
      workspaceScopes: ['frontend'],
      tools: ['filesystem', 'shell'],
      channels: ['general'],
    });
    const system = buildAgentSystemPrompt(
      root,
      'Ujima Demo',
      'frontend-alice',
      'Frontend Alice',
      'thread-1',
      agent,
      role,
      [
        { id: 'pm', name: 'PM', roleName: 'pm', kind: 'agent', createdAt: '2026-05-04T00:00:00.000Z' },
        { id: 'frontend-alice', name: 'Frontend Alice', roleName: 'frontend-engineer', kind: 'agent', createdAt: '2026-05-04T00:00:00.000Z' },
      ] as never,
      [pmAgent, agent] as never,
      [
        { id: 'general', name: 'general', kind: 'general' },
      ] as never,
      { reportsTo: { 'frontend-alice': 'pm' } },
      undefined,
    );

    expect(system).toContain(`Workspace root: ${root}`);
    expect(system).toContain('## Workspace Layout');
    expect(system).toContain('- backend');
    expect(system).toContain('- cli');
    expect(system).toContain('- frontend');
    expect(system).not.toContain('apps/frontend');
    expect(system).toContain('Use these names first when choosing a shell cwd or repo path.');
    expect(system).toContain('Use grep, ls, and glob to find files and lines first.');
    expect(system).toContain('Background shell commands return a job id');
    expect(system).toContain('Allowed scopes: frontend');
    expect(system).toContain(
      'channel.read: channel id/name from the list above; DMs use dm_thread_id or peer member_id from channel.list.',
    );
  });

  it('uses the member display name for the current agent prompt', () => {
    const agent = createAgent('6609c516-a42a-454a-a038-3cb5bc82d046', 'qa-engineer', 'direct');
    const role = defineRole({
      name: 'qa-engineer',
      title: 'QA Engineer',
      instructions: 'Test the product.',
    });
    const system = buildAgentSystemPrompt(
      '.',
      'Ujima Demo',
      '6609c516-a42a-454a-a038-3cb5bc82d046',
      'Phoebe Hunter',
      'thread-1',
      agent,
      role,
      [
        { id: 'ivy', name: 'Ivy Brooks', roleName: 'qa-engineer', kind: 'agent', createdAt: '2026-05-04T00:00:00.000Z' },
      ] as never,
      [agent, createAgent('ivy', 'qa-engineer', 'skeptical')] as never,
      [] as never,
      { reportsTo: {} },
      undefined,
    );

    expect(system).toContain('You are Phoebe Hunter, an employee of Ujima Demo, acting as QA Engineer (qa-engineer).');
    expect(system).toContain(`- Ivy Brooks | qa-engineer | ${getPersonalityPreset('skeptical')?.title ?? 'Skeptical'} | agent | joined 2026-05-04`);
  });

  it('produces the same prompt for shuffled catalog inputs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T09:33:54.464Z'));

    try {
      const agent = createAgent('alice', 'engineer', 'direct');
      const role = defineRole({
        name: 'engineer',
        title: 'Engineer',
        instructions: 'Build.',
        skills: ['zeta', 'alpha'],
      });
      const members = [
        { id: 'b', name: 'Bob', roleName: 'engineer', kind: 'agent', createdAt: '2026-05-04T00:00:00.000Z' },
        { id: 'a', name: 'Ada', roleName: 'engineer', kind: 'agent', createdAt: '2026-05-04T00:00:00.000Z' },
      ] as never;
      const agents = [
        createAgent('bob', 'engineer', 'direct'),
        createAgent('ada', 'engineer', 'thoughtful'),
      ] as never;
      const channels = [
        { id: 'z', name: 'zeta', kind: 'public' },
        { id: 'a', name: 'alpha', kind: 'public' },
      ] as never;
      const servers = [
        { name: 'zeta', toolNames: ['write', 'read'] },
        { name: 'alpha', toolNames: ['stop', 'start'] },
      ];
      const build = (
        memberInput: typeof members,
        agentInput: typeof agents,
        channelInput: typeof channels,
        toolInput: string[],
        serverInput: typeof servers,
      ) =>
        buildAgentSystemPrompt(
          '.',
          'Ujima Demo',
          'alice',
          'Alice',
          'thread-1',
          agent,
          role,
          memberInput,
          agentInput,
          channelInput,
          { reportsTo: {} },
          undefined,
          toolInput,
          serverInput,
        );

      expect(build(members, agents, channels, ['z-tool', 'a-tool'], servers)).toBe(
        build(
          [...members].reverse() as never,
          [...agents].reverse() as never,
          [...channels].reverse() as never,
          ['a-tool', 'z-tool'],
          [...servers].reverse().map((server) => ({
            ...server,
            toolNames: [...server.toolNames].reverse(),
          })),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads and injects workspace rules files (Agents.md, cursor.md, model-specific files) recursively', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-prompt-rules-'));
    
    // Create nested directory structure
    const nestedDir = join(root, 'src', 'nested');
    await mkdir(join(root, '.agents'), { recursive: true });
    await mkdir(nestedDir, { recursive: true });
    await mkdir(join(nestedDir, '.agents'), { recursive: true });

    // Write mock rules files at different levels
    await writeFile(join(root, 'Agents.md'), 'General agent behavior rules.');
    await writeFile(join(nestedDir, 'cursor.md'), 'Cursor specific editor instructions.');
    await writeFile(join(nestedDir, '.agents', 'claude.md'), 'Claude-only guidelines.');
    await writeFile(join(root, '.agents', 'gemini.md'), 'Gemini-only guidelines.');

    const agent = createAgent('frontend-alice', 'frontend-engineer', 'thoughtful');
    const role = defineRole({
      name: 'frontend-engineer',
      title: 'Frontend Engineer',
      instructions: 'Build the frontend.',
    });

    // Test with Claude model
    const systemClaude = buildAgentSystemPrompt(
      root,
      'Ujima Demo',
      'frontend-alice',
      'Frontend Alice',
      'thread-1',
      agent,
      role,
      [] as never,
      [] as never,
      [] as never,
      { reportsTo: {} },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { provider: 'anthropic', modelId: 'claude-3-5-sonnet' }
    );

    expect(systemClaude).toContain('## Workspace Rules');
    expect(systemClaude).toContain('### Agent Guidelines (Agents.md)\nGeneral agent behavior rules.');
    expect(systemClaude).toContain('### Editor Guidelines (cursor.md)\nCursor specific editor instructions.');
    expect(systemClaude).toContain('### Model-Specific Guidelines (claude.md)\nClaude-only guidelines.');
    expect(systemClaude).not.toContain('gemini.md');

    // Test with Gemini model
    const systemGemini = buildAgentSystemPrompt(
      root,
      'Ujima Demo',
      'frontend-alice',
      'Frontend Alice',
      'thread-1',
      agent,
      role,
      [] as never,
      [] as never,
      [] as never,
      { reportsTo: {} },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { provider: 'google', modelId: 'gemini-2.5-flash' }
    );

    expect(systemGemini).toContain('## Workspace Rules');
    expect(systemGemini).toContain('### Agent Guidelines (Agents.md)\nGeneral agent behavior rules.');
    expect(systemGemini).toContain('### Editor Guidelines (cursor.md)\nCursor specific editor instructions.');
    expect(systemGemini).toContain('### Model-Specific Guidelines (gemini.md)\nGemini-only guidelines.');
    expect(systemGemini).not.toContain('claude.md');
  });
});
