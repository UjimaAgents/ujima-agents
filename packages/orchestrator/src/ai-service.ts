import { isLoopFinished, type ToolSet } from 'ai';
import { buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import { DEFAULT_SPIRIT_TEMPERATURE, type Message, type SpiritRole, type WakeReason } from '@ujima/shared';
import { runAgentLoop, type AgentLoopChunk } from './services/agent-loop.js';
import type { ApiRepository } from './services/repository-reader.js';
import type { TeamStore } from './services/team-store.js';
import type { ToolService } from './services/tool-service.js';
import { ALWAYS_AVAILABLE_AGENT_TOOLS } from './tools/index.js';
import { isMirrorFragileModel } from './services/mirror-guard.js';
import {
  toModelMessages,
  resolveSpiritModel,
  buildToolDefinitions,
} from './utils/to-model-messages.js';
import { requireTeam } from './utils/require-team.js';
import { buildRunTranscript } from './utils/run-transcript.js';
import { buildSelfFollowupContextBlock } from './utils/self-followup-context.js';
import {
  buildCacheableSystem,
  buildWakeContextMessages,
  loadProceduresForSystemPrompt,
} from './utils/system-prompt-builder.js';
import { buildThreadStateBlock } from './utils/thread-state.js';
import { buildWorkspaceStateBlock } from './utils/workspace-state.js';
import {
  filterToolsForWakeReplyPolicy,
  resolveWakeReplyPolicy,
} from './utils/wake-reply-policy.js';
import {
  createMessageCursor,
  isMessageAfterCursor,
  moveCursor,
  type MessageCursor,
} from './utils/message-interrupts.js';


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
}) => Promise<{ toolSet: ToolSet; servers: ResolvedMcpServerSummary[] }>;

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

    const model = resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.agentId,
      role: 'worker' as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) => normalizeProviderKey(m.llm ?? r.provider ?? ''),
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
    // included via @all expansion), `channel.pass` and `self.note`
    // are stripped so the model literally cannot opt out of
    // replying. Posting tools (`channel.reply`, `channel.post`,
    // `channel.dm`, `message`) stay available via
    // `ALWAYS_AVAILABLE_AGENT_TOOLS`, so the model has a clear
    // path to comply with the "you must reply" contract regardless
    // of how the role config declares its `tools`.
    const wakeReasonForPalette = (this.repo.getRun?.(input.organizationId, input.runId)
      ?.wakeReason ?? null) as WakeReason | null;
    const wakeReplyPolicy = resolveWakeReplyPolicy({
      threadId: input.threadId,
      wakeReason: wakeReasonForPalette,
    });
    const baseAlwaysAvailable = filterToolsForWakeReplyPolicy(
      ALWAYS_AVAILABLE_AGENT_TOOLS,
      wakeReplyPolicy,
    );
    const roleTools = filterToolsForWakeReplyPolicy(role.tools, wakeReplyPolicy);
    const toolIds = [...new Set([...roleTools, ...baseAlwaysAvailable])];
    const builtInToolDefs = buildToolDefinitions(toolIds, team, this.tools, {
      organizationId: input.organizationId,
      runId: input.runId,
      memberId: input.agentId,
      threadId: input.threadId,
      repo: this.repo,
    }) as ToolSet;

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
    const toolDefs: ToolSet = { ...builtInToolDefs, ...mcpToolDefs };

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
      team.channels,
      organization.organizationChart,
      availableSkills,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      wakeReplyPolicy.conversationKind,
    );

    // Bet 1 + Bet 7 — cache-stable system prompt assembly.
    //
    // The base system prompt + the agent's procedures.md + the base
    // wake scaffold form Zone 1: invariant per (agent, thread). The
    // per-wake mutations (anti-mirror line, self-followup contract)
    // are emitted SEPARATELY as user-role messages after the cache
    // breakpoint, so they no longer bust the Anthropic prompt cache
    // on every wake. The CI lint at packages/orchestrator/test/
    // cache-stability.test.ts hashes this output across wake reasons
    // to enforce the invariant.
    const proceduresText = await loadProceduresForSystemPrompt(team.workspace.root, member.id);
    const { system } = buildCacheableSystem({
      baseSystem: baseSystemPrompt,
      proceduresText,
      goalSuffix: input.systemPromptSuffix,
      // Use the DM vs channel scaffold from the wake-reply policy
      // (introduced by main as `wake-reply-policy.ts`). Per-thread
      // stable, so it remains in the cacheable prefix; the wake-
      // reason-dependent anti-mirror + self-followup lines below
      // are emitted as user-role messages and DON'T bust the cache.
      baseScaffold: wakeReplyPolicy.scaffoldBlock,
      // Bet 1b — gate memory/procedure guidance on tool availability
      // so prompts without those tools stay clean.
      availableToolIds,
    });

    const initialThreadMessages = this.repo.listMessages(input.organizationId, input.threadId, undefined, 20).data;
    const messages = toModelMessages(initialThreadMessages, input.agentId);
    const interruptCursor = createMessageCursor(initialThreadMessages);
    if (input.summary) {
      messages.push({
        role: 'user',
        content: input.summary,
      });
    }
    const runTranscript = buildRunTranscript(
      this.repo.listRunSteps?.(input.organizationId, input.runId) ?? [],
    );
    if (runTranscript) {
      messages.push({
        role: 'user',
        content: runTranscript,
      });
    }

    // Factual thread-state injection. Gives the model ground truth
    // about who was addressed, who already responded, and how it sits
    // in the channel — instead of letting it invent claims like
    // "already handled" or "addressed to someone else." Provider-
    // agnostic (XML wrapper, works on Claude / DeepSeek / GPT / Gemini).
    // Resolved from the wake's sourceMessageId when available so the
    // "responders since wake" computation is correct on long threads.
    const runRow = this.repo.getRun?.(input.organizationId, input.runId);
    const sourceMessageId = (runRow?.sourceMessageId ?? undefined) as string | undefined;
    const threadStateBlock = buildThreadStateBlock({
      messages: initialThreadMessages,
      currentMember: { id: member.id, name: member.name },
      sourceMessageId,
      threadId: input.threadId,
      members: this.repo.listMembers(input.organizationId),
    });
    if (threadStateBlock) {
      messages.push({
        role: 'user',
        content: threadStateBlock,
      });
    }

    // Bet 3 — workspace-state ground truth. Surfaces open commitments
    // owned by this agent, recent channel decisions (decision_log),
    // and any persistent memory entries (Bet 5) inline so the model
    // sees its own durable context at every wake.
    const currentChannelIdForState = input.threadId
      ? this.repo.getThread(input.organizationId, input.threadId)?.channelId
      : undefined;
    const workspaceStateBlock = buildWorkspaceStateBlock({
      organizationId: input.organizationId,
      memberId: member.id,
      channelId: currentChannelIdForState,
      repo: this.repo,
    });
    if (workspaceStateBlock) {
      messages.push({
        role: 'user',
        content: workspaceStateBlock,
      });
    }

    // Bet 2 — self-followup context. Re-attaches the original
    // commitment message + artifact paths + empty-wake count so a
    // scheduler-driven wake doesn't land blind to its own promise.
    const selfFollowupBlock = buildSelfFollowupContextBlock({
      organizationId: input.organizationId,
      memberId: member.id,
      runId: input.runId,
      sourceMessageId,
      wakeReason: (runRow?.wakeReason ?? null) as string | null,
      repo: this.repo,
    });
    if (selfFollowupBlock) {
      messages.push({
        role: 'user',
        content: selfFollowupBlock,
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
    for (const wakeMessage of wakeContextMessages) {
      messages.push(wakeMessage);
    }
    const systemPrompt = system;

    // Self-followup wakes routinely produce multi-section
    // deliverables (the scaffold now nudges agents to write them to
    // disk, but compacted/short messages and small deliverables still
    // get posted inline). 1200 tokens is too tight for a task list +
    // its delivery note; bump to 4096 so the model has room to finish
    // even when it ignores the "write to a file first" rule.
    const turnMaxOutputTokens = wakeReasonForPalette === 'self-followup' ? 4096 : 1200;
    return runAgentLoop({
      model,
      system: systemPrompt,
      messages,
      tools: toolDefs,
      stopWhen: isLoopFinished(),
      maxOutputTokens: turnMaxOutputTokens,
      // Lower temperature for mandatory mention wakes: at 0.2 the model is
      // more willing to commit to a structured posting tool. Other runs keep
      // the shared default.
      temperature: wakeReplyPolicy.mandatoryReply ? 0.2 : DEFAULT_SPIRIT_TEMPERATURE,
      // L1/L2: force a tool call on the FIRST step only so the model
      // picks `channel.pass` or a posting tool fast. Continuation
      // steps go back to `auto` so multi-step read→write→reply
      // sequences still work.
      toolChoice: 'required-first-step',
      abortSignal: input.abortSignal,
      onChunk: input.onChunk,
      loadInterruptMessages: () => {
        const interrupts = this.loadRunInterrupts(input, interruptCursor);
        return toModelMessages(interrupts, input.agentId);
      },
    });
  }

  private loadRunInterrupts(
    input: Pick<GenerateRunReplyInput, 'organizationId' | 'agentId' | 'threadId'>,
    cursor: MessageCursor,
  ): Message[] {
    const page = this.repo.listMessages(input.organizationId, input.threadId, undefined, 100).data;
    const interrupts = page.filter(
      (message) =>
        message.kind === 'human' &&
        message.senderId !== input.agentId &&
        isMessageAfterCursor(message, cursor),
    );
    const latest = page.at(-1);
    if (latest) {
      moveCursor(cursor, latest);
    }
    return interrupts;
  }
}
