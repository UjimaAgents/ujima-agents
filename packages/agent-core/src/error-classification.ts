// Canonical provider-error classification for the agent loop.
//
// The loop classifies provider errors once, here; downstream consumers
// (compaction-and-retry in the orchestrator, user-facing error messages)
// consume the classified result instead of re-deriving it from error
// class names, code strings, or message text on their own.
//
// Recognized "context length exceeded" signals, so provider additions land
// in one place:
//   - already-classified instances (name `ContextLengthExceededError`)
//   - the OpenAI error `code: "context_length_exceeded"` on any cause layer
//   - provider phrasings in message text: OpenAI/codex fold the code into
//     the message; deepseek says "maximum context length is N tokens ...
//     reduce the length of the messages"; ClaudeCode proxies pass through
//     "maximum context length exceeded".

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super(`Tool action requires approval: ${approvalId}`);
    this.name = 'ToolApprovalRequiredError';
  }
}

export class ToolInputRequiredError extends Error {
  constructor(readonly questionId: string) {
    super(`Tool action requires interactive user input: ${questionId}`);
    this.name = 'ToolInputRequiredError';
  }
}

export class ModelNotFoundError extends Error {
  constructor(
    readonly modelId: string,
    readonly providerKindHint: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ModelNotFoundError';
  }
}

export class SchemaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaTooLargeError';
  }
}

export class ContextLengthExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextLengthExceededError';
  }
}

export function findToolApprovalRequiredError(error: unknown): ToolApprovalRequiredError | null {
  if (error instanceof ToolApprovalRequiredError) return error;
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  if (record.name === 'ToolApprovalRequiredError' && typeof record.approvalId === 'string') {
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
  if (record.name === 'ToolInputRequiredError' && typeof record.questionId === 'string') {
    return new ToolInputRequiredError(record.questionId);
  }
  for (const key of ['cause', 'error']) {
    const nested = findToolInputRequiredError(record[key]);
    if (nested) return nested;
  }
  return null;
}

export function classifyModelError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const layers: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    layers.push(record);
    visit(record.cause);
    visit(record.error);
  };
  visit(error);
  const message = layers
    .map((layer) => layer.message)
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const url = layers
    .map((layer) => layer.url)
    .find((value): value is string => typeof value === 'string') ?? '';
  const status = layers
    .map((layer) => layer.statusCode)
    .find((value): value is number => typeof value === 'number');
  const hasApiShape = layers.some((layer) => layer.name === 'AI_APICallError') || status !== undefined;
  const hasKnownProviderMessage = /context_length_exceeded|maximum context length|reduce the length of the (messages|prompt)|too many states for serving|is not found for API version|is not supported for generateContent/i.test(message);
  const hasKnownProviderCode = layers.some((layer) => layer.code === 'context_length_exceeded');
  const hasClassifiedName = layers.some((layer) => layer.name === 'ContextLengthExceededError');
  if (!hasApiShape && !hasKnownProviderMessage && !hasKnownProviderCode && !hasClassifiedName) return null;

  if (
    status === 404 &&
    /is not found for API version|is not supported for generateContent/i.test(message)
  ) {
    const modelMatch = url.match(/models\/([^:]+):/);
    const modelId = modelMatch?.[1] ?? 'unknown';
    const providerHint = url.includes('generativelanguage.googleapis.com') ? 'google' : undefined;
    return new ModelNotFoundError(modelId, providerHint, message);
  }

  if (status === 400 && /too many states for serving/i.test(message)) {
    return new SchemaTooLargeError(message);
  }

  // Providers phrase this differently: OpenAI uses `context_length_exceeded`
  // (as a code or folded into the message); deepseek/others say "maximum
  // context length is N tokens ... reduce the length of the messages".
  // Recognize each so the compaction-and-retry hook fires instead of the
  // run just failing.
  if (
    hasClassifiedName ||
    hasKnownProviderCode ||
    /context_length_exceeded/i.test(message) ||
    /maximum context length/i.test(message) ||
    /reduce the length of the (messages|prompt)/i.test(message)
  ) {
    return new ContextLengthExceededError(message);
  }

  return null;
}

/** Canonical "is this a context-window-exceeded failure?" predicate. */
export function isContextLengthExceededError(error: unknown): boolean {
  if (error instanceof ContextLengthExceededError) return true;
  return classifyModelError(error) instanceof ContextLengthExceededError;
}