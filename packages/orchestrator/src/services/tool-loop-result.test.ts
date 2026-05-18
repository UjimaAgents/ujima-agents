import { describe, expect, it } from 'vitest';
import {
  ToolApprovalRequiredError,
  findToolApprovalRequiredError,
  toModelToolErrorOutput,
  toModelToolOutput,
} from './tool-loop-result.js';

describe('tool loop approval control flow', () => {
  it('throws approval errors for tool results that need approval', () => {
    expect(() =>
      toModelToolOutput({
        ok: false,
        requiresApprovalId: 'approval-1',
        output: { status: 'waiting_for_approval', approvalId: 'approval-1' },
      }),
    ).toThrow(ToolApprovalRequiredError);
  });

  it('unwraps approval errors from SDK wrapper errors', () => {
    const wrapped = {
      name: 'ToolExecutionError',
      cause: {
        name: 'ToolApprovalRequiredError',
        approvalId: 'approval-1',
      },
    };

    expect(findToolApprovalRequiredError(wrapped)?.approvalId).toBe('approval-1');
  });

  it('keeps ordinary tool errors visible to the model', () => {
    expect(toModelToolErrorOutput(new Error('boom'))).toEqual({ error: 'boom' });
  });
});
