import type { ToolInvocationResult } from './tool-service.js';

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super('Tool action requires approval');
    this.name = 'ToolApprovalRequiredError';
  }
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

