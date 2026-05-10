import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { buildAgentSystemPrompt, createAgent, defineRole } from './index.js';

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
    );

    expect(system).toContain(`Workspace root: ${root}`);
    expect(system).toContain('## Workspace Layout');
    expect(system).toContain('- backend');
    expect(system).toContain('- cli');
    expect(system).toContain('- frontend');
    expect(system).not.toContain('apps/frontend');
    expect(system).toContain('Use these names first when choosing a shell cwd or repo path.');
    expect(system).toContain('Allowed scopes: frontend');
    expect(system).toContain('For DM chats, use the other person\'s member id as the conversation reference.');
  });
});
