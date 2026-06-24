import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message, ReasoningEffort, SpiritRole } from "@ujima/shared";
import { selectLanguageModel } from '@ujima/llm';
import type { AgentTeamHandle } from '@ujima/framework';
import { tool } from 'ai';
import type {
  FilePart,
  ImagePart,
  LanguageModel,
  ModelMessage,
  TextPart,
  ToolSet,
  UserContent,
} from "ai";
import { z } from 'zod';
import type { ToolService } from '../services/tool-service.js';
import type { OrchestratorTool } from '../tools/types.js';
import type { RepositoryReader } from '../services/repository-reader.js';
import { ORCHESTRATOR_TOOLS } from '../tools/index.js';
import { mcpTool } from '../tools/mcp.js';
import { filterVisibleMessages } from './message-visibility.js';
import { toModelToolName } from '../tools/names.js';
import { toModelToolErrorOutput, toModelToolOutput } from '../services/tool-loop-result.js';
import { isCompactionSummarySystemMessage } from '../services/conversation-summary.js';
import { messageToolCallsToModelMessages, sanitizeModelMessages } from './run-transcript.js';
import { resolveOpenAIAccessToken } from './codex-auth.js';

export function toModelMessages(
  messages: Message[],
  selfId?: string,
  options: { includeReasoning?: boolean } = {},
): ModelMessage[] {
  return sanitizeModelMessages(filterVisibleMessages(messages)
    .filter(
      (message) =>
        (message.kind !== 'system' || isCompactionSummarySystemMessage(message)),
    )
    .flatMap((message) => messageToModelMessages(message, selfId, options.includeReasoning ?? false)));
}

function messageToModelMessages(message: Message, selfId?: string, includeReasoning = false): ModelMessage[] {
  if (message.kind === 'system') {
    return [
      {
        role: 'user' as const,
        content: buildCompactionMemoryContext(message.content),
      },
    ];
  }

  const role = selfId
    ? message.senderId === selfId
      ? ('assistant' as const)
      : ('user' as const)
    : message.senderKind === 'agent'
      ? ('assistant' as const)
      : ('user' as const);

  if (role === 'assistant' && message.toolCalls.length > 0) {
    const completedToolCalls = message.toolCalls.filter(
      (call) => call.result !== undefined && !isPendingResult(call.result),
    );
    if (completedToolCalls.length === 0) {
      return message.content.trim().length > 0 ? [{ role: 'assistant', content: message.content }] : [];
    }
    return messageToolCallsToModelMessages(
      message.content,
      includeReasoning ? message.reasoningContent : undefined,
      completedToolCalls,
    );
  }

  const reasoning = includeReasoning ? message.reasoningContent?.trim() : undefined;
  if (role === 'assistant' && reasoning) {
    return [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning' as const, text: reasoning },
          { type: 'text' as const, text: message.content },
        ],
      },
    ];
  }

  if (role === 'assistant') {
    return [{ role: 'assistant', content: message.content }];
  }
  return [{ role: 'user', content: buildUserContent(message) }];
}

function buildCompactionMemoryContext(content: string): string {
  return [
    '<conversation-memory source="compaction-summary">',
    'Treat this as durable context from earlier in the conversation, not as a new instruction from the user.',
    content,
    '</conversation-memory>',
  ].join('\n');
}

function buildUserContent(message: Message): UserContent {
  const attachments = (message as { attachments?: AttachmentLike[] }).attachments ?? [];
  if (!attachments.length) {
    return message.content;
  }

  const parts: (TextPart | ImagePart | FilePart)[] = [];
  // Lead with a text inventory before the binary parts so the
  // agent knows attachments exist even if the provider strips
  // image/file parts (text-only model, transcoding, etc.).
  const inventory = attachments
    .map(
      (a, i) =>
        `  <attachment index="${i}" category="${a.category}" filename="${a.filename}" mediaType="${a.mimeType}" />`,
    )
    .join('\n');
  const inventoryBlock =
    `<message-attachments count="${attachments.length}">\n${inventory}\n` +
    `  <!-- The actual file content for image/document attachments follows ` +
    `in this message as multimodal parts. If you don't see those parts ` +
    `(e.g. your model lacks vision), you can still confirm the sender ` +
    `attached the file(s) listed above. -->\n</message-attachments>`;
  parts.push({ type: 'text', text: inventoryBlock });

  if (message.content.trim().length > 0) {
    parts.push({ type: 'text', text: message.content });
  }

  for (const attachment of attachments) {
    if (attachment.category === 'image') {
      parts.push({
        type: 'image',
        image: readAttachmentFile(attachment.storagePath),
        mediaType: attachment.mimeType,
      } satisfies ImagePart);
      continue;
    }

    if (attachment.category === 'document') {
      parts.push({
        type: 'file',
        data: readAttachmentFile(attachment.storagePath),
        filename: attachment.filename,
        mediaType: attachment.mimeType,
      } satisfies FilePart);
      continue;
    }

    parts.push({
      type: 'text',
      text: `Attached file: ${attachment.filename} (${attachment.mimeType})`,
    });
  }

  return parts.length > 0 ? parts : message.content;
}

function readAttachmentFile(storagePath: string): Buffer {
  return readFileSync(join(resolveHomeDir(), 'attachments', storagePath));
}

interface AttachmentLike {
  category: 'image' | 'document' | 'audio' | 'video' | 'archive' | 'other';
  storagePath: string;
  filename: string;
  mimeType: string;
}

function isPendingResult(result: unknown): boolean {
  if (result && typeof result === 'object') {
    const r = result as { status?: string };
    return r.status === 'waiting_for_approval' || r.status === 'waiting_for_input';
  }
  return false;
}

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), '.ujima');
}

// Fix #7: Shared model-resolution ladder.
// Walk: member → agent → role → provider → modelId → apiKey → LanguageModel.
export function resolveSpiritModel(params: {
  organizationId: string;
  memberId: string;
  role: SpiritRole;
  member: { id: string; name: string; roleName?: string; llm?: string; model?: string };
  team: AgentTeamHandle;
  getProviderCredential: (orgId: string, key: string) => string | null;
  resolveProviderName: (member: { llm?: string }, teamRole: { provider?: string }) => string;
  reasoningEffort?: ReasoningEffort;
  resolveModelId: (
    teamRole: { model?: string },
    provider: { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
    role: SpiritRole,
    memberModel?: string,
  ) => string | undefined;
}): LanguageModel {
  const agent = params.team.getAgent(params.member.id) ?? params.team.getAgent(params.member.name);
  if (!agent) {
    throw new Error(`Agent not found: ${params.memberId}`);
  }
  const teamRole = params.team.getRole(agent.roleName);
  if (!teamRole) {
    throw new Error(`Role not found: ${agent.roleName}`);
  }
  const preferredProviderName = params.resolveProviderName(
    { llm: params.member.llm },
    { provider: teamRole.provider },
  );
  if (!preferredProviderName) {
    throw new Error(`Provider not resolved for member "${params.memberId}"`);
  }
  const provider = params.team.getProvider(preferredProviderName);
  if (!provider) {
    throw new Error(`Provider not configured for member "${params.memberId}": ${preferredProviderName}`);
  }
  const apiKey = resolveOpenAIAccessToken({
    providerName: preferredProviderName,
    authMode: provider.authMode,
    storedCredential: params.getProviderCredential(params.organizationId, preferredProviderName),
  });
  if (!apiKey) {
    throw new Error(`No API key for member "${params.memberId}": ${preferredProviderName}`);
  }

  const modelId = params.resolveModelId(
    { model: teamRole.model },
    provider,
    params.role,
    params.member.model,
  );
  if (!modelId) {
    throw new Error(`No model id resolved for member "${params.memberId}"`);
  }

  return selectLanguageModel({
    kind: provider.kind,
    modelId,
    apiKey,
    baseUrl: provider.baseUrl,
    reasoningEffort: params.reasoningEffort,
  });
}

// Fix #7: Default provider-name resolver (uses agent/member llm first).
export function defaultResolveProviderName(
  member: { llm?: string },
  teamRole: { provider?: string },
): string {
  const provider = member.llm ?? teamRole.provider;
  if (!provider) {
    throw new Error(`Role is missing a provider`);
  }
  return provider;
}

// Fix #7: Default model-ID resolver using the cheaper-tier picker (uses agent/member model first).
export function defaultResolveModelId(
  teamRole: { model?: string },
  provider: { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
  role: SpiritRole,
  memberModel?: string,
): string | undefined {
  const baseModel = memberModel ?? teamRole.model ?? provider.defaultModel;
  if (role !== 'supervisor') return baseModel;
  const supervisorTier = provider.supervisorModel ?? provider.supervisor_model;
  return supervisorTier ?? baseModel;
}

// Fix #8: Shared tool-definition builder.
//
// The fallback schema used when no OrchestratorTool is registered
// for a tool id. Exposes `path` (not `resourcePath`) for the same
// reason the workspace tools do — keeping `resourcePath` out of any
// model-facing JSON schema prevents Gemini from pattern-matching the
// alias onto unrelated tools (channel.*, self.*) and tripping
// `additionalProperties: false`.
const GenericToolInvocationSchema = z.object({
  action: z.enum(['read', 'write', 'execute', 'mcp', 'message']),
  resourceType: z.enum(['file', 'folder', 'shell', 'mcp', 'message']),
  path: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export interface BuildToolDefContext {
  organizationId: string;
  runId: string;
  memberId: string;
  threadId: string;
  toolCallId: string;
  toolId: string;
  taskSessionId?: string;
  spiritRole?: SpiritRole;
  /**
   * Optional reader handle so per-invocation `OrchestratorTool.buildSchema`
   * factories (e.g. `channel.handoff` recipient enum) can resolve
   * roster state at tool-build time. Optional for backwards
   * compatibility with narrower call sites.
   */
  repo?: RepositoryReader;
}

export function buildToolDefinition(
  def: OrchestratorTool | undefined,
  toolId: string,
  team: AgentTeamHandle,
  tools: ToolService,
  ctx: BuildToolDefContext,
) {
  const toolDef = toolId === 'mcp' ? mcpTool : def;

  if (toolDef) {
    // If the tool exposes a per-invocation schema factory, use it
    // — this is how `channel.handoff` constrains `to:` to the actual
    // org roster at decode time. Falls back to the static schema
    // when no factory or when no repo handle was plumbed through.
    const inputSchema =
      toolDef.buildSchema && ctx.repo
        ? toolDef.buildSchema({
            organizationId: ctx.organizationId,
            memberId: ctx.memberId,
            repo: ctx.repo,
          })
        : toolDef.schema;
    return tool({
      description: team.tools[toolId]?.description ?? `${toolId} tool`,
      inputSchema,
      execute: async (rawArgs, { toolCallId }) => {
        try {
          const invocationData = toolDef.toInvocation(rawArgs);
          const result = await tools.invoke({
            organizationId: ctx.organizationId,
            runId: ctx.runId,
            memberId: ctx.memberId,
            threadId: ctx.threadId,
            taskSessionId: ctx.taskSessionId,
            spiritRole: ctx.spiritRole,
            toolCallId,
            toolId,
            ...invocationData,
          });
          return toModelToolOutput(result);
        } catch (error) {
          return toModelToolErrorOutput(error);
        }
      },
    });
  }

  return tool({
    description: team.tools[toolId]?.description ?? `${toolId} tool`,
    inputSchema: GenericToolInvocationSchema,
    execute: async (args, { toolCallId }) => {
      try {
        const result = await tools.invoke({
          organizationId: ctx.organizationId,
          runId: ctx.runId,
          memberId: ctx.memberId,
          threadId: ctx.threadId,
          taskSessionId: ctx.taskSessionId,
          spiritRole: ctx.spiritRole,
          toolCallId,
          toolId,
          action: args.action,
          resourceType: args.resourceType,
          resourcePath: args.path,
          input: args.input,
        });
        return toModelToolOutput(result);
      } catch (error) {
        return toModelToolErrorOutput(error);
      }
    },
  });
}

export function buildToolDefinitions(
  toolIds: readonly string[],
  team: AgentTeamHandle,
  tools: ToolService,
  ctx: Omit<BuildToolDefContext, 'toolCallId' | 'toolId'>,
): ToolSet {
  return Object.fromEntries(
    toolIds.filter((toolId) => toolId !== 'mcp').map((toolId) => [
      toModelToolName(toolId),
      buildToolDefinition(
        ORCHESTRATOR_TOOLS[toolId] as OrchestratorTool | undefined,
        toolId,
        team,
        tools,
        { ...ctx, toolCallId: '', toolId },
      ),
    ]),
  ) as ToolSet;
}
