import { describe, expect, it } from 'vitest';
import { PathEscapeError } from './workspace-root.js';
import { pathEscapeToolResult } from './tool-service.js';
import {
  ToolApprovalRequiredError,
  findToolApprovalRequiredError,
  toModelToolErrorOutput,
  toModelToolOutput,
} from './tool-loop-result.js';
import { ERR_PATH_ESCAPE } from './workspace-root.js';

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

  it('path escape tool errors include ERR_PATH_ESCAPE and do not mention rate limits', () => {
    const err = new PathEscapeError({
      requested: '../outside',
      resolved: '/tmp/outside',
      root: '/workspace',
      scopePaths: ['/workspace'],
      reason: 'workspace',
    });
    const modelError = toModelToolErrorOutput(err);
    expect(modelError.code).toBe(ERR_PATH_ESCAPE);
    expect(JSON.stringify(modelError).toLowerCase()).not.toMatch(/rate[\s_-]?limit/);

    const modelOutput = toModelToolOutput(pathEscapeToolResult(err.message));
    expect(modelOutput).toEqual({
      status: 'blocked',
      code: ERR_PATH_ESCAPE,
      error: err.message,
    });
    expect(JSON.stringify(modelOutput).toLowerCase()).not.toMatch(/rate[\s_-]?limit/);
  });
});
