import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message, SpiritRole } from "@ujima/shared";
import { selectLanguageModel } from '@ujima/llm';
import type { AgentTeamHandle } from '@ujima/framework';
import { tool } from 'ai';
import type { FilePart, ImagePart, LanguageModel, ModelMessage, TextPart, ToolSet, UserContent } from "ai";
import { z } from 'zod';
import type { ToolService } from '../services/tool-service.js';
import type { OrchestratorTool } from '../tools/types.js';
import { ORCHESTRATOR_TOOLS } from '../tools/index.js';
import { toModelToolName } from '../tools/names.js';
import { toModelToolErrorOutput, toModelToolOutput } from '../services/tool-loop-result.js';
import { isCompactionSummarySystemMessage } from '../services/conversation-summary.js';

export function toModelMessages(messages: Message[], selfId?: string): ModelMessage[] {
  return messages
    .filter(
      (message) =>
        message.kind !== 'system' || isCompactionSummarySystemMessage(message),
    )
    .map((message) => {
      if (message.kind === 'system') {
        return {
          role: 'system' as const,
          content: message.content,
        } as ModelMessage;
      }

      const role = selfId
        ? message.senderId === selfId
          ? ("assistant" as const)
          : ("user" as const)
        : message.senderKind === "agent"
          ? ("assistant" as const)
          : ("user" as const);

      const reasoning = message.reasoningContent?.trim();
      if (role === "assistant" && reasoning) {
        return {
          role: "assistant",
          content: [
            { type: "reasoning" as const, text: reasoning },
            { type: "text" as const, text: message.content },
          ],
        } as ModelMessage;
      }

      return {
        role,
        content: buildUserContent(message),
      } as ModelMessage;
    });
}

function buildUserContent(message: Message): UserContent {
  const attachments = (message as { attachments?: AttachmentLike[] }).attachments ?? [];
  if (!attachments.length) {
    return message.content;
  }

  const parts: (TextPart | ImagePart | FilePart)[] = [];
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
  resolveModelId: (
    teamRole: { model?: string },
    provider: { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
    role: SpiritRole,
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
  const providerName = params.resolveProviderName(
    { llm: params.member.llm },
    { provider: teamRole.provider },
  );
  if (!providerName) {
    throw new Error(`Provider not resolved for member "${params.memberId}"`);
  }
  const provider = params.team.getProvider(providerName);
  if (!provider) {
    throw new Error(`Provider not found: ${providerName}`);
  }
  const modelId = params.resolveModelId(
    { model: teamRole.model },
    provider,
    params.role,
  );
  if (!modelId) {
    throw new Error(`Provider "${providerName}" has no model id`);
  }
  const apiKey = params.getProviderCredential(params.organizationId, providerName);
  if (!apiKey) {
    throw new Error(`Provider key missing for "${providerName}"`);
  }
  return selectLanguageModel({
    kind: provider.kind,
    modelId,
    apiKey,
    baseUrl: provider.baseUrl,
  });
}

// Fix #7: Default provider-name resolver (uses role.provider directly).
export function defaultResolveProviderName(
  _member: { llm?: string },
  teamRole: { provider?: string },
): string {
  if (!teamRole.provider) {
    throw new Error(`Role is missing a provider`);
  }
  return teamRole.provider;
}

// Fix #7: Default model-ID resolver using the cheaper-tier picker.
export function defaultResolveModelId(
  teamRole: { model?: string },
  provider: { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
  role: SpiritRole,
): string | undefined {
  const baseModel = teamRole.model ?? provider.defaultModel;
  if (role !== 'supervisor') return baseModel;
  const supervisorTier = provider.supervisorModel ?? provider.supervisor_model;
  return supervisorTier ?? baseModel;
}

// Fix #8: Shared tool-definition builder.
const GenericToolInvocationSchema = z.object({
  action: z.enum(['read', 'write', 'execute', 'mcp', 'message']),
  resourceType: z.enum(['file', 'folder', 'shell', 'mcp', 'message']),
  resourcePath: z.string().min(1).optional(),
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
}

export function buildToolDefinition(
  def: OrchestratorTool | undefined,
  toolId: string,
  team: AgentTeamHandle,
  tools: ToolService,
  ctx: BuildToolDefContext,
) {
  if (def) {
    return tool({
      description: team.tools[toolId]?.description ?? `${toolId} tool`,
      inputSchema: def.schema,
      execute: async (rawArgs, { toolCallId }) => {
        try {
          const invocationData = def.toInvocation(rawArgs);
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
          resourcePath: args.resourcePath,
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
    toolIds.map((toolId) => [
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
