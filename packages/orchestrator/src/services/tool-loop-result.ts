import type { ToolInvocationResult } from './tool-service.js';
import { errorMessage } from '../utils/error-message.js';
import { ERR_PATH_ESCAPE, isPathEscapeError } from './workspace-root.js';

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super('Tool action requires approval');
    this.name = 'ToolApprovalRequiredError';
  }
}

export function findToolApprovalRequiredError(error: unknown): ToolApprovalRequiredError | null {
  if (error instanceof ToolApprovalRequiredError) return error;
  if (!error || typeof error !== 'object') return null;

  const record = error as Record<string, unknown>;
  if (
    record.name === 'ToolApprovalRequiredError' &&
    typeof record.approvalId === 'string'
  ) {
    return new ToolApprovalRequiredError(record.approvalId);
  }

  for (const key of ['cause', 'error']) {
    const nested = findToolApprovalRequiredError(record[key]);
    if (nested) return nested;
  }

  return null;
}

export function toModelToolErrorOutput(error: unknown): { error: string; code?: string } {
  const approvalError = findToolApprovalRequiredError(error);
  if (approvalError) throw approvalError;
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
  return result.output ?? { ok: true };
}
