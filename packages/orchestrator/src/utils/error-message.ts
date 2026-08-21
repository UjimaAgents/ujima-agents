// Thin shim: classification lives in @ujima/agent-core's error-classification
// (owned by the agent loop). This module only renders messages and must keep
// its exported `errorMessage` signature stable.

import { isContextLengthExceededError } from '@ujima/agent-core';

const CONTEXT_WINDOW_EXCEEDED_MESSAGE =
  'Context window exceeded — the conversation is too long for this model. Try archiving the conversation or switching to a model with a larger context window.';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = causeMessage(error);
    if (cause) return cause;
    return error.message || 'Unknown error';
  }
  return String(error);
}

function causeMessage(error: Error): string | null {
  if (isContextLengthExceededError(error)) {
    return CONTEXT_WINDOW_EXCEEDED_MESSAGE;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return causeMessage(cause);
  }
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    if (typeof record.message === 'string' && typeof record.code === 'string') {
      return `${record.code}: ${record.message}`;
    }
  }
  return null;
}