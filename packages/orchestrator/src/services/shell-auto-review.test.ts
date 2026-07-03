import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText, streamText } from 'ai';
import { ShellAutoReviewService } from './shell-auto-review.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

describe('ShellAutoReviewService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses streamText for Codex responses models', async () => {
    vi.mocked(streamText).mockReturnValue({
      text: Promise.resolve('{"decision":"approve","rationale":"safe"}'),
    } as never);
    vi.mocked(generateText).mockRejectedValue(new Error('should not call generateText'));

    const service = new ShellAutoReviewService();
    const result = await service.review({
      model: { provider: 'openai.responses' } as never,
      scope: {
        cwd: '/workspace',
        command: 'pwd',
        args: [],
      } as never,
      memberName: 'Agent',
      roleName: 'Engineer',
    });

    expect(result).toEqual({ decision: 'approve', rationale: 'safe' });
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });
});
