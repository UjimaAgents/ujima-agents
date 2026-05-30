import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MessageSchema, type GoalStatus, type Message, type MessageCard, type MessageToolCall } from '@ujima/shared';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';

interface ToolCallLike {
  toolName?: string;
  args?: Record<string, unknown>;
  input?: unknown;
}

const GOAL_ARTIFACT_DIR = '.ujima-goals';
const GOAL_STATUS_VALUES = ['draft', 'planning', 'in_progress', 'completed', 'failed'] as const;

export async function appendArtifactFileToolCall(
  toolCalls: readonly ToolCallLike[],
  workspaceRoot: string,
): Promise<MessageToolCall | undefined> {
  const writeCall = [...toolCalls].reverse().find(isArtifactFileWrite);
  if (!writeCall) return undefined;

  const resourcePath = artifactFileWritePath(writeCall);
  if (!resourcePath) return undefined;

  const resolvedPath = assertWorkspaceBoundary(workspaceRoot, resourcePath);
  const rootPath = existsSync(workspaceRoot) ? realpathSync(path.resolve(workspaceRoot)) : path.resolve(workspaceRoot);
  const relativePath = normalizePath(path.relative(rootPath, resolvedPath));

  // Accept any .md file in the workspace or any file under .ujima-goals/
  if (!relativePath.endsWith('.md') && !relativePath.startsWith(`${GOAL_ARTIFACT_DIR}/`)) return undefined;

  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf8');
  } catch {
    return undefined;
  }
  const card = buildArtifactFileCard(relativePath, content);

  return {
    toolCallId: randomUUID(),
    toolName: 'card.artifact.file',
    args: card as Record<string, unknown>,
    result: card,
    isError: false,
  };
}

export function buildArtifactFileMessage(input: {
  artifactFileToolCall: MessageToolCall;
  organizationId: string;
  threadId: string;
  channelId?: string | null;
  senderId: string;
  senderKind: Message['senderKind'];
  kind: Message['kind'];
  runId?: string;
  content?: string;
}): Message {
  return MessageSchema.parse({
    id: randomUUID(),
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: input.channelId ?? undefined,
    senderId: input.senderId,
    senderKind: input.senderKind,
    kind: input.kind,
    content: input.content ?? 'Artifact updated.',
    metadata: input.runId ? { runId: input.runId } : {},
    toolCalls: [input.artifactFileToolCall],
    createdAt: new Date().toISOString(),
  });
}

function isArtifactFileWrite(call: ToolCallLike): boolean {
  return artifactFileWritePath(call) !== undefined;
}

function buildArtifactFileCard(
  filePath: string,
  content: string,
): MessageCard {
  return {
    cardId: randomUUID(),
    kind: 'artifact.file',
    artifactId: filePath,
    name: path.basename(filePath, path.extname(filePath)) || 'Artifact',
    filePath,
    html: content,
    artifactFormat: inferArtifactFormat(filePath, content),
    status: inferGoalStatus(content),
  };
}

function artifactFileWritePath(call: ToolCallLike): string | undefined {
  const toolName = call.toolName?.toLowerCase();
  const resourcePath = readStringField(call, 'resourcePath');
  if (!resourcePath) return undefined;
  return toolName === 'write' || toolName === 'edit' || toolName === 'multiedit'
    ? resourcePath
    : undefined;
}

function inferArtifactFormat(filePath: string, content: string): 'html' | 'markdown' {
  if (filePath.toLowerCase().endsWith('.html')) return 'html';
  const trimmed = content.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') ? 'html' : 'markdown';
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
  const direct = payload?.[key];
  if (typeof direct === 'string') return direct;
  const nested = isRecord(payload?.input) ? payload.input[key] : undefined;
  return typeof nested === 'string' ? nested : undefined;
}

function normalizePayload(call: ToolCallLike): Record<string, unknown> | undefined {
  if (isRecord(call.args)) return call.args;
  if (isRecord(call.input)) return call.input;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
