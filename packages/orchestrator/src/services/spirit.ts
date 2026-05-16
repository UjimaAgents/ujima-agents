import { createHash, randomUUID } from 'node:crypto';
import {
  jsonSchema,
  stepCountIs,
  tool,
  type FlexibleSchema,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import {
  DEFAULT_SPIRIT_TEMPERATURE,
  MessageSchema,
  RunStateSchema,
  SocketEventNames,
  SpiritSchema,
  TaskSessionSchema,
  channelRoom,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type MCPDef,
  type MessageCard,
  type Message,
  type MessageToolCall,
  type McpToolDescriptor,
  type Spirit,
  type SpiritRole,
  type TaskSession,
  AGENT_KIND,
} from '@ujima/shared';
import {
  MESSAGE_TOOL_USAGE_GUIDANCE,
  buildAgentSystemPrompt,
  type AgentTeamHandle,
} from '@ujima/framework';
import { requireOrganization } from '../utils/require-organization.js';
import { requireTeam } from '../utils/require-team.js';
import { runAgentLoop, type AgentLoopChunk } from './agent-loop.js';
import {
  toModelMessages,
  resolveSpiritModel,
  defaultResolveProviderName,
  defaultResolveModelId,
  buildToolDefinitions,
} from '../utils/to-model-messages.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from '../tools/index.js';
import { ActiveSpiritRegistry, isAliveStatus, type ActiveSpiritEntry } from './active-spirit-registry.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
import { ToolApprovalRequiredError, toModelToolOutput } from './tool-loop-result.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { buildRunTranscript } from '../utils/run-transcript.js';
import type { ToolInvocationInput } from './tool-service.js';
import { materializeMcpDef, mcpPermissionToolName, type McpRuntimePool } from './mcp-runtime.js';
import { appendGoalArtifactToolCall } from './goal-artifact-card.js';
import { goalModeEnabledFromMessage, goalModeSystemPromptSuffix } from './goal-mode-prompt.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import {
  createMessageCursor,
  isMessageAfterCursor,
  moveCursor,
} from '../utils/message-interrupts.js';

// SpiritService: per-(session, member, role) agent runtime (spawn, registry, worker loop, supervisor alerts).

export interface ModelResolverInput {
  organizationId: string;
  memberId: string;
  role: SpiritRole;
}

/** Resolves the AI SDK model for a worker or supervisor turn (tests inject mocks). */
export type ModelResolver = (input: ModelResolverInput) => LanguageModel | Promise<LanguageModel>;

export interface SpiritServiceOptions {
  /** Hard cap on turns inside a single `runSpirit` call. */
  maxIterationsPerRun?: number;
  /** Per-turn output token cap (defaults to provider). */
  maxOutputTokens?: number;
  /** Temperature override (defaults to 0.2). */
  temperature?: number;
  /** Custom model resolver. */
  modelResolver?: ModelResolver;
  /**
   * Shared registry (optional). Production wires one registry across services that coordinate alerts.
   */
  registry?: ActiveSpiritRegistry;
  /**
   * Optional publisher for task-session summaries; otherwise SpiritService writes system messages directly.
   */
  conversations?: ConversationService;
  /**
   * Inject an MCP pool so spirit runs can call the agent's attached
   * MCP servers. When omitted, MCP tools are simply absent from the
   * palette — the built-in tool path still works. Production wires
   * the runtime host's pool; tests can pass a stub.
   */
  mcpPool?: SpiritMcpPool;
  /**
   * Service that resolves which MCPs an agent has attached at run
   * time. Optional — when absent, no MCP tools are injected. The
   * canonical implementation is `McpRegistryService` (which exposes
   * `listAttachedServersForSpirit` indirectly via the repo).
   */
  mcpResolver?: SpiritMcpResolver;
  supervisorDebounceMs?: number;
  supervisorTurnCapPerSession?: number;
}

/**
 * Minimal MCP pool surface the SpiritService needs. Matches
 * `@ujima/mcp-client.MCPPool` structurally so production injection is
 * `pool: runtimeHost.pool`. Kept here so tests don't have to pull in
 * the real pool to mock it.
 */
export type SpiritMcpPool = McpRuntimePool;

/**
 * Resolves the MCP servers visible to a given (member, role). The
 * production implementation walks `repo.listAttachedServersForSpirit`;
 * tests inject a stub that returns a fixed list.
 */
export type SpiritMcpResolver = (input: {
  organizationId: string;
  memberId: string;
  role: SpiritRole;
}) => Promise<SpiritMcpResolution[]>;

export interface SpiritMcpResolution {
  /** Materialised `MCPDef` ready to hand to a pool / connection. */
  def: MCPDef;
  /** Origin server id (for namespacing, audit, governance). */
  serverId: string;
  /** Human-readable server name used in the tool-id namespace. */
  serverName: string;
}

export interface SpawnSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  role?: SpiritRole;
}

export interface RunSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  /** Optional extra prompt — supervisor uses this to carry the alert context. */
  extraPrompt?: string;
  /** Optional suffix appended to the built system prompt. */
  systemPromptSuffix?: string;
  /** Override the iteration cap for a single call (e.g. 1 for supervisor). */
  maxIterations?: number;
  /** Restrict the tool palette to a specific allowlist (supervisor mode). */
  toolAllowlist?: readonly string[];
  /** Force role on the spirit row. Default 'worker'. */
  role?: SpiritRole;
}

export interface RunSpiritOutcome {
  spirit: Spirit;
  finalText: string;
  iterations: number;
  toolCalls: number;
  tokensUsed: number;
}

export interface SpiritAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  messageId: string;
  threadId: string;
  byMemberId: string;
  reason: string;
}

export interface SpiritSupervisorReplyOutcome {
  taskSessionId: string;
  message: Message;
  fallback: boolean;
  reason: string;
}

export type SpiritAlertDispatchResult =
  | { kind: 'replied'; outcome: SpiritSupervisorReplyOutcome }
  | { kind: 'no-active-spirit' }
  | { kind: 'debounced' };

const DEFAULT_SUPERVISOR_DEBOUNCE_MS = 2_000;
const DEFAULT_SUPERVISOR_TURN_CAP_PER_SESSION = 10;

export class SpiritService {
  private readonly maxIterationsPerRun: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly temperature: number;
  private readonly modelResolver: ModelResolver;
  private readonly registry: ActiveSpiritRegistry;
  private readonly conversations?: ConversationService;
  private readonly mcpPool?: SpiritMcpPool;
  private readonly mcpResolver?: SpiritMcpResolver;
  private readonly supervisorDebounceMs: number;
  private readonly supervisorTurnCapPerSession: number;
  private readonly supervisorMutexes = new Map<string, Promise<unknown>>();
  private readonly supervisorLastAlertAt = new Map<string, number>();

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly tools: ToolService,
    options: SpiritServiceOptions = {},
  ) {
    this.maxIterationsPerRun = options.maxIterationsPerRun ?? 12;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature ?? DEFAULT_SPIRIT_TEMPERATURE;
    this.modelResolver = options.modelResolver ?? this.defaultModelResolver();
    this.registry = options.registry ?? new ActiveSpiritRegistry();
    this.conversations = options.conversations;
    this.mcpPool = options.mcpPool;
    this.mcpResolver = options.mcpResolver ?? this.defaultMcpResolver();
    this.supervisorDebounceMs = options.supervisorDebounceMs ?? DEFAULT_SUPERVISOR_DEBOUNCE_MS;
    this.supervisorTurnCapPerSession =
      options.supervisorTurnCapPerSession ?? DEFAULT_SUPERVISOR_TURN_CAP_PER_SESSION;
  }

  /**
   * Recover the in-memory registry from persisted state. Call this once
   * at daemon boot so spirits that survived a crash still gate the
   * supervisor properly.
   *
   * Ordering invariant: `getActiveForMember` returns spirits sorted
   * newest-first by `registeredAt` (a monotonic counter assigned at
   * register time). The DB query returns rows newest-first by
   * `updated_at DESC`, so we have to register them in REVERSE order
   * here — otherwise the newest DB spirit would receive the lowest
   * counter and a fresh `@mention` after restart would get routed to
   * the oldest live spirit (the audit's flagged regression). Walking
   * oldest → newest preserves the runtime ordering the supervisor
   * gate relies on.
   */
  bootstrap(organizationId: string): void {
    const members = this.repo.listMembers(organizationId);
    for (const member of members) {
      if (member.kind !== AGENT_KIND) continue;
      const active = this.repo.listActiveSpiritsForMember(organizationId, member.id);
      // `listActiveSpiritsForMember` is `updated_at DESC`. Register
      // in reverse so the newest spirit ends up with the highest
      // monotonic `registeredAt` and `getActiveForMember` returns
      // it first. Build the reversed slice once so the loop body
      // doesn't need a non-null assertion on the indexed access.
      for (const spirit of active.slice().reverse()) {
        this.registry.register(spirit);
      }
    }
  }

  /**
   * Walk every organisation in the repo and bootstrap each. The
   * production wiring calls this from `createApiServices` so a daemon
   * restart hydrates the registry before any `member.alerted` event
   * can be processed. Without it, `SupervisorService.handleAlert`
   * would read an empty registry and route alerts to the regular
   * wake path — spawning duplicate runs for already-running tasks.
   *
   * Cheap by design: one DB scan per org × member, all synchronous.
   * For the single-tenant phase this is one org with a handful of
   * agents.
   */
  bootstrapAll(): void {
    for (const org of this.repo.listOrganizations()) {
      this.bootstrap(org.id);
    }
  }

  /** Test/observability hook for the registry. */
  getActiveRegistry(): ActiveSpiritRegistry {
    return this.registry;
  }

  /**
   * Unified member-alert dispatch. This replaces the previous split
   * supervisor runtime path by routing alert handling through SpiritService.
   */
  async handleAlert(input: SpiritAlertInput): Promise<SpiritAlertDispatchResult> {
    const active = this.registry.getActiveForMember(input.organizationId, input.memberId);
    if (active.length === 0) {
      return { kind: 'no-active-spirit' };
    }
    const target = this.findActiveSpiritForThread(
      active,
      input.organizationId,
      input.threadId,
      input.channelId,
    );
    if (!target) {
      return { kind: 'no-active-spirit' };
    }
    if (this.shouldDebounceSupervisorAlert(input.organizationId, input.memberId, target.taskSessionId)) {
      return { kind: 'debounced' };
    }

    this.supervisorLastAlertAt.set(
      this.supervisorDebounceKey(input.organizationId, input.memberId, target.taskSessionId),
      Date.now(),
    );

    const mutexKey = this.supervisorMutexKey(input.organizationId, input.memberId, target.taskSessionId);
    const previous = this.supervisorMutexes.get(mutexKey) ?? Promise.resolve();
    const next = previous.then(() => this.runSupervisorAlertTurn(target.taskSessionId, input));
    this.supervisorMutexes.set(
      mutexKey,
      next.catch(() => undefined).finally(() => {
        if (this.supervisorMutexes.get(mutexKey) === next) {
          this.supervisorMutexes.delete(mutexKey);
        }
      }),
    );

    const outcome = await next;
    return { kind: 'replied', outcome };
  }

  // ----------------- lifecycle: spawn / get / list / status / retire ----

  /**
   * Provision (or fetch) the Spirit row for the given triple. Creates a
   * paired RunState row so existing run/audit surfaces keep working.
   * Idempotent — same triple returns the existing row.
   */
  spawn(input: SpawnSpiritInput): Spirit {
    return this.spawnTracked(input).spirit;
  }

  /**
   * Same as `spawn` but tells the caller whether this invocation
   * created the Spirit row (`created: true`) or returned a pre-existing
   * one (`created: false`).
   *
   * Required by atomic-flow callers like `TaskSessionService.start()`,
   * which rolls back DB writes on failure and needs to distinguish:
   *
   *   * Newly-created spirits whose Spirit/Run rows were rolled back —
   *     their registry entries should be removed too.
   *   * Pre-existing spirits whose DB rows survived the rollback —
   *     their registry entries must stay, otherwise the supervisor
   *     gate goes blind to live work that pre-dated this start() call.
   *
   * Without this distinction, an idempotent retry that touches a mix
   * of fresh and existing spirits will, on a later failure in the
   * batch, wrongly evict the existing spirits' registry entries even
   * though their DB rows are still valid (the audit's stated bug).
   */
  spawnTracked(input: SpawnSpiritInput): { spirit: Spirit; created: boolean } {
    requireOrganization(this.repo, input.organizationId);
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== AGENT_KIND) {
      // Only agents do work. The originating human is on the channel
      // membership but doesn't get a spirit row.
      throw new Error(`Member "${input.memberId}" is not an agent`);
    }
    if (member.retiredAt) {
      throw new Error(`Member "${input.memberId}" is retired`);
    }

    // Sticky: same triple → same row. Phase 2 lets a session be re-
    // started without leaking duplicate spirit rows.
    const existing = this.repo.getSpiritByTriple(
      input.organizationId,
      input.taskSessionId,
      input.memberId,
      role,
    );
    if (existing) {
      // Do NOT call `registry.register` here. Pre-existing spirits
      // are already tracked by the registry (via the original
      // spawn or via SpiritService.bootstrap()), and refreshing
      // their `registeredAt` mid-transaction lets a later rollback
      // leave the bumped counter behind — handleAlert would then
      // route to the wrong session. Existing spirits keep whatever
      // ordering rank they already had.
      return { spirit: existing, created: false };
    }

    const now = new Date().toISOString();
    const run = RunStateSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.memberId,
      threadId: session.channelId,
      status: 'queued',
      step: 'queued',
      summary: `Spirit (${role}) for #${session.slug}`,
      startedAt: now,
    });
    this.repo.saveRun(run);

    const spirit = SpiritSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
      runId: run.id,
      status: 'queued',
      iteration: 0,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.repo.saveSpirit(spirit);
    this.registry.register(spirit);
    this.emit(SocketEventNames.spiritStarted, spirit);
    return { spirit, created: true };
  }

  /** @deprecated Use `spawn`. Retained for the Phase 2.A test surface. */
  spawnWorker(input: SpawnSpiritInput): Spirit {
    return this.spawn(input);
  }

  get(organizationId: string, spiritId: string): Spirit | null {
    return this.repo.getSpirit(organizationId, spiritId);
  }

  list(organizationId: string, taskSessionId: string): Spirit[] {
    return this.repo.listSpiritsForSession(organizationId, taskSessionId);
  }

  /**
   * Update a spirit's status without going through the run loop.
   * Common cases: an external watchdog flips a spirit to `cancelled`,
   * or an approval flow flips it to `waiting_for_approval`. Keeps the
   * registry in sync with the new alive/dead state.
   */
  updateStatus(
    organizationId: string,
    spiritId: string,
    status: Spirit['status'],
    options: { error?: string } = {},
  ): Spirit | null {
    const existing = this.repo.getSpirit(organizationId, spiritId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: Spirit = SpiritSchema.parse({
      ...existing,
      status,
      lastError: options.error ?? existing.lastError,
      updatedAt: now,
      endedAt: isAliveStatus(status) ? existing.endedAt : (existing.endedAt ?? now),
    });
    this.repo.saveSpirit(updated);
    if (isAliveStatus(status)) {
      this.registry.register(updated);
    } else {
      this.registry.unregister(updated.organizationId, updated.memberId, updated.id);
    }
    this.emit(SocketEventNames.spiritUpdated, updated);
    return updated;
  }

  /**
   * Retire a spirit explicitly. Sets status to `cancelled`, marks
   * `endedAt`, unregisters from the active registry, and flips the
   * paired RunState to `cancelled` for audit symmetry.
   */
  retire(organizationId: string, spiritId: string, reason?: string): Spirit | null {
    const existing = this.repo.getSpirit(organizationId, spiritId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const retired: Spirit = SpiritSchema.parse({
      ...existing,
      status: 'cancelled',
      lastError: reason ?? existing.lastError,
      updatedAt: now,
      endedAt: existing.endedAt ?? now,
    });
    this.repo.saveSpirit(retired);
    this.registry.unregister(retired.organizationId, retired.memberId, retired.id);
    if (retired.runId) {
      const run = this.repo.getRun(organizationId, retired.runId);
      if (run) {
        this.repo.saveRun({
          ...run,
          status: 'cancelled',
          step: 'cancelled',
          summary: reason ?? 'Spirit retired',
          endedAt: run.endedAt ?? now,
        });
      }
    }
    this.emit(SocketEventNames.spiritRetired, retired);
    this.maybeFinalizeTaskSession(retired.organizationId, retired.taskSessionId, reason);
    return retired;
  }

  // ----------------- Phase 2.5 — multi-turn execution ------------------

  /**
   * Drive a spirit through one or more multi-turn AI SDK steps. Each
   * model "step" produces one `kind='agent'` message in the task-run
   * channel, with any tool calls from that step encoded as
   * `tool.call` MessageCards on `messages.tool_calls`.
   */
  async run(input: RunSpiritInput): Promise<RunSpiritOutcome> {
    // Pre-flight: validate everything and resolve the model BEFORE
    // spawn(). Pre-fix, spawn() committed a Spirit + Run row and
    // registered the spirit, then code further down resolved the
    // team/org/agent/role/provider and called modelResolver. If any
    // of those threw (provider key missing, model id misconfigured,
    // upstream LLM resolver error), the spirit was left `queued`
    // (or `running` after the status flip below) with no actual
    // turn ever starting — a ghost spirit that misroutes future
    // alerts and leaves dirty state behind. Doing all the
    // throw-prone work first means a failure here surfaces before
    // any spirit row exists, leaving zero state to clean up.
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    const team = requireTeam(this.teamStore);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }
    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const teamRole = team.getRole(agent.roleName);
    if (!teamRole) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    // Resolve the model before committing the spirit. If the
    // provider/model resolver throws, no spirit row gets persisted
    // and no registry entry is created.
    const model = await Promise.resolve(
      this.modelResolver({
        organizationId: input.organizationId,
        memberId: input.memberId,
        role,
      }),
    );

    // Build the per-turn user prompt: the task prompt + last 20 channel
    // messages (oldest → newest) for situational context. Supervisors
    // pass `extraPrompt` for the alert text on top. (Reads only — safe
    // to do before spawn.)
    const recent = this.repo
      .listChannelMessages(input.organizationId, session.channelId, { limit: 20 })
      .data;
    const messages = toModelMessages(recent, member.id);
    const interruptCursor = createMessageCursor(recent);
    if (input.extraPrompt) {
      messages.push({ role: 'user', content: input.extraPrompt });
    } else {
      messages.push({
        role: 'user',
        content: session.prompt || 'Continue the task.',
      });
    }

    const system = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      session.channelId,
      agent,
      teamRole,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      team.channels,
      organization.organizationChart,
    );
    const systemPromptSuffix = this.resolveGoalSystemPromptSuffix(
      input.organizationId,
      input.taskSessionId,
      input.systemPromptSuffix,
    );
    const systemPrompt = systemPromptSuffix ? `${system}\n\n${systemPromptSuffix}` : system;

    // All validation passed. Now commit the spirit.
    const spirit = this.spawn({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
    });
    const runTranscript = buildRunTranscript(
      this.repo.listRunSteps(input.organizationId, spirit.runId ?? spirit.id),
    );
    if (runTranscript) {
      messages.push({ role: 'user', content: runTranscript });
    }

    // Mark running. Both the Spirit row and the paired Run row carry
    // the same status alphabet so the dashboards keep working.
    const running: Spirit = SpiritSchema.parse({
      ...spirit,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.repo.saveSpirit(running);
    this.registry.register(running);
    if (spirit.runId) {
      const run = this.repo.getRun(input.organizationId, spirit.runId);
      if (run) {
        this.repo.saveRun({ ...run, status: 'running', step: 'running', summary: 'Spirit turn' });
      }
    }
    this.emit(SocketEventNames.spiritUpdated, running);

    const allowedToolIds = this.resolveToolAllowlist(teamRole.tools, role, input.toolAllowlist);
    const builtInToolDefs = this.buildToolDefinitions(allowedToolIds, {
      organizationId: input.organizationId,
      runId: spirit.runId ?? spirit.id,
      memberId: input.memberId,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      // Tag every tool invocation with the spirit role so the policy
      // layer can enforce supervisor-only tools regardless of what
      // the role's allowlist happens to declare.
      spiritRole: role,
      team,
    });
    // Attached MCP tools layer ON TOP of the built-in palette. The
    // model sees one unified tool set; the namespacing keeps tool
    // ids unambiguous and the dispatch routes to the right server.
    const mcpToolDefs = await this.buildMcpToolDefinitions({
      organizationId: input.organizationId,
      memberId: input.memberId,
      runId: spirit.runId ?? spirit.id,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      role,
    });
    const toolDefs: ToolSet = { ...builtInToolDefs, ...mcpToolDefs };

    const maxIterations = input.maxIterations ?? this.maxIterationsPerRun;
    let totalTurns = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastText = '';
    let streamedReasoning = '';

    try {
      const result = await runAgentLoop({
        model,
        system: systemPrompt,
        messages,
        tools: toolDefs,
        stopWhen: stepCountIs(maxIterations),
        ...(this.maxOutputTokens !== undefined ? { maxOutputTokens: this.maxOutputTokens } : {}),
        temperature: this.temperature,
        onChunk: (chunk) => {
          if (chunk.kind === 'reasoning') streamedReasoning += chunk.delta;
          this.emitRunChunk(
            {
              organizationId: input.organizationId,
              runId: spirit.runId ?? spirit.id,
              threadId: session.channelId,
              agentId: input.memberId,
            },
            chunk,
          );
        },
        loadInterruptMessages: () => {
          const page = this.repo
            .listChannelMessages(input.organizationId, session.channelId, { limit: 100 })
            .data;
          const interrupts = page.filter(
            (message) =>
              message.kind === 'human' &&
              message.senderId !== member.id &&
              isMessageAfterCursor(message, interruptCursor),
          );
          const latest = page.at(-1);
          if (latest) {
            moveCursor(interruptCursor, latest);
          }
          return toModelMessages(interrupts, member.id);
        },
      });
      const { steps, usage } = result;

      // Each step in `steps` is one model turn. We persist one
      // `kind='agent'` message per step that produced text or tool
      // calls, with tool-call cards inlined. This keeps the channel
      // history readable as a turn-by-turn timeline.
      let lastMessageId: string | undefined;
      for (const [index, step] of steps.entries()) {
        totalTurns += 1;
        const stepText = typeof step.text === 'string' ? step.text : '';
        const stepToolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        const stepToolResults = Array.isArray(step.toolResults) ? step.toolResults : [];
        totalToolCalls += stepToolCalls.length;

        if (!stepText && stepToolCalls.length === 0) {
          continue;
        }

        const toolCalls = this.toMessageToolCalls(stepToolCalls, stepToolResults, spirit);
        const goalArtifactToolCall = await appendGoalArtifactToolCall(
          stepToolCalls,
          team.workspace.root,
        );
        const messageToolCalls = goalArtifactToolCall ? [...toolCalls, goalArtifactToolCall] : toolCalls;
        const reasoningContent =
          extractReasoningChunk(step) ??
          (index === steps.length - 1 ? streamedReasoning.trim() || undefined : undefined);
        const message = MessageSchema.parse({
          id: randomUUID(),
          organizationId: input.organizationId,
          threadId: session.channelId,
          channelId: session.channelId,
          senderId: member.id,
          senderKind: AGENT_KIND,
          kind: AGENT_KIND,
          content: stepText || `[tool turn — ${stepToolCalls.length} call(s)]`,
          toolCalls: messageToolCalls,
          metadata: { runId: spirit.runId ?? spirit.id },
          ...(reasoningContent ? { reasoningContent } : {}),
          createdAt: new Date().toISOString(),
        });
        this.repo.saveMessage(message);
        this.realtime.emit(
          SocketEventNames.channelMessage,
          {
            organizationId: input.organizationId,
            channelId: session.channelId,
            message,
          },
          [orgRoom(input.organizationId), channelRoom(session.channelId)],
        );
        lastText = stepText || lastText;
        lastMessageId = message.id;
      }

      // Prefer the provider-supplied `totalTokens` over our own
      // input+output sum. Some providers (and the V3 mock used in
      // tests) return non-numeric fields on `inputTokens` /
      // `outputTokens` that wouldn't sum to a number — and even when
      // they're flat, the sum can drift from `totalTokens` because
      // it ignores reasoning/cached tokens that the provider counts.
      // Falling back to the sum preserves behaviour when the provider
      // omits `totalTokens`. Coercing through `Number()` defends
      // against accidental non-numeric leaks reaching SpiritSchema's
      // `z.number().int().min(0)` validator.
      const usageInput = Number(usage?.inputTokens ?? 0) || 0;
      const usageOutput = Number(usage?.outputTokens ?? 0) || 0;
      const usageTotal = Number(usage?.totalTokens ?? 0);
      totalTokens = Number.isFinite(usageTotal) && usageTotal > 0
        ? usageTotal
        : usageInput + usageOutput;
      if (!Number.isFinite(totalTokens) || totalTokens < 0) {
        totalTokens = 0;
      }
      const completed: Spirit = SpiritSchema.parse({
        ...running,
        iteration: running.iteration + totalTurns,
        tokensUsed: running.tokensUsed + totalTokens,
        lastMessageId: lastMessageId ?? running.lastMessageId,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(completed);
      this.registry.unregister(completed.organizationId, completed.memberId, completed.id);
      if (spirit.runId) {
        const run = this.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            status: 'completed',
            step: 'completed',
            summary: lastText || run.summary,
            endedAt: new Date().toISOString(),
          });
        }
      }
      this.emit(SocketEventNames.spiritCompleted, completed);
      this.maybeFinalizeTaskSession(
        completed.organizationId,
        completed.taskSessionId,
        lastText || undefined,
      );

      return {
        spirit: completed,
        finalText: lastText,
        iterations: totalTurns,
        toolCalls: totalToolCalls,
        tokensUsed: totalTokens,
      };
    } catch (err) {
      if (err instanceof ToolApprovalRequiredError) {
        const waiting: Spirit = SpiritSchema.parse({
          ...running,
          status: 'waiting_for_approval',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(waiting);
        if (spirit.runId) {
          const run = this.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            this.repo.saveRun({
              ...run,
              status: 'waiting_for_approval',
              step: 'waiting_for_approval',
              summary: pendingApprovalRunSummary(this.repo, input.organizationId, spirit.runId),
            });
          }
        }
        this.emit(SocketEventNames.spiritUpdated, waiting);
        return {
          spirit: waiting,
          finalText: lastText,
          iterations: totalTurns,
          toolCalls: totalToolCalls,
          tokensUsed: totalTokens,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      const failed: Spirit = SpiritSchema.parse({
        ...running,
        status: 'failed',
        lastError: message,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(failed);
      this.registry.unregister(failed.organizationId, failed.memberId, failed.id);
      if (spirit.runId) {
        const run = this.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            status: 'failed',
            step: 'failed',
            summary: message,
            endedAt: new Date().toISOString(),
          });
        }
      }
      this.emit(SocketEventNames.spiritCompleted, failed);
      this.maybeFinalizeTaskSession(failed.organizationId, failed.taskSessionId, message);
      throw err;
    }
  }

  private resolveGoalSystemPromptSuffix(
    organizationId: string,
    taskSessionId: string,
    systemPromptSuffix?: string,
  ): string | undefined {
    const session = this.repo.getTaskSession(organizationId, taskSessionId) as TaskSession | null;
    const originMessageId = session?.origin?.messageId;
    const originMessage = originMessageId ? this.repo.getMessage(organizationId, originMessageId) : null;
    const goalSuffix = goalModeSystemPromptSuffix(goalModeEnabledFromMessage(originMessage));
    if (goalSuffix && systemPromptSuffix) {
      return `${systemPromptSuffix}\n\n${goalSuffix}`;
    }
    return systemPromptSuffix ?? goalSuffix;
  }

  private async runSupervisorAlertTurn(
    taskSessionId: string,
    input: SpiritAlertInput,
  ): Promise<SpiritSupervisorReplyOutcome> {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    if (!session) {
      const fallback = this.publishSupervisorFallback(taskSessionId, input, 'Task session not found');
      return { taskSessionId, message: fallback, fallback: true, reason: 'session-missing' };
    }
    if (session.supervisorTurnCount >= this.supervisorTurnCapPerSession) {
      const fallback = this.publishSupervisorCapMessage(taskSessionId, input);
      return { taskSessionId, message: fallback, fallback: true, reason: 'cap-reached' };
    }

    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const goalModeSuffix = goalModeSystemPromptSuffix(goalModeEnabledFromMessage(sourceMessage));

    try {
      const outcome = await this.run({
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        role: 'supervisor',
        maxIterations: 2,
        extraPrompt: this.buildSupervisorAlertContext(input),
        systemPromptSuffix: goalModeSuffix,
      });
      this.repo.saveTaskSession({
        ...session,
        supervisorTurnCount: session.supervisorTurnCount + 1,
        updatedAt: new Date().toISOString(),
      });
      const replyText = outcome.finalText.trim() || `Currently on step ${session.status} of #${session.slug}.`;
      const message = this.publishSupervisorReply(taskSessionId, input, replyText, false);
      return { taskSessionId, message, fallback: false, reason: 'ok' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = this.publishSupervisorFallback(taskSessionId, input, reason);
      return { taskSessionId, message, fallback: true, reason };
    }
  }

  private buildSupervisorAlertContext(input: SpiritAlertInput): string {
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const body = sourceMessage?.content ?? '';
    return [
      'You are answering a quick supervisor question or carrying out a direct action request.',
      ...MESSAGE_TOOL_USAGE_GUIDANCE,
      'If the request is only asking for status, give a short one-paragraph update.',
      '',
      `Reason: ${input.reason}`,
      `From: ${input.byMemberId}`,
      sourceMessage ? `In channel: ${sourceMessage.channelId ?? 'dm'}` : '',
      body ? `Question: ${body}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  private publishSupervisorReply(
    taskSessionId: string,
    input: SpiritAlertInput,
    body: string,
    fallback: boolean,
  ): Message {
    if (!this.conversations) {
      throw new Error('Conversation service is required for supervisor replies');
    }
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const channelId = sourceMessage?.channelId ?? input.channelId;
    if (!channelId) {
      return this.conversations.sendSelfNote({
        organizationId: input.organizationId,
        memberId: input.memberId,
        body,
      });
    }
    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: sourceMessage?.threadId ?? input.threadId,
      channelId,
      parentMessageId: sourceMessage?.id,
      senderId: input.memberId,
      senderKind: AGENT_KIND,
      kind: AGENT_KIND,
      content: body,
      createdAt: new Date().toISOString(),
    });
    this.conversations.publishMessage(message, []);
    this.realtime.emit(
      SocketEventNames.supervisorReplied,
      {
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        message,
        reason: fallback ? 'fallback' : input.reason,
      },
      [orgRoom(input.organizationId), channelRoom(channelId), memberRoom(input.memberId)],
    );
    return message;
  }

  private publishSupervisorFallback(
    taskSessionId: string,
    input: SpiritAlertInput,
    reason: string,
  ): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const summary = session?.summary?.trim() || (session ? `step ${session.status}` : 'in progress');
    const body = `Currently on ${summary} of #${slug}. Full activity in #${slug}. (supervisor fallback: ${reason})`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  private publishSupervisorCapMessage(taskSessionId: string, input: SpiritAlertInput): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const body = `Supervisor turn cap reached for #${slug} (${this.supervisorTurnCapPerSession} turns). Full activity in #${slug}.`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  private supervisorMutexKey(organizationId: string, memberId: string, taskSessionId: string): string {
    return `${organizationId}:${memberId}:${taskSessionId}:supervisor`;
  }

  private supervisorDebounceKey(organizationId: string, memberId: string, taskSessionId: string): string {
    return `${organizationId}:${memberId}:${taskSessionId}`;
  }

  private shouldDebounceSupervisorAlert(
    organizationId: string,
    memberId: string,
    taskSessionId: string,
  ): boolean {
    const last = this.supervisorLastAlertAt.get(
      this.supervisorDebounceKey(organizationId, memberId, taskSessionId),
    );
    if (last === undefined) return false;
    return Date.now() - last < this.supervisorDebounceMs;
  }

  async resumeAfterApproval(
    organizationId: string,
    runId: string,
    allowRun = true,
    approvalScope?: string,
  ): Promise<RunSpiritOutcome | Spirit | null> {
    const spirit = this.findActiveSpiritByRunId(organizationId, runId);
    if (!spirit) return null;

    if (allowRun) {
      this.tools.allowRun(organizationId, runId, approvalScope);
    } else {
      const failed = this.updateStatus(organizationId, spirit.id, 'failed', {
        error: 'Approval rejected by user',
      });
      const run = this.repo.getRun(organizationId, runId);
      if (run) {
        this.repo.saveRun({
          ...run,
          status: 'failed',
          step: 'failed',
          summary: 'Approval rejected by user',
          endedAt: run.endedAt ?? new Date().toISOString(),
        });
      }
      return failed;
    }

    if (spirit.status === 'running') {
      return spirit;
    }

    if (spirit.status !== 'waiting_for_approval') {
      return spirit;
    }

    await this.executePendingApprovedTools(spirit);
    return this.run({
      organizationId,
      taskSessionId: spirit.taskSessionId,
      memberId: spirit.memberId,
      role: spirit.role,
    });
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  private findActiveSpiritByRunId(organizationId: string, runId: string): Spirit | null {
    for (const member of this.repo.listMembers(organizationId)) {
      if (member.kind !== AGENT_KIND) continue;
      const spirit = this.repo
        .listActiveSpiritsForMember(organizationId, member.id)
        .find((item) => item.runId === runId);
      if (spirit) return spirit;
    }
    return null;
  }

  /**
   * Only @mentions on shared org surfaces (not dedicated task-run channels)
   * may fall back to the newest active spirit when no session surface matches.
   */
  private isBroadOrgChannelSurface(
    organizationId: string,
    threadId: string,
    channelId?: string,
  ): boolean {
    const getChannel = this.repo.getChannel;
    if (typeof getChannel !== 'function') return false;
    const check = (surfaceId: string): boolean => {
      const ch = getChannel.call(this.repo, organizationId, surfaceId);
      if (!ch) return false;
      return ch.kind === 'general' || ch.kind === 'group' || ch.kind === 'dm';
    };
    if (check(threadId)) return true;
    if (channelId && channelId !== threadId && check(channelId)) return true;
    return false;
  }

  private findActiveSpiritForThread(
    active: ActiveSpiritEntry[],
    organizationId: string,
    threadId: string,
    channelId?: string,
  ): ActiveSpiritEntry | null {
    if (active.length === 0) return null;

    const matchesSurface = (entry: ActiveSpiritEntry): boolean => {
      const session = this.repo.getTaskSession(entry.organizationId, entry.taskSessionId);
      if (!session) return false;
      if (session.channelId === threadId || (channelId !== undefined && session.channelId === channelId)) {
        return true;
      }
      const { origin } = session;
      if (
        origin.channelId &&
        (origin.channelId === threadId || (channelId !== undefined && origin.channelId === channelId))
      ) {
        return true;
      }
      if (origin.threadId && origin.threadId === threadId) {
        return true;
      }
      return false;
    };

    const direct = active.find((entry) => matchesSurface(entry));
    if (direct) return direct;

    if (this.isBroadOrgChannelSurface(organizationId, threadId, channelId)) {
      return active[0] ?? null;
    }
    return null;
  }

  private async executePendingApprovedTools(spirit: Spirit): Promise<void> {
    const runId = spirit.runId ?? spirit.id;
    const pendingApprovalToolCallIds = new Set(
      this.repo
        .listPendingApprovals(spirit.organizationId)
        .filter((approval) => approval.runId === runId && approval.toolCallId)
        .map((approval) => approval.toolCallId as string),
    );
    const pendingSteps = this.repo
      .listRunSteps(spirit.organizationId, runId)
      .filter((step) => {
        const output = step.output as { status?: unknown } | undefined;
        return (
          output?.status === 'waiting_for_approval' &&
          !pendingApprovalToolCallIds.has(step.toolCallId)
        );
      });

    for (const step of pendingSteps) {
      const invocation: ToolInvocationInput = {
        organizationId: step.organizationId,
        runId: step.runId,
        memberId: step.agentId,
        threadId: step.threadId,
        taskSessionId: spirit.taskSessionId,
        spiritRole: spirit.role,
        toolCallId: step.toolCallId,
        toolId: step.toolId,
        action: step.action,
        resourceType: step.resourceType,
        resourcePath: step.resourcePath || undefined,
        input: step.input,
        bypassPermission: true,
      };

      try {
        await this.tools.invoke(invocation);
      } catch {
        // ToolService persists the failed step; keep replaying the rest.
      }
    }
  }

  private resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[] {
    if (override) return override;
    if (role === 'supervisor') {
      return SUPERVISOR_TOOL_ALLOWLIST;
    }
    return [...new Set([...roleTools, ...ALWAYS_AVAILABLE_AGENT_TOOLS])];
  }

  private buildToolDefinitions(
    toolIds: readonly string[],
    ctx: {
      organizationId: string;
      runId: string;
      memberId: string;
      threadId: string;
      taskSessionId: string;
      spiritRole: SpiritRole;
      team: AgentTeamHandle;
    },
  ): ToolSet {
    return buildToolDefinitions(toolIds, ctx.team, this.tools, ctx);
  }

  private toMessageToolCalls(
    stepToolCalls: readonly { toolCallId?: string; toolName?: string; input?: unknown }[],
    stepToolResults: readonly { toolCallId?: string; output?: unknown }[],
    spirit: Spirit,
  ): MessageToolCall[] {
    const resultsById = new Map<string, unknown>();
    for (const r of stepToolResults) {
      if (typeof r.toolCallId === 'string') {
        resultsById.set(r.toolCallId, r.output);
      }
    }
    return stepToolCalls.map((call) => {
      const toolCallId = call.toolCallId ?? randomUUID();
      const toolName = call.toolName ?? 'unknown';
      const args = (call.input as Record<string, unknown> | undefined) ?? {};
      const result = resultsById.get(toolCallId);
      const isError = isToolCardError(result);
      const card: MessageCard = {
        kind: 'tool.call',
        cardId: randomUUID(),
        taskSessionId: spirit.taskSessionId,
        runId: spirit.runId,
        toolCallId,
        toolName,
        args,
        result,
        isError,
      };
      return {
        toolCallId,
        toolName,
        args,
        result: card,
        isError,
      };
    });
  }

  private emit(event: string, spirit: Spirit): void {
    this.realtime.emit(
      event as Parameters<RealtimeService['emit']>[0],
      { organizationId: spirit.organizationId, spirit },
      [
        orgRoom(spirit.organizationId),
        memberRoom(spirit.memberId),
        ...(spirit.runId ? [runRoom(spirit.runId)] : []),
      ],
    );
  }

  private emitRunChunk(
    input: {
      organizationId: string;
      runId: string;
      threadId: string;
      agentId: string;
    },
    chunk: AgentLoopChunk,
  ): void {
    if (!chunk.delta || !input.threadId) {
      return;
    }

    this.realtime.emit(
      SocketEventNames.runChunk,
      {
        organizationId: input.organizationId,
        runId: input.runId,
        threadId: input.threadId,
        agentId: input.agentId,
        kind: chunk.kind,
        delta: chunk.delta,
      },
      [
        orgRoom(input.organizationId),
        channelRoom(input.threadId),
        threadRoom(input.threadId),
        memberRoom(input.agentId),
        runRoom(input.runId),
      ],
    );
  }

  private maybeFinalizeTaskSession(
    organizationId: string,
    taskSessionId: string,
    preferredSummary?: string,
  ): void {
    const session = this.repo.getTaskSession(organizationId, taskSessionId);
    if (!session || TERMINAL_TASK_SESSION_STATUSES.has(session.status)) {
      return;
    }

    const workers = this.repo
      .listSpiritsForSession(organizationId, taskSessionId)
      .filter((spirit) => spirit.role === 'worker');
    if (workers.length === 0) {
      return;
    }
    if (workers.some((spirit) => LIVE_SPIRIT_STATUSES.has(spirit.status))) {
      return;
    }

    // Task sessions close only when every worker spirit is terminal. That lets
    // the public task-run channel act as the canonical end-of-run surface even
    // though the actual execution happened inside private worker spirits.
    const outcome = deriveTaskSessionOutcome(workers);
    const completedAt = new Date().toISOString();
    const summary = this.buildTaskSessionSummary(organizationId, session, workers, preferredSummary);
    const updated = this.repo.updateTaskSessionStatus(organizationId, taskSessionId, outcome, {
      summary,
      completedAt,
    });
    if (!updated) {
      return;
    }

    this.publishTaskSummaryMessages(
      TaskSessionSchema.parse(updated),
      outcome,
      summary,
    );
  }

  private buildTaskSessionSummary(
    organizationId: string,
    session: { slug: string; summary: string },
    workers: Spirit[],
    preferredSummary?: string,
  ): string {
    const trimmedPreferred = preferredSummary?.trim();
    if (trimmedPreferred) {
      return trimmedPreferred;
    }

    const latestWithMessage = workers
      .slice()
      .reverse()
      .find((spirit) => spirit.lastMessageId && this.repo.getMessage(organizationId, spirit.lastMessageId));
    if (latestWithMessage?.lastMessageId) {
      const latestMessage = this.repo.getMessage(organizationId, latestWithMessage.lastMessageId);
      const content = latestMessage?.content.trim();
      if (content) {
        return content;
      }
    }

    const failed = workers.find((spirit) => spirit.status === 'failed');
    if (failed?.lastError) {
      return failed.lastError;
    }

    const completedNames = workers
      .filter((spirit) => spirit.status === 'completed')
      .map((spirit) => this.repo.getMember(organizationId, spirit.memberId)?.name ?? spirit.memberId);
    if (completedNames.length > 0) {
      return `Completed by ${completedNames.join(', ')}`;
    }

    return session.summary.trim() || `Task #${session.slug} finished`;
  }

  private publishTaskSummaryMessages(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      slug: string;
      origin: { threadId?: string; channelId?: string };
    },
    outcome: 'completed' | 'failed' | 'cancelled',
    summary: string,
  ): void {
    const card: MessageCard = {
      kind: 'task.summary',
      cardId: randomUUID(),
      taskSessionId: session.id,
      taskChannelId: session.channelId,
      taskSlug: session.slug,
      outcome,
      summary,
    };

    const statusVerb =
      outcome === 'completed' ? 'completed' : outcome === 'failed' ? 'failed' : 'cancelled';

    this.publishSystemCardMessage({
      organizationId: session.organizationId,
      threadId: session.channelId,
      channelId: session.channelId,
      content: `Task #${session.slug} ${statusVerb}: ${summary}`,
      card,
    });

    const general = this.repo
      .listAllChannels(session.organizationId)
      .find((channel) => channel.kind === 'general' || channel.id === 'general' || channel.name === 'general');
    const linkbackTargets = new Map<string, { threadId: string; channelId?: string }>();
    if (general && general.id !== session.channelId) {
      linkbackTargets.set(general.id, { threadId: general.id, channelId: general.id });
    }
    if (session.origin.channelId && session.origin.channelId !== session.channelId) {
      linkbackTargets.set(session.origin.channelId, {
        threadId: session.origin.channelId,
        channelId: session.origin.channelId,
      });
    }
    if (session.origin.threadId && session.origin.threadId !== session.channelId) {
      linkbackTargets.set(session.origin.threadId, {
        threadId: session.origin.threadId,
        channelId: session.origin.channelId,
      });
    }

    for (const target of linkbackTargets.values()) {
      this.publishSystemCardMessage({
        organizationId: session.organizationId,
        threadId: target.threadId,
        channelId: target.channelId,
        content: `Task #${session.slug} ${statusVerb} — see #${session.slug}`,
        card,
      });
    }
  }

  private publishSystemCardMessage(input: {
    organizationId: string;
    threadId: string;
    channelId?: string;
    content: string;
    card: MessageCard;
  }): void {
    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: input.content,
      mentions: [],
      toolCalls: [
        {
          toolCallId: input.card.cardId,
          toolName: `card.${input.card.kind}`,
          args: input.card as unknown as Record<string, unknown>,
          isError: false,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    if (this.conversations) {
      this.conversations.publishMessage(message, []);
      return;
    }

    this.repo.saveMessage(message);
    this.realtime.emit(
      input.channelId ? SocketEventNames.channelMessage : SocketEventNames.threadMessage,
      input.channelId
        ? {
            organizationId: input.organizationId,
            channelId: input.channelId,
            message,
          }
        : {
            organizationId: input.organizationId,
            threadId: input.threadId,
            message,
          },
      input.channelId
        ? [orgRoom(input.organizationId), channelRoom(input.channelId)]
        : [orgRoom(input.organizationId), threadRoom(input.threadId)],
    );
  }

  private defaultModelResolver(): ModelResolver {
    return ({ organizationId, memberId, role }) => {
      const team = requireTeam(this.teamStore);
      const member = this.repo.getMember(organizationId, memberId);
      if (!member) {
        throw new Error(`Member not found: ${memberId}`);
      }
      return resolveSpiritModel({
        organizationId,
        memberId,
        role,
        member,
        team,
        getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
        resolveProviderName: defaultResolveProviderName,
        resolveModelId: defaultResolveModelId,
      });
    };
  }

  /**
   * Production MCP resolver: walks `listAttachedServersForSpirit` on
   * the repo and materialises an `MCPDef` per attachment, decoding the
   * stored env-key-ref via the secret store. Disabled servers are
   * filtered out by the repo query itself.
   */
  private defaultMcpResolver(): SpiritMcpResolver {
    return async ({ organizationId, memberId, role }) => {
      const attachments = this.repo.listAttachedServersForSpirit(
        organizationId,
        memberId,
        role,
      );
      return attachments.map(({ server }) => {
        const def = this.mcpServerToDef(server);
        return { def, serverId: server.id, serverName: server.name };
      });
    };
  }

  private mcpServerToDef(server: {
    id: string;
    name: string;
    description: string;
    category: string;
    transport: 'stdio' | 'sse' | 'http-streamable';
    command?: string;
    args: string[];
    envKeyRef?: string;
    url?: string;
    headersKeyRef?: string;
    isolation: 'shared' | 'per-agent';
  }): MCPDef {
    return materializeMcpDef(this.repo, server);
  }

  /**
   * Build AI SDK tool definitions for every MCP attached to this
   * (member, role). Tool ids are namespaced with the display slug and
   * a stable server-id hash so similar server names cannot overwrite
   * each other in the flattened AI SDK tool palette.
   */
  private async buildMcpToolDefinitions(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<ToolSet> {
    if (!this.mcpPool || !this.mcpResolver) return {} as ToolSet;
    let resolutions: SpiritMcpResolution[];
    try {
      resolutions = await this.mcpResolver({
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        role: ctx.role,
      });
    } catch {
      return {} as ToolSet;
    }
    if (resolutions.length === 0) return {} as ToolSet;

    type ToolEntry = readonly [
      string,
      {
        toolName: string;
        description: string;
        serverId: string;
        serverName: string;
        /**
         * MCP-provided JSON schema for this tool's arguments, if the
         * server advertised one. Threaded through so the AI SDK tool
         * definition surfaces the real parameter contract to the
         * model instead of a free-form `Record<string, unknown>`.
         */
        inputSchema?: Record<string, unknown>;
      },
    ];
    const entries: ToolEntry[] = [];
    const usedToolIds = new Set<string>();
    const pool = this.mcpPool;
    for (const resolution of resolutions) {
      let toolList: McpToolDescriptor[] = [];
      try {
        const connection = await pool.get(resolution.def, { agentId: ctx.memberId });
        const liveTools = await connection.listTools();
        toolList = liveTools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
              ? (t.inputSchema as Record<string, unknown>)
              : undefined,
        }));
      } catch {
        // Live discovery failed — fall back to whatever the registry's
        // last successful test wrote into the cache. Audit-fix
        // contract: a transient outage shouldn't drop the MCP from
        // the model's palette.
        toolList = this.repo.getMcpToolCache(ctx.organizationId, resolution.serverId)?.tools ?? [];
      }
      const nsSlug = buildMcpNamespace(resolution.serverName, resolution.serverId);
      for (const t of toolList) {
        const baseToolId = `mcp__${nsSlug}__${sanitizeMcpToolName(t.name)}`;
        const aiToolId = uniqueMcpToolId(baseToolId, resolution.serverId, t.name, usedToolIds);
        entries.push([
          aiToolId,
          {
            toolName: t.name,
            description: t.description || `${resolution.serverName}.${t.name}`,
            serverId: resolution.serverId,
            serverName: resolution.serverName,
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
                ? (t.inputSchema as Record<string, unknown>)
                : undefined,
          },
        ]);
      }
    }
    // Build the AI SDK tool defs in a separate pass so the per-iteration
    // `tool({...})` keeps its generic resolved — collecting them into a
    // Record<string, ReturnType<typeof tool>> first collapses the
    // generic to `Tool<never, never>` and breaks assignment.
    return Object.fromEntries(
      entries.map(([aiToolId, entry]) => [
        aiToolId,
        tool({
          description: entry.description,
          inputSchema: mcpToolInputSchema(entry.inputSchema),
          execute: async (rawArgs, { toolCallId }) => {
            const args = (rawArgs ?? {}) as Record<string, unknown>;
            try {
              const result = await this.tools.invoke({
                organizationId: ctx.organizationId,
                runId: ctx.runId,
                memberId: ctx.memberId,
                threadId: ctx.threadId,
                taskSessionId: ctx.taskSessionId,
                spiritRole: ctx.role,
                toolCallId,
                toolId: 'mcp',
                action: 'mcp',
                resourceType: 'mcp',
                resourcePath: `${entry.serverId}:${entry.toolName}`,
                permissionMcpId: entry.serverId,
                permissionToolName: mcpPermissionToolName(entry.serverId, entry.toolName),
                input: {
                  mcpServerId: entry.serverId,
                  mcpServerName: entry.serverName,
                  toolName: entry.toolName,
                  args,
                },
              });
              return toModelToolOutput(result);
            } catch (error) {
              if (error instanceof ToolApprovalRequiredError) {
                throw error;
              }
              return {
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        }),
      ]),
    ) as ToolSet;
  }
}

/**
 * Make a server-name segment safe for use inside the AI SDK tool id.
 * AI SDK tool ids are typically `[A-Za-z0-9_-]+`; we lowercase, replace
 * everything else with `_`, and trim to a reasonable length.
 */
function sanitizeMcpNamespace(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'mcp';
}

function buildMcpNamespace(name: string, serverId: string): string {
  const hash = shortStableHash(serverId);
  const maxNameLength = 40 - hash.length - 1;
  const nameSlug = sanitizeMcpNamespace(name).slice(0, maxNameLength).replace(/_+$/g, '');
  return `${nameSlug || 'mcp'}_${hash}`;
}

function sanitizeMcpToolName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'tool';
}

function uniqueMcpToolId(
  baseToolId: string,
  serverId: string,
  toolName: string,
  usedToolIds: Set<string>,
): string {
  if (!usedToolIds.has(baseToolId)) {
    usedToolIds.add(baseToolId);
    return baseToolId;
  }

  const suffix = shortStableHash(`${serverId}:${toolName}`);
  let candidate = `${baseToolId}__${suffix}`;
  let attempt = 2;
  while (usedToolIds.has(candidate)) {
    candidate = `${baseToolId}__${suffix}_${attempt}`;
    attempt += 1;
  }
  usedToolIds.add(candidate);
  return candidate;
}

function shortStableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Build the AI SDK `inputSchema` for an MCP tool definition.
 *
 * When the MCP server advertises a JSON Schema for the tool's args, we
 * surface it verbatim via `jsonSchema()` so the model sees the real
 * parameter contract — type info, required fields, enums, descriptions,
 * the lot. The previous free-form `z.record(z.string(), z.unknown())`
 * stripped all of that, which left the model guessing arg shapes and
 * frequently producing malformed calls.
 *
 * When the server doesn't advertise a schema (some MCPs emit
 * `inputSchema: undefined` for legacy reasons), we fall back to a
 * permissive record so the call is still possible. This is the same
 * shape the prior implementation used everywhere — we keep it as the
 * floor, not the default.
 */
function mcpToolInputSchema(
  schema: Record<string, unknown> | undefined,
): FlexibleSchema<Record<string, unknown>> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return jsonSchema<Record<string, unknown>>(schema as never);
  }
  return z.record(z.string(), z.unknown());
}

const LIVE_SPIRIT_STATUSES = new Set(['queued', 'running', 'waiting_for_approval']);
const TERMINAL_TASK_SESSION_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function deriveTaskSessionOutcome(
  workers: readonly Spirit[],
): 'completed' | 'failed' | 'cancelled' {
  if (workers.some((spirit) => spirit.status === 'failed')) {
    return 'failed';
  }
  if (workers.every((spirit) => spirit.status === 'completed')) {
    return 'completed';
  }
  return 'cancelled';
}

export { defaultResolveModelId as _defaultResolveModelId } from '../utils/to-model-messages.js';

/**
 * Cheaper-tier provider selection helper. Exported so the
 * SupervisorService and any future tier-aware routing can share the
 * same fallback ladder.
 *
 * Order:
 *   1. role==='supervisor' && provider.supervisorModel → supervisor tier
 *   2. role==='supervisor' && provider.supervisor_model → snake_case alias
 *   3. teamRole.model ?? provider.defaultModel → standard worker tier
 */
export function pickProviderModel(input: {
  teamRole: { model?: string };
  provider: { defaultModel?: string };
  role: SpiritRole;
}): string | undefined {
  return defaultResolveModelId(
    input.teamRole,
    input.provider as { defaultModel?: string; supervisorModel?: string; supervisor_model?: string },
    input.role,
  );
}

function isToolCardError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const value = result as { error?: unknown; status?: unknown; isError?: unknown };
  return value.isError === true || typeof value.error === 'string' || value.status === 'blocked';
}
