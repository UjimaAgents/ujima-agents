export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = causeMessage(error);
    if (cause) return cause;
    return error.message || 'Unknown error';
  }
  return String(error);
}

function causeMessage(error: Error): string | null {
  if (error.name === 'ContextLengthExceededError') {
    return `Context window exceeded — the conversation is too long for this model. Try archiving the conversation or switching to a model with a larger context window.`;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return causeMessage(cause);
  }
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    if (typeof record.message === 'string' && typeof record.code === 'string') {
      if (record.code === 'context_length_exceeded') {
        return `Context window exceeded — the conversation is too long for this model. Try archiving the conversation or switching to a model with a larger context window.`;
      }
      return `${record.code}: ${record.message}`;
    }
  }
  return null;
}
