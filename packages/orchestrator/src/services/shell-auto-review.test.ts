import type { LanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { ShellAutoReviewService } from './shell-auto-review.js';

function mockTextModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 }, totalTokens: 2 },
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

describe('ShellAutoReviewService', () => {
  const service = new ShellAutoReviewService();

  it('approves when reviewer returns approve JSON', async () => {
    const model = mockTextModel('{"decision":"approve","rationale":"Read-only listing"}');
    const result = await service.review({
      model,
      scope: { cwd: '.', command: 'ls', args: ['-la'] },
      memberName: 'Alex',
      roleName: 'engineer',
    });
    expect(result.decision).toBe('approve');
    expect(result.rationale).toContain('Read-only');
  });

  it('escalates on bad JSON', async () => {
    const model = mockTextModel('not json');
    const result = await service.review({
      model,
      scope: { cwd: '.', command: 'rm', args: ['-rf', '/'] },
      memberName: 'Alex',
      roleName: 'engineer',
    });
    expect(result.decision).toBe('escalate');
  });

  it('escalates when reviewer chooses escalate', async () => {
    const model = mockTextModel('{"decision":"escalate","rationale":"Destructive command"}');
    const result = await service.review({
      model,
      scope: { command: 'curl', args: ['https://evil.example'] },
      memberName: 'Alex',
      roleName: 'engineer',
    });

    expect(result.decision).toBe('escalate');
    expect(result.rationale).toContain('Destructive');
  });
});
