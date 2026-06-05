import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { type GoalStatus, type Message, type MessageCard, type MessageToolCall } from '@ujima/shared';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { buildArtifactMessage } from './message-factory.js';

interface ToolCallLike {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  input?: unknown;
}

interface ToolResultLike {
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
}

const GOAL_ARTIFACT_DIR = '.ujima-goals';

// Maps both the canonical GoalStatus values and a few legacy aliases
// that historically appeared in agent-authored goal docs.
const GOAL_STATUS_ALIASES: Record<string, GoalStatus> = {
  draft: 'planning',
  planning: 'planning',
  in_progress: 'running',
  running: 'running',
  completed: 'completed',
  suspended: 'suspended',
  failed: 'cancelled',
  cancelled: 'cancelled',
};

const GOAL_STATUS_PATTERN = Object.keys(GOAL_STATUS_ALIASES).join('|');
const GOAL_STATUS_INLINE_RE = new RegExp(
  `(?:^|\\n)[\\s-*]*status[\\s-*]*[:=]\\s*[*_]*(${GOAL_STATUS_PATTERN})\\b`,
);
const GOAL_STATUS_META_RE = new RegExp(
  `<meta[^>]+name=["']goal-status["'][^>]+content=["'](${GOAL_STATUS_PATTERN})["']`,
);

export async function appendArtifactFileToolCall(
  toolCalls: readonly ToolCallLike[],
  workspaceRoot: string,
  toolResults: readonly ToolResultLike[] = [],
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
  const card = buildArtifactFileCard(relativePath, content, findDiffForCall(writeCall, toolResults));

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
  runId?: string;
  content?: string;
}): Message {
  return buildArtifactMessage({
    artifactFileToolCall: input.artifactFileToolCall,
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: input.channelId,
    senderId: input.senderId,
    content: input.content ?? 'Artifact updated.',
    runId: input.runId,
  });
}

function isArtifactFileWrite(call: ToolCallLike): boolean {
  return artifactFileWritePath(call) !== undefined;
}

function buildArtifactFileCard(
  filePath: string,
  content: string,
  diff?: string,
): MessageCard {
  return {
    cardId: randomUUID(),
    kind: 'artifact.file',
    artifactId: filePath,
    name: path.basename(filePath, path.extname(filePath)) || 'Artifact',
    filePath,
    html: content,
    ...(diff ? { diff } : {}),
    artifactFormat: inferArtifactFormat(filePath, content),
    status: inferGoalStatus(content),
  };
}

function findDiffForCall(call: ToolCallLike, toolResults: readonly ToolResultLike[]): string | undefined {
  if (!call.toolCallId) return undefined;
  const match = toolResults.find((result) => result.toolCallId === call.toolCallId);
  return readDiff(match?.output) ?? readDiff(match?.result);
}

function readDiff(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const direct = value.diff;
  if (typeof direct === 'string' && direct.trim()) return direct.trimEnd();
  return readDiff(value.result) ?? readDiff(value.output);
}

function artifactFileWritePath(call: ToolCallLike): string | undefined {
  const toolName = call.toolName?.toLowerCase();
  const resourcePath = readStringField(call, 'resourcePath') ?? readStringField(call, 'file_path');
  if (!resourcePath) return undefined;
  if (toolName === 'write' || toolName === 'edit' || toolName === 'multiedit') return resourcePath;
  return readStringField(call, 'action') === 'write' ? resourcePath : undefined;
}

function inferArtifactFormat(filePath: string, content: string): 'html' | 'markdown' {
  if (filePath.toLowerCase().endsWith('.html')) return 'html';
  const trimmed = content.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') ? 'html' : 'markdown';
}

function inferGoalStatus(content: string): GoalStatus {
  const lower = content.toLowerCase();
  const match = lower.match(GOAL_STATUS_INLINE_RE)?.[1] ?? lower.match(GOAL_STATUS_META_RE)?.[1];
  return match !== undefined ? (GOAL_STATUS_ALIASES[match] ?? 'running') : 'running';
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
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
