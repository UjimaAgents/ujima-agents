import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { GoalStatus, MessageCard, MessageToolCall } from '@ujima/shared';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';

interface ToolCallLike {
  toolName?: string;
  args?: Record<string, unknown>;
  input?: unknown;
}

const GOAL_ARTIFACT_DIR = '.ujima-goals';
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const GOAL_STATUS_VALUES = ['draft', 'planning', 'in_progress', 'completed', 'failed'] as const;

export async function appendGoalArtifactToolCall(
  toolCalls: readonly ToolCallLike[],
  workspaceRoot: string,
): Promise<MessageToolCall | undefined> {
  const writeCall = [...toolCalls].reverse().find(isGoalArtifactWrite);
  if (!writeCall) return undefined;

  const resourcePath = readStringField(writeCall, 'resourcePath');
  if (!resourcePath) return undefined;

  const resolvedPath = assertWorkspaceBoundary(workspaceRoot, resourcePath);
  const relativePath = normalizePath(path.relative(path.resolve(workspaceRoot), resolvedPath));
  if (!relativePath.startsWith(`${GOAL_ARTIFACT_DIR}/`)) return undefined;

  const html = await readFile(resolvedPath, 'utf8');
  const artifactFormat = MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) ? 'markdown' : 'html';
  const card = buildGoalArtifactCard(relativePath, html, artifactFormat);

  return {
    toolCallId: randomUUID(),
    toolName: 'card.goal.file',
    args: card as Record<string, unknown>,
    result: card,
    isError: false,
  };
}

function isGoalArtifactWrite(call: ToolCallLike): boolean {
  return call.toolName === 'filesystem' && readStringField(call, 'action') === 'write';
}

function buildGoalArtifactCard(
  goalFilePath: string,
  html: string,
  artifactFormat: 'html' | 'markdown',
): MessageCard {
  return {
    cardId: randomUUID(),
    kind: 'goal.file',
    goalId: goalFilePath,
    goalName: path.basename(goalFilePath, path.extname(goalFilePath)) || 'Goal',
    goalFilePath,
    html,
    artifactFormat,
    status: inferGoalStatus(html),
  };
}

function inferGoalStatus(content: string): GoalStatus {
  const lower = content.toLowerCase();
  const match =
    lower.match(/(?:^|\n)\s*status\s*[:=]\s*(draft|planning|in_progress|completed|failed)\b/)?.[1] ??
    lower.match(/<meta[^>]+name=["']goal-status["'][^>]+content=["'](draft|planning|in_progress|completed|failed)["']/)?.[1];
  return isGoalStatus(match) ? match : 'in_progress';
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isGoalStatus(value: string | undefined): value is GoalStatus {
  return !!value && GOAL_STATUS_VALUES.includes(value as (typeof GOAL_STATUS_VALUES)[number]);
}

function readStringField(call: ToolCallLike, key: string): string | undefined {
  const payload = normalizePayload(call);
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function normalizePayload(call: ToolCallLike): Record<string, unknown> | undefined {
  if (isRecord(call.args)) return call.args;
  if (isRecord(call.input)) return call.input;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
