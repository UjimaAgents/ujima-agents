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
    const completedToolCalls = message.toolCalls.filter((call) => call.result !== undefined);
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
//
// Provider-fallback (Option 1, runtime-fallback): when the role's
// configured provider has no API key in this org, walk
// `team.providers` and pick the first provider that DOES have a
// key. This decouples agent config from a specific provider —
// adding a Gemini key auto-propagates to all agents that were
// configured for DeepSeek, without per-role migration. The
// fallback provider's `defaultModel` is used because the role's
// configured `model` field belongs to the original provider and
// almost certainly isn't a valid id on the new one.
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
    /**
     * `true` when we are NOT on the originally-requested provider (the
     * preferred one was rejected, e.g. missing API key). Resolvers that
     * honor per-member or per-role model overrides MUST ignore those
     * overrides when this flag is set — those ids are provider-specific
     * and almost certainly won't resolve on the fallback provider.
     */
    isFallback: boolean,
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

  // Try the preferred provider first, then fall back to any other
  // team-configured provider that has a key. Iteration order over
  // `team.providers` is the config-declaration order, which is
  // deterministic.
  const tried: { name: string; rejected: string }[] = [];
  const candidates: string[] = [preferredProviderName];
  for (const candidate of Object.keys(params.team.providers)) {
    if (candidate !== preferredProviderName && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const providerName of candidates) {
    const provider = params.team.getProvider(providerName);
    if (!provider) {
      tried.push({ name: providerName, rejected: 'provider not configured' });
      continue;
    }
    const apiKey = params.getProviderCredential(params.organizationId, providerName);
    if (!apiKey) {
      tried.push({ name: providerName, rejected: 'no API key' });
      continue;
    }

    // Use the role's configured model only when we're on the
    // originally-requested provider. After fallback, the role's
    // model id won't be valid on the new provider — pick its
    // defaultModel instead. If the provider config didn't declare
    // a defaultModel either, fall back to a built-in per-kind
    // default so a Google key with no `defaultModel` set in
    // team.config still works.
    const isFallback = providerName !== preferredProviderName;
    const teamRoleForModel = isFallback ? { model: undefined } : { model: teamRole.model };
    const providerForResolve = isFallback
      ? { ...provider, defaultModel: provider.defaultModel ?? defaultModelIdForKind(provider.kind) }
      : provider;
    const modelId = params.resolveModelId(
      teamRoleForModel,
      providerForResolve,
      params.role,
      isFallback,
      params.member.model,
    );
    if (!modelId) {
      tried.push({ name: providerName, rejected: 'no model id resolved (provider config is missing defaultModel and there is no built-in default for this kind)' });
      continue;
    }

    if (providerName !== preferredProviderName) {
      // Single line to make the fallback observable in logs.
      console.warn(
        `[ujima] provider fallback: org "${params.organizationId}" preferred "${preferredProviderName}" unusable, falling back to "${providerName}" (model "${modelId}")`,
      );
    }
    return selectLanguageModel({
      kind: provider.kind,
      modelId,
      apiKey,
      baseUrl: provider.baseUrl,
      reasoningEffort: params.reasoningEffort,
    });
  }

  const triedSummary = tried.map((t) => `${t.name} (${t.rejected})`).join('; ');
  throw new Error(
    `No usable provider for member "${params.memberId}". Tried: ${triedSummary}`,
  );
}

/**
 * Built-in default model per provider kind, used when the team
 * config's `providers.<name>.defaultModel` is empty. Lets a user
 * who pasted just an API key (via the UI) end up with a working
 * model id without needing to also write defaultModel into config.
 *
 * These defaults are intentionally conservative (fast/cheap
 * variants) — power users override via `provider.defaultModel`
 * in team config or via `role.model`.
 */
function defaultModelIdForKind(kind: string): string | undefined {
  switch (kind) {
    case 'google':
      return 'gemini-2.5-flash';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-6';
    case 'deepseek':
      return 'deepseek-chat';
    case 'xai':
      return 'grok-3';
    case 'mistral':
      return 'mistral-large-latest';
    default:
      return undefined;
  }
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
  isFallback?: boolean,
  memberModel?: string,
): string | undefined {
  const baseModel = (isFallback ? undefined : memberModel) ?? teamRole.model ?? provider.defaultModel;
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
