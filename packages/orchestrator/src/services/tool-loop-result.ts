import type { ToolInvocationResult } from './tool-service.js';
import { errorMessage } from '../utils/error-message.js';
import { ERR_PATH_ESCAPE, isPathEscapeError } from './workspace-root.js';

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super('Tool action requires approval');
    this.name = 'ToolApprovalRequiredError';
  }
}

export class ToolInputRequiredError extends Error {
  constructor(readonly questionId: string) {
    super('Tool action requires interactive user input');
    this.name = 'ToolInputRequiredError';
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

export function findToolInputRequiredError(error: unknown): ToolInputRequiredError | null {
  if (error instanceof ToolInputRequiredError) return error;
  if (!error || typeof error !== 'object') return null;

  const record = error as Record<string, unknown>;
  if (
    record.name === 'ToolInputRequiredError' &&
    typeof record.questionId === 'string'
  ) {
    return new ToolInputRequiredError(record.questionId);
  }

  for (const key of ['cause', 'error']) {
    const nested = findToolInputRequiredError(record[key]);
    if (nested) return nested;
  }

  return null;
}

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
