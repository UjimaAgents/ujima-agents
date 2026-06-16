import { randomUUID } from 'node:crypto';
import { type ModelMessage, type ToolSet } from 'ai';
import { buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import {
  AGENT_KIND,
  DEFAULT_SPIRIT_TEMPERATURE,
  type ReasoningEffort,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import {
  runAgentLoop,
  runAgentWithRetry,
  type AgentLoopChunk,
  type AgentLoopStep,
  type HumanPause,
} from './services/agent-loop.js';
import type { ApiRepository } from './services/repository-reader.js';
import type { TeamStore } from './services/team-store.js';
import type { ToolService } from './services/tool-service.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  filterDeprecatedToolIds,
} from './tools/index.js';
import { isMirrorFragileModel } from './services/mirror-guard.js';
import {
  toModelMessages,
  resolveSpiritModel,
  buildToolDefinitions,
} from './utils/to-model-messages.js';
import { requireTeam } from './utils/require-team.js';
import { resolveVisiblePromptChannels } from './utils/visible-prompt-channels.js';
import {
  buildCacheableSystem,
  buildWakeContextMessages,
  loadCultureForSystemPrompt,
  loadProceduresForSystemPrompt,
} from './utils/system-prompt-builder.js';
import { buildThreadStateBlock } from './utils/thread-state.js';
import { buildWorkspaceStateBlock } from './utils/workspace-state.js';
import { buildPromptMessages } from './utils/prompt-assembly.js';
import {
  filterToolsForWakeReplyPolicy,
  isAgentOnlyDmThread,
  resolveWakeReplyPolicy,
} from './utils/wake-reply-policy.js';
import { selectPromptContextMessages } from './utils/prompt-context.js';
import { createMessageCursor, loadInterruptModelMessages } from './utils/interrupt-loader.js';
import {
  buildDelegateTurnContextMessages,
  filterDelegateTurnToolSet,
  getDelegateKind,
} from './utils/delegate-turn.js';
import { createProviderSafeFallbackHandler } from './utils/model-fallback.js';
import { isDelegateMessage } from './services/run-reply-guard.js';
import { collectCursorPages } from './utils/cursor-pages.js';

// Resolver now delegates to the canonical `@ujima/llm` surface so every
// AI-SDK-driven code path (this `/api/runs` service, the upcoming
// agent-runtime `ai-sdk-loop`, the conflict referee, the task promoter)
// agrees on the provider kind → model wiring.

export interface GenerateRunReplyInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  runId: string;
  summary?: string;
  systemPromptSuffix?: string;
  abortSignal?: AbortSignal;
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
  onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
  detectExternalPause?: () => HumanPause | null;
}

export interface GenerateMemoryReviewInput {
  organizationId: string;
  memberId: string;
  threadId: string;
  prompt: string;
  contextSize?: number;
  abortSignal?: AbortSignal;
}

/**
 * Resolves the MCP tool palette for a given (org, member, role). Late-
 * bound via `AiService.setMcpToolResolver` after construction to break
 * the AiService ↔ SpiritService construction cycle — both can't be
 * constructed first, so we wire the resolver post-hoc once both exist.
 * When the resolver is unset, MCP tools simply don't appear in the
 * wake-run palette (legacy behavior).
 */
export interface ResolvedMcpServerSummary {
  serverName: string;
  serverId: string;
  toolNames: string[];
}

export type McpToolResolver = (ctx: {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId: string;
  taskSessionId: string;
  role: SpiritRole;
}) => Promise<{
  toolSet: ToolSet;
  servers: ResolvedMcpServerSummary[];
  /**
   * Pre-rendered V2 dispatch catalog block for the system prompt
   * (mcp_connector_dispatch_plan.md §5.3 / §7.4). Empty / undefined
   * on the legacy spawn so the prompt stays byte-for-byte unchanged
   * for tier-blind orgs.
   *
   * Without this the wake-run path knew about `invoke_connector_tool`
   * but had no way to learn which serverIds were dispatch-attached
   * — agents had to be told the UUID by hand. Threading the catalog
   * here lets the system prompt list them inline (same shape the
   * run-loop entry already does at spirit-agent-run.ts:230).
   */
  catalogText?: string;
}>;

export class AiService {
  private mcpToolResolver?: McpToolResolver;

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly tools: ToolService,
  ) {}

  /**
   * Plug in the MCP tool palette resolver. Production wiring sets this
   * to `spirits.buildMcpToolDefinitions.bind(spirits)` after both
   * services exist (see services/index.ts).
   */
  setMcpToolResolver(resolver: McpToolResolver | undefined): void {
    this.mcpToolResolver = resolver;
  }

  async generateMemoryReview(
    input: GenerateMemoryReviewInput,
  ): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
    const team = requireTeam(this.teamStore, input.organizationId);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const role = team.getRole(agent.roleName);
    if (!role) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const model = resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.memberId,
      role: 'worker' as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) => normalizeProviderKey(m.llm ?? r.provider ?? ''),
      resolveModelId: (r, p, _role, isFallback) =>
        (isFallback ? undefined : member.model) ?? r.model ?? p.defaultModel,
    });

    const reviewToolIds = [
      'memory.write',
      'memory.recall',
      'memory.forget',
      'self.procedure.add',
      'self.procedure.remove',
      'self.procedure.list',
      'self.procedure.view',
    ] as const;
    const runId = `memory-review:${randomUUID()}`;
    const toolDefs = buildToolDefinitions(reviewToolIds, team, this.tools, {
      organizationId: input.organizationId,
      runId,
      memberId: input.memberId,
      threadId: input.threadId,
      repo: this.repo,
    }) as ToolSet;

    const availableSkills = this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const baseSystemPrompt = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      input.threadId,
      agent,
      role,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      resolveVisiblePromptChannels(team.channels, this.repo, input.organizationId),
      organization.organizationChart,
      availableSkills,
      Object.keys(toolDefs),
      [],
      'channel',
    );

    const proceduresText = await loadProceduresForSystemPrompt(team.workspace.root, member.id);
    const { system } = buildCacheableSystem({
      baseSystem: baseSystemPrompt,
      proceduresText,
      baseScaffold: [
        'This is a silent background memory-review turn.',
        'Use only memory and self.procedure tools. Do not post, DM, reply, or address the user.',
        'If nothing durable is worth saving, output exactly: Nothing to save.',
      ].join('\n'),
      availableToolIds: Object.keys(toolDefs),
    });

    const recentThreadMessages = selectPromptContextMessages(this.repo.listMessages(
      input.organizationId,
      input.threadId,
      undefined,
      Math.max(input.contextSize ?? 10, 600),
    ).data, input.contextSize ?? 10);
    const messages = toModelMessages(recentThreadMessages, input.memberId);
    const channelId = this.repo.getThread(input.organizationId, input.threadId)?.channelId;
    const workspaceStateBlock = buildWorkspaceStateBlock({
      organizationId: input.organizationId,
      memberId: member.id,
      channelId,
      threadId: input.threadId,
      repo: this.repo,
    });
    if (workspaceStateBlock) {
      messages.push({
        role: 'user',
        content: workspaceStateBlock,
      });
    }
    messages.push({
      role: 'user',
      content: input.prompt,
    });

    return runAgentLoop({
      model,
      system,
      messages,
      tools: toolDefs,
      stopWhen: () => false,
      maxOutputTokens: 800,
      temperature: 0.2,
      toolChoice: 'auto',
      abortSignal: input.abortSignal,
    });
  }

  async generateRunReply(
    input: GenerateRunReplyInput,
  ): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
    const team = requireTeam(this.teamStore, input.organizationId);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    const member = this.repo.getMember(input.organizationId, input.agentId);
    if (!member) {
      throw new Error(`Member not found: ${input.agentId}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const role = team.getRole(agent.roleName);
    if (!role) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const runRow = this.repo.getRun?.(input.organizationId, input.runId);
    const sourceMessageId = (runRow?.sourceMessageId ?? undefined) as string | undefined;
    const sourceMessage = sourceMessageId
      ? this.repo.getMessage(input.organizationId, sourceMessageId)
      : null;
    const reasoningEffort = sourceMessage?.metadata?.reasoningEffort as ReasoningEffort | undefined;

    const model = resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.agentId,
      role: 'worker' as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) => normalizeProviderKey(m.llm ?? r.provider ?? ''),
      reasoningEffort,
      // `member.model` is provider-specific to the agent's preferred
      // provider. When `resolveSpiritModel` falls back to a different
      // provider (e.g. the preferred one has no key), that override
      // almost certainly isn't a valid id on the new provider —
      // ignore it on fallback and let the provider/default chain
      // resolve a usable id. The same rule applies to `r.model`,
      // which `resolveSpiritModel` already clears on fallback.
      resolveModelId: (r, p, _role, isFallback) =>
        (isFallback ? undefined : member.model) ?? r.model ?? p.defaultModel,
    });

    // Mandatory-reply enforcement at the tool-palette layer.
    // When wakeReason === 'mention' (the agent was @mentioned, or
    // included via @all expansion), `channel.pass`
    // is stripped so the model literally cannot opt out of
    // replying. Posting tools (`channel.reply`, `channel.post`,
    // `channel.dm`) stay available via `ALWAYS_AVAILABLE_AGENT_TOOLS`,
    // so the model has a clear path to comply with the "you must
    // reply" contract regardless of how the role config declares its
    // `tools`.
    const isDelegateTurn = isDelegateMessage(sourceMessage);
    const wakeReasonForPalette = (runRow?.wakeReason ?? null) as WakeReason | null;
    const wakeReplyPolicy = resolveWakeReplyPolicy({
      threadId: input.threadId,
      wakeReason: wakeReasonForPalette,
      dmPeerIsAgent: isAgentOnlyDmThread(
        input.threadId,
        (memberId) => this.repo.getMember(input.organizationId, memberId)?.kind === AGENT_KIND,
      ),
    });
    const baseAlwaysAvailable = filterToolsForWakeReplyPolicy(
      ALWAYS_AVAILABLE_AGENT_TOOLS,
      wakeReplyPolicy,
    );
    const roleTools = filterToolsForWakeReplyPolicy(role.tools, wakeReplyPolicy);
    const builtInToolDefs = buildToolDefinitions(
      filterDeprecatedToolIds([...new Set([...roleTools, ...baseAlwaysAvailable])]),
      team,
      this.tools,
      {
        organizationId: input.organizationId,
        runId: input.runId,
        memberId: input.agentId,
        threadId: input.threadId,
        repo: this.repo,
      },
    ) as ToolSet;

    // Attached MCPs layer on top of the built-in palette so wake-run
    // agents (this code path) get the same tools that the spirit-run
    // path has been getting all along. Without this, a member with a
    // Playwright MCP attached wakes via @mention and the model sees
    // only channel.* tools, so it (correctly) tells the user it has
    // no Playwright tool. The resolver is late-bound at startup.
    // Resolve the SpiritRole this wake actually belongs to. Without
    // this, the resolver defaults to `'worker'` and any MCP attachment
    // scoped `'supervisor'`-only would be silently invisible to the
    // model — and `ToolServiceImpl.executeMcpTool` (which re-reads
    // attachments by role at invocation time) would reject the call
    // even if the model tried.
    //
    // Lookup MUST be role-agnostic. The earlier implementation used
    // `listActiveSpiritsForMember`, which filters to `role = 'worker'`
    // in SQL — so supervisor spirits never showed up and any
    // supervisor wake reaching this path still resolved to the worker
    // palette. `getSpiritByRunId` is keyed directly on `runs.run_id`
    // and returns whichever role (worker or supervisor) owns the row.
    let resolvedRole: SpiritRole = 'worker';
    let resolvedTaskSessionId = '';
    if (this.repo.getSpiritByRunId) {
      const spirit = this.repo.getSpiritByRunId(input.organizationId, input.runId);
      if (spirit) {
        resolvedRole = spirit.role;
        resolvedTaskSessionId = spirit.taskSessionId;
      }
    }

    const mcpResolution = this.mcpToolResolver
      ? await this.mcpToolResolver({
          organizationId: input.organizationId,
          memberId: input.agentId,
          runId: input.runId,
          threadId: input.threadId,
          // Preserve the task session id so MCP tools that need one
          // (audit linkage, per-task isolation) still get it. Empty
          // string when there's no active spirit/task — the value is
          // only used by tool runtime code that already handles the
          // bare-wake case.
          taskSessionId: resolvedTaskSessionId,
          role: resolvedRole,
        })
      : { toolSet: {} as ToolSet, servers: [] };
    const mcpToolDefs = mcpResolution.toolSet;
    const attachedMcpServers = mcpResolution.servers;
    const availableConnectors = mcpResolution.catalogText;
    const toolDefs: ToolSet = isDelegateTurn
      ? filterDelegateTurnToolSet({ ...builtInToolDefs, ...mcpToolDefs }, getDelegateKind(sourceMessage))
      : { ...builtInToolDefs, ...mcpToolDefs };

    // The "Available tools:" line in the system prompt is what some
    // models actually read when deciding whether they CAN call a tool.
    // Pass the FULL resolved palette (baseline + role + MCP namespaced
    // ids) so the prompt matches the AI-SDK schema; otherwise the
    // model can deny tools it actually has.
    const availableToolIds = Object.keys(toolDefs);
    // Main introduced a skills library: organisation-installed skills
    // get threaded through `buildAgentSystemPrompt` so they appear in
    // the system prompt alongside the role/tools listing. The lookup
    // is optional on the repo so narrow test repos work without
    // wiring the new method.
    const availableSkills = this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const baseSystemPrompt = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      input.threadId,
      agent,
      role,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      resolveVisiblePromptChannels(team.channels, this.repo, input.organizationId),
      organization.organizationChart,
      availableSkills,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      wakeReplyPolicy.conversationKind,
      availableConnectors,
    );

    // Bet 1 + Bet 7 — cache-stable system prompt assembly.
    //
    // The base system prompt + the agent's procedures.md + the base
    // wake scaffold form Zone 1: invariant per (agent, thread). The
    // per-wake mutations (anti-mirror line)
    // are emitted SEPARATELY as user-role messages after the cache
    // breakpoint, so they no longer bust the Anthropic prompt cache
    // on every wake. The CI lint at packages/orchestrator/test/
    // cache-stability.test.ts hashes this output across wake reasons
    // to enforce the invariant.
    const cultureChannelId = input.threadId
      ? this.repo.getThread(input.organizationId, input.threadId)?.channelId
      : undefined;
    const culture = await loadCultureForSystemPrompt({
      workspaceRoot: team.workspace.root,
      organizationId: input.organizationId,
      memberId: member.id,
      channelId: cultureChannelId,
    });
    if (culture.applied.length > 0) {
      this.repo.recordProceduresApplied?.({
        organizationId: input.organizationId,
        runId: input.runId,
        applied: culture.applied,
      });
    }
    const { system } = buildCacheableSystem({
      baseSystem: baseSystemPrompt,
      lawText: culture.lawText,
      proceduresText: culture.cultureText,
      // Use the DM vs channel scaffold from the wake-reply policy
      // (introduced by main as `wake-reply-policy.ts`). Per-thread
      // stable, so it remains in the cacheable prefix; the wake-
      // reason-dependent anti-mirror lines below
      // are emitted as user-role messages and DON'T bust the cache.
      baseScaffold: wakeReplyPolicy.scaffoldBlock,
      // Bet 1b — gate memory/procedure guidance on tool availability
      // so prompts without those tools stay clean.
      availableToolIds,
    });

    const threadMessages = collectCursorPages((cursor) =>
      this.repo.listMessages(input.organizationId, input.threadId, cursor, 600),
    );
    const promptHistoryMessages = selectPromptContextMessages(
      sourceMessage ? threadMessages.filter((message) => message.id !== sourceMessage.id) : threadMessages,
    );
    const interruptCursor = createMessageCursor(promptHistoryMessages);

    const contextMessages: ModelMessage[] = [
      ...(input.summary ? [{ role: 'user' as const, content: input.summary }] : []),
      ...(input.systemPromptSuffix ? [{ role: 'user' as const, content: input.systemPromptSuffix }] : []),
    ];
    // Factual thread-state injection. Gives the model ground truth
    // about who was addressed, who already responded, and how it sits
    // in the channel — instead of letting it invent claims like
    // "already handled" or "addressed to someone else." Provider-
    // agnostic (XML wrapper, works on Claude / DeepSeek / GPT / Gemini).
    // Resolved from the wake's sourceMessageId when available so the
    // "responders since wake" computation is correct on long threads.
    const threadStateBlock = buildThreadStateBlock({
      messages: threadMessages,
      currentMember: { id: member.id, name: member.name },
      sourceMessageId,
      threadId: input.threadId,
      members: this.repo.listMembers(input.organizationId),
      wakeReason: wakeReasonForPalette,
    });
    if (threadStateBlock) {
      contextMessages.push({
        role: 'user',
        content: threadStateBlock,
      });
    }

    // Workspace-state ground truth. Surfaces recent artifacts, channel
    // decisions, and persistent memory inline so the model sees durable
    // context at every wake.
    const currentChannelIdForState = input.threadId
      ? this.repo.getThread(input.organizationId, input.threadId)?.channelId
      : undefined;
    const workspaceStateBlock = buildWorkspaceStateBlock({
      organizationId: input.organizationId,
      memberId: member.id,
      channelId: currentChannelIdForState,
      threadId: input.threadId,
      repo: this.repo,
    });
    if (workspaceStateBlock) {
      contextMessages.push({
        role: 'user',
        content: workspaceStateBlock,
      });
    }

    // Bet 1 — per-wake mutations land here as user-role messages.
    // These are the lines that previously mutated `system` per wake
    // and busted the cache (anti-mirror for gemini-flash, self-
    // followup publish contract for scheduler wakes). The base
    // scaffold (DM vs channel) is per-thread stable and is folded
    // into the cacheable system prompt above via the
    // `policy.scaffoldBlock` route; only the wake-reason-specific
    // additions live below the cache breakpoint.
    const resolvedModelId = (model as { modelId?: unknown }).modelId;
    const modelIdString = typeof resolvedModelId === 'string' ? resolvedModelId : '';
    const wakeContextMessages = buildWakeContextMessages({
      wakeReason: wakeReasonForPalette,
      modelIdString,
      isMirrorFragile: isMirrorFragileModel(modelIdString),
    });
    contextMessages.push(...wakeContextMessages);
    if (isDelegateTurn) {
      contextMessages.push(...buildDelegateTurnContextMessages(getDelegateKind(sourceMessage)));
    }
    const messages = buildPromptMessages({
      historyMessages: promptHistoryMessages,
      currentMemberId: input.agentId,
      runSteps: this.repo.listRunSteps?.(input.organizationId, input.runId) ?? [],
      contextMessages,
      currentRequestMessage: sourceMessage,
    });
    const systemPrompt = system;

    // Multi-section deliverables (task lists, BRDs, PRDs, or file writing)
    // routinely exceed the per-turn cap when pasted inline or written via
    // tools. 4096 tokens across all wakes gives the model enough headroom.
    const turnMaxOutputTokens = 4096;
    const providerName = normalizeProviderKey(member.llm ?? role.provider ?? '');
    const provider = team.getProvider(providerName);
    return runAgentWithRetry({
      model,
      system: systemPrompt,
      messages,
      tools: toolDefs,
      attachedMcpServers,
      stopWhen: () => false,
      maxOutputTokens: turnMaxOutputTokens,
      temperature: wakeReplyPolicy.mandatoryReply ? 0.2 : DEFAULT_SPIRIT_TEMPERATURE,
      toolChoice: 'auto',
      abortSignal: input.abortSignal,
      detectExternalPause: input.detectExternalPause,
      onChunk: input.onChunk,
      onStepFinish: input.onStepFinish,
      loadInterruptMessages: () =>
        loadInterruptModelMessages({
          repo: this.repo,
          organizationId: input.organizationId,
          threadId: input.threadId,
          agentId: input.agentId,
          cursor: interruptCursor,
          runId: input.runId,
        }),
      onModelNotFound: createProviderSafeFallbackHandler({
        logLabel: 'ai-service',
        memberLabel: input.agentId,
        providerKind: provider?.kind ?? '',
        providerName,
        getApiKey: (name) => this.repo.getProviderCredential(input.organizationId, name),
        baseUrl: provider?.baseUrl,
        reasoningEffort,
      }),
      logLabel: 'ai-service',
      memberLabel: input.agentId,
    });
  }

}
