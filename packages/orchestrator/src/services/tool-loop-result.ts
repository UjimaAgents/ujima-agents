import type { ToolInvocationResult } from './tool-service.js';
import { errorMessage } from '../utils/error-message.js';
import { ERR_PATH_ESCAPE, isPathEscapeError } from './workspace-root.js';
import {
  ToolApprovalRequiredError,
  ToolInputRequiredError,
  findToolApprovalRequiredError,
  findToolInputRequiredError,
} from '@ujima/agent-core';

export {
  ToolApprovalRequiredError,
  ToolInputRequiredError,
  findToolApprovalRequiredError,
  findToolInputRequiredError,
} from '@ujima/agent-core';

export function toModelToolErrorOutput(error: unknown): { error: string; code?: string } {
  const approvalError = findToolApprovalRequiredError(error);
  if (approvalError) throw approvalError;
  const inputError = findToolInputRequiredError(error);
  if (inputError) throw inputError;
  if (isPathEscapeError(error)) {
    return { error: error.message, code: ERR_PATH_ESCAPE };
  }
  return { error: errorMessage(error) };
}

export function toModelToolOutput(result: ToolInvocationResult): unknown {
  if (result.requiresApprovalId) {
    throw new ToolApprovalRequiredError(result.requiresApprovalId);
  }
  if (!result.ok) {
    if (result.output && typeof result.output === 'object') {
      return result.output;
    }
    return {
      error: result.error ?? 'tool invocation failed',
      ...(result.code ? { code: result.code } : {}),
    };
  }
  if (result.output && typeof result.output === 'object') {
    const output = result.output as Record<string, unknown>;
    if (output.status === 'waiting_for_input' && typeof output.questionId === 'string') {
      throw new ToolInputRequiredError(output.questionId);
    }
  }
  return result.output ?? { ok: true };
}
