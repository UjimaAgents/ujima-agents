import { generateText, type LanguageModel } from 'ai';
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
        const { text } = await generateText({
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
          maxOutputTokens: 8_000,
          abortSignal: controller.signal,
        });

        const parsed = parseReviewerJson(text);
        if (!parsed) {
          return { decision: 'escalate', rationale: 'Reviewer returned unparseable JSON' };
        }
        return parsed;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reviewer failed';
      return { decision: 'escalate', rationale: message };
    }
  }
}

function formatShellCommand(scope: NormalizedShellScope): string {
  if (scope.operation && scope.operation !== 'execute') {
    return `${scope.operation}${scope.job_id ? ` job=${scope.job_id}` : ''}`;
  }
  const parts = [scope.command, ...(scope.args ?? [])].filter(Boolean);
  return parts.join(' ').trim() || '(empty command)';
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
