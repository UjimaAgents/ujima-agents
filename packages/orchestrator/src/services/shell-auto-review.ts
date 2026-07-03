import { generateText, streamText, type LanguageModel } from 'ai';
import type { NormalizedShellScope } from './shell-scope.js';

export interface ShellAutoReviewInput {
  model: LanguageModel;
  scope: NormalizedShellScope;
  memberName: string;
  roleName: string;
  policyReason?: string;
}

export interface ShellAutoReviewDecision {
  decision: 'approve' | 'escalate';
  rationale: string;
}

const REVIEW_TIMEOUT_MS = 30_000;

export class ShellAutoReviewService {
  async review(input: ShellAutoReviewInput): Promise<ShellAutoReviewDecision> {
    const command = formatShellCommand(input.scope);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
      try {
        const text = isCodexResponsesModel(input.model)
          ? await streamText({
              model: input.model,
              system: [
                'You are a security reviewer for shell commands requested by an AI agent.',
                'Respond with a single JSON object only — no markdown fences, no prose.',
                'Shape: {"decision":"approve"|"escalate","rationale":"short reason"}',
                'Approve only when the command is clearly safe, scoped, and aligned with normal development work.',
                'Escalate when the command is destructive, exfiltrates secrets, spans outside the workspace, or intent is unclear.',
                'When uncertain, escalate.',
              ].join('\n'),
              prompt: [
                `Agent: ${input.memberName}`,
                `Role: ${input.roleName}`,
                `Command: ${command}`,
                input.scope.cwd ? `Working directory: ${input.scope.cwd}` : null,
                input.policyReason ? `Policy note: ${input.policyReason}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
              maxOutputTokens: 512,
              abortSignal: controller.signal,
            }).text
          : (await generateText({
              model: input.model,
              system: [
                'You are a security reviewer for shell commands requested by an AI agent.',
                'Respond with a single JSON object only — no markdown fences, no prose.',
                'Shape: {"decision":"approve"|"escalate","rationale":"short reason"}',
                'Approve only when the command is clearly safe, scoped, and aligned with normal development work.',
                'Escalate when the command is destructive, exfiltrates secrets, spans outside the workspace, or intent is unclear.',
                'When uncertain, escalate.',
              ].join('\n'),
              prompt: [
                `Agent: ${input.memberName}`,
                `Role: ${input.roleName}`,
                `Command: ${command}`,
                input.scope.cwd ? `Working directory: ${input.scope.cwd}` : null,
                input.policyReason ? `Policy note: ${input.policyReason}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
              maxOutputTokens: 512,
              abortSignal: controller.signal,
            })).text;
        const parsed = parseReviewerJson(text);
        if (!parsed) {
          return { decision: 'escalate', rationale: 'Reviewer returned unparseable JSON' };
        }
        return parsed;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const details = describeReviewError(error);
      const message =
        typeof details.message === 'string' && details.message.length > 0
          ? details.message
          : 'Reviewer failed';
      console.info('[approval-auto-review]', {
        status: 'error',
        command,
        roleName: input.roleName,
        memberName: input.memberName,
        error: details,
      });
      return { decision: 'escalate', rationale: message };
    }
  }
}

function describeReviewError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }

  const record = error as Record<string, unknown>;
  const response = record.response as { status?: unknown; statusText?: unknown; body?: unknown } | undefined;
  const cause = record.cause as Record<string, unknown> | Error | undefined;
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    message: typeof record.message === 'string' ? record.message : String(record.message ?? ''),
    stack: typeof record.stack === 'string' ? record.stack : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : undefined,
    responseStatus: response?.status,
    responseStatusText: response?.statusText,
    responseBody: typeof response?.body === 'string' ? response.body : undefined,
    cause:
      cause instanceof Error
        ? { name: cause.name, message: cause.message }
        : cause && typeof cause === 'object'
          ? {
              name: typeof cause.name === 'string' ? cause.name : undefined,
              message: typeof cause.message === 'string' ? cause.message : undefined,
              code: typeof cause.code === 'string' ? cause.code : undefined,
            }
          : cause,
  };
}

function formatShellCommand(scope: NormalizedShellScope): string {
  if (scope.operation && scope.operation !== 'execute') {
    return `${scope.operation}${scope.job_id ? ` job=${scope.job_id}` : ''}`;
  }
  const parts = [scope.command, ...(scope.args ?? [])].filter(Boolean);
  return parts.join(' ').trim() || '(empty command)';
}

function isCodexResponsesModel(model: LanguageModel): boolean {
  const meta = model as { provider?: unknown };
  return meta.provider === 'openai.responses';
}

export function parseReviewerJson(
  raw: string,
): ShellAutoReviewDecision | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as {
      decision?: unknown;
      rationale?: unknown;
    };
    if (value.decision !== 'approve' && value.decision !== 'escalate') return null;
    return {
      decision: value.decision,
      rationale: typeof value.rationale === 'string' ? value.rationale : '',
    };
  } catch {
    return null;
  }
}
