import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
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
    expect(system).toContain('For DM chats, use the other person\'s member id as the conversation reference.');
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
    );

    expect(system).toContain('You are Phoebe Hunter, an employee of Ujima Demo, acting as QA Engineer (qa-engineer).');
    expect(system).toContain(`- Ivy Brooks | qa-engineer | ${getPersonalityPreset('skeptical')?.title ?? 'Skeptical'} | agent | joined 2026-05-04`);
  });
});
