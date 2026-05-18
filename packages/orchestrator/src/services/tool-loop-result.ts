import type { ToolInvocationResult } from './tool-service.js';
import { errorMessage } from '../utils/error-message.js';

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

export function toModelToolErrorOutput(error: unknown): { error: string } {
  const approvalError = findToolApprovalRequiredError(error);
  if (approvalError) throw approvalError;
  return { error: errorMessage(error) };
}

export function toModelToolOutput(result: ToolInvocationResult): unknown {
  if (result.requiresApprovalId) {
    throw new ToolApprovalRequiredError(result.requiresApprovalId);
  }
  if (!result.ok) {
    return result.output ?? { error: result.error ?? 'tool invocation failed' };
  }
  return result.output ?? { ok: true };
}
