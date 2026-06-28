import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDirectMessageThread, type Message, type ReasoningEffort, type SpiritRole } from "@ujima/shared";
import { selectLanguageModel } from '@ujima/llm';
import { normalizeProviderKey, type AgentTeamHandle } from '@ujima/framework';
import { generateText, tool } from 'ai';
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
import { isPendingToolResult, messageToolCallsToModelMessages, sanitizeModelMessages } from './run-transcript.js';
import { resolveOpenAIAccessToken } from './codex-auth.js';

export function isWakeContextMessage(message: Message): boolean {
  return message.kind === 'system' && message.metadata?.wakeContext === true;
}

export function toModelMessages(
  messages: Message[],
  selfId?: string,
  options: { includeReasoning?: boolean } = {},
): ModelMessage[] {
  return sanitizeModelMessages(filterVisibleMessages(messages)
    .filter(
      (message) =>
        (message.kind !== 'system'
          || isCompactionSummarySystemMessage(message)
          || isWakeContextMessage(message)),
    )
    .flatMap((message) => messageToModelMessages(message, selfId, options.includeReasoning ?? false)));
}

function messageToModelMessages(message: Message, selfId?: string, includeReasoning = false): ModelMessage[] {
  if (message.kind === 'system') {
    if (isWakeContextMessage(message)) {
      return [{ role: 'system' as const, content: message.content }];
    }
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
      (call) => call.result !== undefined && !isPendingToolResult(call.result),
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

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), '.ujima');
}

// ───────────────────────────────────────────────────────────────────────
// Fallback health probe + TTL cache
//
// The provider fallback fires a real (tiny) call to a candidate before
// pairing it, so a down endpoint (local Ollama not running) or a model
// the provider rejects (e.g. a Google model id sent to DeepSeek) is
// skipped instead of handed to the run. Results are cached per
// (org, provider, model): a healthy result is trusted for HEALTHY_TTL_MS,
// a failure is re-checked sooner (UNHEALTHY_TTL_MS) so a recovered
// provider isn't stuck failing. The cache keeps per-spawn latency at one
// probe per provider per TTL window rather than every spawn.
// ───────────────────────────────────────────────────────────────────────

const HEALTHY_TTL_MS = 5 * 60_000;
const UNHEALTHY_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 6_000;

interface ProbeCacheEntry {
  ok: boolean;
  expiresAt: number;
}
const providerHealthCache = new Map<string, ProbeCacheEntry>();

/** Test seam — clear the module-level probe cache between cases. */
export function __clearProviderHealthCache(): void {
  providerHealthCache.clear();
}

/**
 * Default fallback probe: fire a 1-token completion against the built
 * (provider, model) with a short timeout. Success → reachable. Any
 * throw (connect refused, auth error, unknown-model) → not reachable.
 * Cached per (org, provider, model) with a TTL.
 */
export async function probeModelReachable(input: {
  organizationId: string;
  providerName: string;
  modelId: string;
  model: LanguageModel;
  now?: () => number;
}): Promise<boolean> {
  const now = input.now ?? Date.now;
  const key = `${input.organizationId}:${normalizeProviderKey(input.providerName)}:${input.modelId}`;
  const cached = providerHealthCache.get(key);
  if (cached && cached.expiresAt > now()) return cached.ok;

  let ok = false;
  try {
    await generateText({
      model: input.model,
      prompt: 'ping',
      maxOutputTokens: 1,
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    ok = true;
  } catch {
    ok = false;
  }
  providerHealthCache.set(key, {
    ok,
    expiresAt: now() + (ok ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS),
  });
  return ok;
}

// Fix #7: Shared model-resolution ladder.
// Walk: member → agent → role → provider → modelId → apiKey → LanguageModel.
export async function resolveSpiritModel(params: {
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
  /**
   * Provider-fallback hook. Returns the set of provider names that have
   * a configured credential (keys normalized). When the member's
   * preferred provider has no usable API key, the resolver falls back
   * to one of these that yields a usable (provider, model) pair.
   * Optional so narrower call sites keep the strict "preferred provider
   * only" behavior.
   */
  listConfiguredProviders?: () => Record<string, boolean>;
  /**
   * Returns the model ids other agents actually run on a given provider
   * (distinct `members.model` where `llm = provider`). Used to pick a
   * fallback model WITHOUT requiring an org to set `provider.defaultModel`
   * — we reuse a model already known to work for that provider in this
   * org. A provider with an in-use model is also preferred over one with
   * none, so the fallback lands on a provider that's demonstrably wired
   * up rather than the alphabetically-first one.
   */
  listProviderModelsInUse?: (providerName: string) => string[];
  /**
   * Live-probe a built fallback candidate before pairing it. Returns
   * true when a real call to (provider, model) succeeds. Used ONLY on
   * the fallback path so we never hand the run a provider that's down
   * (e.g. a local Ollama that isn't running) or a model the provider
   * rejects. The preferred provider is used as-is (no probe) to keep
   * the hot path fast; if it's down the run surfaces the normal API
   * error. Defaults to {@link probeModelReachable} (with a TTL health
   * cache); tests inject a stub.
   */
  probeFallbackModel?: (input: {
    organizationId: string;
    providerName: string;
    modelId: string;
    model: LanguageModel;
  }) => Promise<boolean>;
}): Promise<LanguageModel> {
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

  // Build a (model, modelId) for one provider, or null if it isn't
  // configured / has no usable key / can't resolve a model id. A
  // fallback uses the provider's own default model — the member/role
  // model id won't exist cross-provider — so memberModel/roleModel are
  // dropped when `isFallback` is set.
  const buildForProvider = (
    providerName: string,
    isFallback: boolean,
  ): { model: LanguageModel; modelId: string } | null => {
    const provider = params.team.getProvider(providerName);
    if (!provider) return null;
    const apiKey = resolveOpenAIAccessToken({
      providerName,
      authMode: provider.authMode,
      storedCredential: params.getProviderCredential(
        params.organizationId,
        providerName,
      ),
    });
    if (!apiKey) return null;
    let modelId = params.resolveModelId(
      { model: isFallback ? undefined : teamRole.model },
      provider,
      params.role,
      isFallback ? undefined : params.member.model,
    );
    // On fallback the member/role model id is dropped (it won't exist on
    // a different provider), so resolveModelId can only return the
    // provider's defaultModel. Many orgs never set one, so derive the
    // model from real config/usage instead of requiring a default:
    //   provider.defaultModel → provider.models[0] → a model another
    //   agent already runs on this provider (listProviderModelsInUse).
    if (!modelId && isFallback) {
      modelId =
        (provider as { models?: string[] }).models?.[0] ??
        params.listProviderModelsInUse?.(providerName)?.[0];
    }
    if (!modelId) return null;
    return {
      modelId,
      model: selectLanguageModel({
        kind: provider.kind,
        modelId,
        cwd: params.team.workspace.root,
        apiKey,
        baseUrl: provider.baseUrl,
        reasoningEffort: params.reasoningEffort,
      }),
    };
  };

  // 1. Preferred provider (member → role) on its configured model. Used
  //    as-is without a probe — it's the operator's explicit choice and
  //    the hot path stays fast.
  const preferred = buildForProvider(preferredProviderName, false);
  if (preferred) return preferred.model;

  const preferredKey = normalizeProviderKey(preferredProviderName);
  if (preferredKey === 'openai' && params.team.getProvider('openai-codex')) {
    const codex = buildForProvider('openai-codex', false);
    if (codex) {
      console.warn(
        `[model-resolver] member "${params.memberId}" preferred "openai" has no API key; ` +
          `using configured "openai-codex" (${codex.modelId}).`,
      );
      return codex.model;
    }
  }

  // 2. Fallback — pick the first OTHER configured provider that BUILDS
  //    and PROBES OK. Probing is what makes this correct: it skips a
  //    provider that's down (Ollama not running) or a model the provider
  //    rejects, instead of blindly pairing the first that builds.
  //    Candidates are ordered so providers other agents actually use come
  //    first (demonstrably wired up + give us a known-good model), then
  //    alphabetical for stability.
  const configured = params.listConfiguredProviders?.() ?? {};
  const inUseCount = (name: string): number =>
    params.listProviderModelsInUse?.(name)?.length ?? 0;
  const candidates = Object.keys(configured)
    .filter((name) => normalizeProviderKey(name) !== preferredKey)
    .sort((a, b) => {
      const aUsed = inUseCount(a) > 0 ? 0 : 1;
      const bUsed = inUseCount(b) > 0 ? 0 : 1;
      return aUsed !== bUsed ? aUsed - bUsed : a.localeCompare(b);
    });
  const probe = params.probeFallbackModel ?? probeModelReachable;
  const triedButUnhealthy: string[] = [];
  for (const candidate of candidates) {
    const built = buildForProvider(candidate, true);
    if (!built) continue;
    const healthy = await probe({
      organizationId: params.organizationId,
      providerName: candidate,
      modelId: built.modelId,
      model: built.model,
    });
    if (!healthy) {
      triedButUnhealthy.push(`${candidate}:${built.modelId}`);
      continue;
    }
    console.warn(
      `[model-resolver] member "${params.memberId}" provider "${preferredProviderName}" ` +
        `has no usable API key; validated fallback to "${candidate}" (${built.modelId}).`,
    );
    return built.model;
  }

  const triedNote =
    triedButUnhealthy.length > 0
      ? ` Tried but unreachable: ${triedButUnhealthy.join(', ')}.`
      : '';
  throw new Error(
    `No usable provider for member "${params.memberId}": preferred "${preferredProviderName}" ` +
      `has no API key and no fallback provider passed a live health check.${triedNote}`,
  );
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

/**
 * Build the `listProviderModelsInUse` hook for `resolveSpiritModel` from
 * a repository: the distinct model ids that active agents already run on
 * a given provider in this org. Lets provider fallback reuse a
 * known-good model without the org having to set `provider.defaultModel`.
 */
export function makeProviderModelsInUseLookup(
  repo: { listMembers: (orgId: string) => { kind: string; llm?: string; model?: string; retiredAt?: string }[] },
  organizationId: string,
): (providerName: string) => string[] {
  return (providerName: string) => {
    const key = normalizeProviderKey(providerName);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of repo.listMembers(organizationId)) {
      if (m.kind !== 'agent' || m.retiredAt || !m.model || !m.llm) continue;
      if (normalizeProviderKey(m.llm) !== key) continue;
      if (!seen.has(m.model)) {
        seen.add(m.model);
        out.push(m.model);
      }
    }
    return out;
  };
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
  resourceType: z.enum(['file', 'folder', 'shell', 'mcp', 'message', 'skill']),
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
            conversationKind: isDirectMessageThread(ctx.threadId) ? 'dm' : 'channel',
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
