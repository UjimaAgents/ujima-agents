import { describe, expect, it } from 'vitest';
import type { AgentLoopStep } from './agent-loop.js';
import { prepareAgentStepPublication } from './agent-step-publish.js';

describe('prepareAgentStepPublication', () => {
  it('keeps separate text parts and normalizes provider-executed file edits', async () => {
    const prepared = await prepareAgentStepPublication({
      teamRoot: process.cwd(),
      step: {
        text: 'First saved message.Second saved message.',
        content: [
          { type: 'text', text: 'First saved message.' },
          { type: 'text', text: 'Second saved message.' },
          {
            type: 'tool-call',
            toolCallId: 'patch_1',
            toolName: 'edit',
            input: '{"file_path":"src/a.ts"}',
          },
          {
            type: 'tool-result',
            toolCallId: 'patch_1',
            result: {
              status: 'completed',
              diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new',
            },
          },
        ],
      } as unknown as AgentLoopStep,
    });

    expect(prepared?.contentParts).toEqual(['First saved message.', 'Second saved message.']);
    expect(prepared?.stepToolCalls).toMatchObject([
      {
        toolCallId: 'patch_1',
        toolName: 'edit',
        args: { file_path: 'src/a.ts' },
        result: { status: 'completed', diff: expect.stringContaining('-old') },
        isError: false,
      },
    ]);
  });
});
