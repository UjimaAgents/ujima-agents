import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText, streamText } from 'ai';
import { planAssignments } from './plan.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

describe('planAssignments', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses streamText for Codex responses models', async () => {
    vi.mocked(streamText).mockReturnValue({
      text: Promise.resolve(JSON.stringify({
        assignments: [
          { agentId: 'agent-1', subprompt: 'Do the task.' },
        ],
      })),
    } as never);
    vi.mocked(generateText).mockRejectedValue(new Error('should not call generateText'));

    const result = await planAssignments({
      task: { prompt: 'Ship it.' } as never,
      agents: [
        {
          id: 'agent-1',
          name: 'Agent 1',
          mcp: 'default',
          seniority: 'senior',
          persona: 'Builder',
          permissions: { allowed_tools: [] },
        } as never,
      ],
      model: { provider: 'openai.responses' } as never,
    });

    expect(result.assignments).toEqual([
      { agentId: 'agent-1', subprompt: 'Do the task.', reason: undefined, dependsOn: undefined },
    ]);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });
});
