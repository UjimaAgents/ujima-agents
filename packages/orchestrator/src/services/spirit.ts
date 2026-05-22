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
  type RunStep,
  type RunState,
  type Spirit,
  type SpiritRole,
  type TaskSession,
  type WakeReason,
  AGENT_KIND,
  isDirectMessageThread,
} from '@ujima/shared';
import {
  MESSAGE_TOOL_USAGE_GUIDANCE,
  buildAgentSystemPrompt,
  type AgentTeamHandle,
} from '@ujima/framework';
import {
  filterToolsForWakeReplyPolicy,
  resolveWakeReplyPolicy,
} from '../utils/wake-reply-policy.js';
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
import { ActiveSpiritRegistry, type ActiveSpiritEntry } from './active-spirit-registry.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
import { findToolApprovalRequiredError, toModelToolErrorOutput, toModelToolOutput } from './tool-loop-result.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { errorMessage } from '../utils/error-message.js';
import { buildRunTranscript } from '../utils/run-transcript.js';
import type { ToolInvocationInput } from './tool-service.js';
import { materializeMcpDef, mcpPermissionToolName, type McpRuntimePool } from './mcp-runtime.js';
import { appendGoalArtifactToolCall, buildGoalArtifactMessage } from './goal-artifact-card.js';
import { goalModeEnabledFromMessage, goalModeSystemPromptSuffix } from './goal-mode-prompt.js';
import { scheduleToolSystemPromptSuffix } from './schedule-prompt.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import { applyDashboardTeamOverrides } from './dashboard-team-overrides.js';
import { isLiveRunStatus, isLiveSpiritStatus } from './live-status.js';
import type { AiService } from '../ai-service.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  runUsedChannelPass,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';
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
   * Optional direct-run adapter. When present, SpiritService can own the
   * thread-run path instead of a separate RunService implementation.
   */
  ai?: AiService;
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

export interface CreateRunInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  summary?: string;
  /** Why this run was woken — drives mandatory-reply enforcement. */
  wakeReason?: WakeReason;
  /** Message id that triggered this run, when applicable. */
  sourceMessageId?: string;
  /** Who triggered the wake (for mandatory-reply failure attribution). */
  byMemberId?: string;
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
  /**
   * Name of the highest-precedence terminating tool that fired in this
   * run, or `null` if none fired. Publishing tools (`message`,
   * `channel.post`, `channel.reply`, `channel.dm`, `channel.handoff`)
   * indicate the agent already delivered its reply via tool call, so
   * callers must NOT treat an empty `finalText` as a failure.
   * `channel.pass` is reported here too — it terminates the run but
   * publishes nothing.
   */
  terminatingTool: string | null;
}

export interface RunDetailAggregate {
  count: number;
  pending: number;
}

export interface RunTraceDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: Message[];
  steps: RunStep[];
  message?: Message;
}

export interface RunDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: ReturnType<ApiRepository['listMessages']>['data'];
  steps: RunStep[];
  message?: Message;
  activeAgents: { memberId: string; statusLabel: string }[];
  tokens: { perMemberId: Record<string, number> };
  tools: Record<string, RunDetailAggregate>;
}

export interface SpiritAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  messageId: string;
  threadId: string;
  byMemberId: string;
  reason: string;
  /**
   * L7 — typed wake reason. When `wakeReason === 'mention'` the
   * supervisor turn is held to the same mandatory-reply contract
   * as the worker path: `channel.pass` / `self.note` are rejected
   * by policy, and a supervisor turn that ends without publishing
   * is fail-converted.
   */
  wakeReason?: WakeReason;
}

export interface SpiritSupervisorReplyOutcome {
  taskSessionId: string;
  /**
   * The message we published from this dispatcher. `null` when the
   * supervisor already published its reply via a terminating tool
   * (e.g. `channel.reply`) — in that case the tool wrote the visible
   * message and the dispatcher emits nothing on top.
   */
  message: Message | null;
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
  private readonly ai?: AiService;
  private readonly mcpPool?: SpiritMcpPool;
  private readonly mcpResolver?: SpiritMcpResolver;
  private readonly supervisorDebounceMs: number;
  private readonly supervisorTurnCapPerSession: number;
  private readonly supervisorMutexes = new Map<string, Promise<unknown>>();
  private readonly supervisorLastAlertAt = new Map<string, number>();
  private readonly deferredApprovalResumes = new Set<string>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  // Late-bound hook fired when `completeRun` / `failRun` persist a
  // terminal run row. Used by the commitment service to track empty
  // self-followup wakes and short-circuit `due_at` after K consecutive
  // empties. Failures inside the hook are swallowed so a flaky
  // post-completion handler can't fail the run.
  private runCompletedHook?: (run: RunState) => Promise<void> | void;

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
    this.ai = options.ai;
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
    // L7 — mention/DM wakes key debounce by messageId; other wakes coalesce per session.
    const debounceMessageKey =
      input.wakeReason === 'mention' || input.wakeReason === 'dm' ? input.messageId : undefined;
    if (
      this.shouldDebounceSupervisorAlert(
        input.organizationId,
        input.memberId,
        target.taskSessionId,
        debounceMessageKey,
      )
    ) {
      return { kind: 'debounced' };
    }

    this.supervisorLastAlertAt.set(
      this.supervisorDebounceKey(
        input.organizationId,
        input.memberId,
        target.taskSessionId,
        debounceMessageKey,
      ),
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
      endedAt: isLiveSpiritStatus(status) ? existing.endedAt : (existing.endedAt ?? now),
    });
    this.repo.saveSpirit(updated);
    if (isLiveSpiritStatus(status)) {
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
    const team = requireTeam(this.teamStore, input.organizationId);
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

    // System prompt is built later (after the tool palette is
    // resolved) so the "Available tools:" line can reflect the actual
    // ids handed to runAgentLoop, including MCP tools. Building it
    // here with only `role.tools` produces "Available tools: none"
    // for roles whose config has no tools array, and the model takes
    // that line as ground truth and denies tools it actually has.

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

    // Mandatory-reply enforcement at the palette layer (matches
    // ai-service.ts wake-run path): when the supervisor turn is
    // triggered by a mention wake, strip channel.pass and
    // self.note so the model cannot opt out of replying.
    const resolvedAllowlist = this.resolveToolAllowlist(teamRole.tools, role, input.toolAllowlist);
    const supervisorRunRow =
      spirit.runId !== undefined
        ? this.repo.getRun(input.organizationId, spirit.runId)
        : undefined;
    const supervisorWakePolicy = resolveWakeReplyPolicy({
      threadId: session.channelId,
      wakeReason: supervisorRunRow?.wakeReason as WakeReason | undefined,
    });
    const allowedToolIds = filterToolsForWakeReplyPolicy(
      resolvedAllowlist,
      supervisorWakePolicy,
    );
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
      repo: this.repo,
    });
    // Attached MCP tools layer ON TOP of the built-in palette. The
    // model sees one unified tool set; the namespacing keeps tool
    // ids unambiguous and the dispatch routes to the right server.
    const { toolSet: mcpToolDefs, servers: attachedMcpServers } = await this.buildMcpToolDefinitions({
      organizationId: input.organizationId,
      memberId: input.memberId,
      runId: spirit.runId ?? spirit.id,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      role,
    });
    const toolDefs: ToolSet = { ...builtInToolDefs, ...mcpToolDefs };

    // Now that the full palette is resolved, build the system prompt
    // with the exact tool ids the model will see. The
    // "Available tools:" line must match the AI-SDK schema or the
    // model can deny tools it actually has (the original report:
    // Phoebe with a Playwright MCP attached saying "I don't have a
    // Playwright tool" because role.tools was [] and the prompt said
    // "Available tools: none").
    const availableToolIds = Object.keys(toolDefs);
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
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      supervisorWakePolicy.conversationKind,
    );
    const systemPromptSuffix = this.resolveGoalSystemPromptSuffix(
      input.organizationId,
      input.taskSessionId,
      input.systemPromptSuffix,
    );
    const systemPrompt = systemPromptSuffix ? `${system}\n\n${systemPromptSuffix}` : system;

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
        // Force step-0 tool call so the spirit commits to either a
        // visible action or `channel.pass` quickly. Continuation
        // steps stay `auto` so multi-tool sequences are unaffected.
        toolChoice: 'required-first-step',
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
        if (!stepText && !goalArtifactToolCall) {
          continue;
        }
        const message = MessageSchema.parse({
          id: randomUUID(),
          organizationId: input.organizationId,
          threadId: session.channelId,
          channelId: session.channelId,
          senderId: member.id,
          senderKind: AGENT_KIND,
          kind: AGENT_KIND,
          content: stepText || 'Goal artifact updated.',
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
      // Persisted run-steps act as a safety net when provider/SDK
      // result shapes drop tool names from the final step object —
      // the tool service writes the canonical id after each call.
      const persistedRunSteps = spirit.runId
        ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
        : [];
      const detectedTerminatingTool =
        findTerminatingTool(result) ?? findTerminatingToolFromRunSteps(persistedRunSteps);
      // Resolve the final terminator, preserving any silent
      // terminator a mid-run side-effect (mirror-loop guard, vacuous-
      // ack suppression) already wrote onto the run row. Without this
      // preservation step, the freshly-computed `detected` value
      // (which sees the model's original `channel.reply` toolcall via
      // `result.steps`) would clobber the `channel.ack` that the
      // mirror-suppress flow persisted earlier — and metrics would
      // report a publish that never actually went through.
      const persistedRun = spirit.runId
        ? this.repo.getRun(input.organizationId, spirit.runId)
        : null;
      const persistedTerminator = persistedRun?.terminatingTool;
      const persistedIsSilent =
        persistedTerminator === 'channel.ack' || persistedTerminator === 'channel.pass';
      const terminatingTool = persistedIsSilent
        ? persistedTerminator
        : detectedTerminatingTool;
      if (persistedRun) {
        this.repo.saveRun({
          ...persistedRun,
          status: 'completed',
          step: 'completed',
          summary: lastText || persistedRun.summary,
          endedAt: new Date().toISOString(),
          terminatingTool,
        });
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
        terminatingTool,
      };
    } catch (err) {
      if (findToolApprovalRequiredError(err)) {
        const waiting: Spirit = SpiritSchema.parse({
          ...running,
          status: 'waiting_for_approval',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(waiting);
        // Approval-paused turns: a tool fired but its result is
        // deferred, so we can only consult persisted run-steps here.
        const pausedRunSteps = spirit.runId
          ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
          : [];
        const pausedTerminatingTool = findTerminatingToolFromRunSteps(pausedRunSteps);
        if (spirit.runId) {
          const run = this.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            this.repo.saveRun({
              ...run,
              status: 'waiting_for_approval',
              step: 'waiting_for_approval',
              summary: pendingApprovalRunSummary(this.repo, input.organizationId, spirit.runId),
              terminatingTool: pausedTerminatingTool,
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
          terminatingTool: pausedTerminatingTool,
        };
      }
      const message = errorMessage(err);
      const failed: Spirit = SpiritSchema.parse({
        ...running,
        status: 'failed',
        lastError: message,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(failed);
      this.registry.unregister(failed.organizationId, failed.memberId, failed.id);
      // Mirror terminatingTool on the failure path too — a turn can
      // fail after a tool fired (e.g. policy block on a later step),
      // and postmortem analysis benefits from seeing that the agent
      // *did* terminate via a specific tool before the run died.
      const failedRunSteps = spirit.runId
        ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
        : [];
      const failedTerminatingTool = findTerminatingToolFromRunSteps(failedRunSteps);
      if (spirit.runId) {
        const run = this.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            status: 'failed',
            step: 'failed',
            summary: message,
            endedAt: new Date().toISOString(),
            terminatingTool: failedTerminatingTool,
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
    const goalSuffix = goalModeSystemPromptSuffix({
      goalMode: goalModeEnabledFromMessage(originMessage),
      messageContent: originMessage?.content,
    });
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
    const goalModeSuffix = goalModeSystemPromptSuffix({
      goalMode: goalModeEnabledFromMessage(sourceMessage),
      messageContent: sourceMessage?.content,
    });

    // B1 fix — persist wakeReason / byMemberId / sourceMessageId on
    // the spirit's run row BEFORE the supervisor turn fires. This is
    // what ToolServiceImpl reads to enforce the mandatory-reply
    // contract (policy.ts rejects channel.pass and self.note when
    // wakeReason === 'mention'). Without this, supervisor turns
    // silently bypass the contract.
    if (input.wakeReason) {
      const supervisorSpirit = this.repo
        .listActiveSpiritsForMember(input.organizationId, input.memberId)
        .find((s) => s.taskSessionId === taskSessionId);
      const runId = supervisorSpirit?.runId;
      if (runId) {
        const run = this.repo.getRun(input.organizationId, runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            wakeReason: input.wakeReason,
            sourceMessageId: input.messageId,
            byMemberId: input.byMemberId,
          });
        }
      }
    }

    try {
      const outcome = await this.run({
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        role: 'supervisor',
        maxIterations: 2,
        extraPrompt: this.buildSupervisorAlertContext(taskSessionId, input),
        systemPromptSuffix: goalModeSuffix,
      });
      this.repo.saveTaskSession({
        ...session,
        supervisorTurnCount: session.supervisorTurnCount + 1,
        updatedAt: new Date().toISOString(),
      });
      // L7 — mandatory-reply for supervisor turns. When a
      // `@mention` lands and the supervisor produces no reply
      // text AND no terminating tool fired, the fallback summary
      // masks a real failure (the human asked, the agent didn't
      // answer). For mention wakes we surface the failure event
      // INSTEAD of publishing the canned status fallback.
      //
      // Why also check `terminatingTool`: under the read-all/
      // speak-when-useful palette, supervisors reply via
      // terminating tools (`channel.reply`, `channel.post`,
      // `channel.dm`, `message`) which intentionally leave
      // `finalText` empty — the tool already wrote the visible
      // reply. Without this gate, every tool-based mention reply
      // gets misclassified as `must_reply_failed` and the canned
      // fallback overwrites the real answer. `channel.pass` is a
      // terminator that publishes nothing, so it stays a failure
      // (and the palette layer above strips it anyway when the
      // wake reason is `mention`).
      const replyText = outcome.finalText.trim();
      // A run "satisfied" mandatory-reply when it ended via any
      // *publishing* terminator. `channel.pass` is explicit silence
      // (rejected by policy for mention wakes anyway), and
      // `channel.ack` is silent-acknowledge (no message published);
      // neither counts as a real reply, so both must trigger the
      // `must_reply_failed` event when they appear on a mention
      // wake. Without excluding `channel.ack` here a supervisor
      // could loophole every mention with an ack and the human
      // would never see the failure surface.
      const publishedViaTool =
        outcome.terminatingTool !== null &&
        outcome.terminatingTool !== 'channel.pass' &&
        outcome.terminatingTool !== 'channel.ack';
      if (!replyText && !publishedViaTool && input.wakeReason === 'mention') {
        this.realtime.emit(
          SocketEventNames.memberMustReplyFailed,
          {
            organizationId: input.organizationId,
            runId: outcome.spirit.runId ?? input.messageId,
            memberId: input.memberId,
            byMemberId: input.byMemberId,
            channelId: input.channelId,
            threadId: input.threadId,
            messageId: input.messageId,
            occurredAt: new Date().toISOString(),
          },
          [orgRoom(input.organizationId), memberRoom(input.memberId)],
        );
        const failureMessage = this.publishSupervisorFallback(
          taskSessionId,
          input,
          'mandatory-reply violated: supervisor produced no answer to a @mention',
        );
        return {
          taskSessionId,
          message: failureMessage,
          fallback: true,
          reason: 'must_reply_failed',
        };
      }
      // If the supervisor already published its reply via a
      // terminating tool, the tool wrote the message — emit no
      // additional fallback/status text on top.
      if (publishedViaTool) {
        return {
          taskSessionId,
          message: null,
          fallback: false,
          reason: 'ok',
        };
      }
      const finalText = replyText || `Currently on step ${session.status} of #${session.slug}.`;
      const message = this.publishSupervisorReply(taskSessionId, input, finalText, false);
      return { taskSessionId, message, fallback: false, reason: 'ok' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = this.publishSupervisorFallback(taskSessionId, input, reason);
      return { taskSessionId, message, fallback: true, reason };
    }
  }

  private buildSupervisorAlertContext(
    taskSessionId: string,
    input: SpiritAlertInput,
  ): string {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const body = sourceMessage?.content ?? '';
    const fromMember = this.repo.getMember(input.organizationId, input.byMemberId);
    let commandSurface = '';
    if (session) {
      const requester = this.repo.getMember(input.organizationId, session.requestedBy);
      const parts = [`requested by ${requester?.name ?? session.requestedBy}`];
      if (session.origin.channelId) {
        const channel = this.repo.getChannel(input.organizationId, session.origin.channelId);
        parts.push(`channel ${channel?.name ?? session.origin.channelId}`);
      }
      if (session.origin.threadId) parts.push(`thread ${session.origin.threadId}`);
      if (session.origin.messageId) parts.push(`origin message ${session.origin.messageId}`);
      commandSurface = parts.join('; ');
    }

    return [
      'You are answering a quick supervisor question or carrying out a direct action request.',
      ...MESSAGE_TOOL_USAGE_GUIDANCE,
      'If the request is only asking for status, give a short one-paragraph update.',
      `Reason: ${input.reason}`,
      `From: ${fromMember?.name ?? input.byMemberId}`,
      commandSurface ? `Human command surface: ${commandSurface}` : '',
      sourceMessage ? `Alert thread: ${sourceMessage.channelId ?? input.threadId}` : '',
      body ? `Message: ${body}` : '',
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

  private supervisorDebounceKey(
    organizationId: string,
    memberId: string,
    taskSessionId: string,
    messageId?: string,
  ): string {
    const base = `${organizationId}:${memberId}:${taskSessionId}`;
    return messageId ? `${base}:msg:${messageId}` : base;
  }

  private shouldDebounceSupervisorAlert(
    organizationId: string,
    memberId: string,
    taskSessionId: string,
    messageId?: string,
  ): boolean {
    const last = this.supervisorLastAlertAt.get(
      this.supervisorDebounceKey(organizationId, memberId, taskSessionId, messageId),
    );
    if (last === undefined) return false;
    return Date.now() - last < this.supervisorDebounceMs;
  }

  async resumeAfterApproval(
    organizationId: string,
    runId: string,
    allowRun = true,
    approvalScope?: string,
  ): Promise<RunSpiritOutcome | Spirit | RunState | null> {
    const spirit = this.findActiveSpiritByRunId(organizationId, runId);
    if (spirit) {
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

    const run = this.repo.getRun(organizationId, runId);
    if (!run) return null;
    if (allowRun) {
      this.tools.allowRun(organizationId, runId, approvalScope);
    } else {
      return this.failRun(run, 'Approval rejected by user');
    }

    if (run.status === 'running') {
      const key = this.runKey(organizationId, runId);
      if (this.runAbortControllers.has(key)) {
        this.deferredApprovalResumes.add(key);
        return run;
      }
      const afterApprovedTools = await this.executePendingApprovedRunTools(run);
      return this.advanceRun(afterApprovedTools);
    }

    if (run.status !== 'waiting_for_approval') {
      return run;
    }

    const afterApprovedTools = await this.executePendingApprovedRunTools(run);
    return this.advanceRun({
      ...afterApprovedTools,
      status: 'running',
      step: 'running',
      summary: 'Run resumed after approval',
    });
  }

  async createRun(input: CreateRunInput): Promise<RunState> {
    if (!this.ai) {
      throw new Error('Run execution is not wired into SpiritService');
    }

    const member = this.repo.getMember(input.organizationId, input.agentId);
    if (!member) {
      throw new Error(`Member not found: ${input.agentId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error(`Member "${input.agentId}" is not an agent`);
    }
    if (member.retiredAt) {
      throw new Error(`Member "${input.agentId}" is retired`);
    }

    const run = RunStateSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      threadId: input.threadId,
      status: 'queued',
      step: 'queued',
      summary: input.summary ?? 'Run queued',
      startedAt: new Date().toISOString(),
      wakeReason: input.wakeReason ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      byMemberId: input.byMemberId ?? null,
      terminatingTool: null,
    });

    this.repo.saveRun(run);
    this.realtime.emit(
      SocketEventNames.runStarted,
      { organizationId: input.organizationId, run },
      [
        orgRoom(input.organizationId),
        threadRoom(input.threadId),
        memberRoom(input.agentId),
        runRoom(run.id),
      ],
    );

    try {
      return await this.advanceRun(run);
    } catch (error) {
      const latest = this.repo.getRun(run.organizationId, run.id);
      if (latest?.status === 'cancelled') {
        return latest;
      }
      if (findToolApprovalRequiredError(error)) {
        return this.waitForApproval(run, pendingApprovalRunSummary(this.repo, run.organizationId, run.id));
      }
      return this.failRun(run, (error as Error).message);
    }
  }

  listRuns(organizationId: string, cursor?: string, limit?: number) {
    return this.repo.listRuns(organizationId, cursor, limit);
  }

  listThreadTraces(organizationId: string, threadId: string, cursor?: string, limit?: number) {
    const page = this.repo.listThreadRuns(organizationId, threadId, cursor, limit);
    return {
      ...page,
      data: page.data.flatMap((run) => {
        const detail = this.getRunTraceDetail(organizationId, run.id);
        return detail ? [detail] : [];
      }),
    };
  }

  getRun(organizationId: string, runId: string) {
    return this.repo.getRun(organizationId, runId);
  }

  getRunTraceDetail(organizationId: string, runId: string) {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      return null;
    }

    const approvals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId === runId);
    const messages = run.threadId ? this.listAllThreadMessages(organizationId, run.threadId) : [];
    const steps = this.repo.listRunSteps?.(organizationId, runId) ?? [];
    const message = [...messages]
      .reverse()
      .find(
        (item) =>
          item.metadata?.runId === run.id &&
          item.senderId === run.agentId &&
          item.senderKind === AGENT_KIND &&
          item.kind === AGENT_KIND,
      );

    return {
      run,
      approvals,
      messages,
      steps,
      ...(message ? { message } : {}),
    };
  }

  cancelRun(organizationId: string, runId: string): RunState {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return run;
    }

    const key = this.runKey(organizationId, runId);
    this.deferredApprovalResumes.delete(key);

    const cancelled = this.repo.saveRun({
      ...run,
      status: 'cancelled',
      step: 'cancelled',
      summary: 'Stopped by user',
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: cancelled },
      this.getRooms(run),
    );

    this.runAbortControllers.get(key)?.abort();
    this.runAbortControllers.delete(key);

    return cancelled;
  }

  getRunDetail(organizationId: string, runId: string): RunDetail | null {
    const trace = this.getRunTraceDetail(organizationId, runId);
    if (!trace) return null;
    const { run, approvals, messages, steps, message } = trace;

    const spirit = this.repo.getSpiritByRunId(organizationId, runId);
    if (!spirit) {
      return {
        run,
        approvals,
        messages,
        steps,
        ...(message ? { message } : {}),
        activeAgents: isLiveRunStatus(run.status)
          ? [{ memberId: run.agentId, statusLabel: run.status }]
          : [],
        tokens: { perMemberId: { [run.agentId]: 0 } },
        tools: aggregateToolUsage(messages),
      } satisfies RunDetail;
    }

    const session = this.repo.getTaskSession(organizationId, spirit.taskSessionId);
    const sessionSpirits = this.repo.listSpiritsForSession(organizationId, spirit.taskSessionId);
    const runIds = new Set(sessionSpirits.map((current) => current.runId).filter(Boolean));
    const sessionApprovals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId && runIds.has(approval.runId));
    const sessionMessages = session
      ? this.listAllChannelMessages(organizationId, session.channelId)
      : messages;

    const activeAgents = sessionSpirits
      .filter((current) => isLiveRunStatus(current.status))
      .map((current) => ({
        memberId: current.memberId,
        statusLabel: current.role === 'supervisor' ? `supervisor:${current.status}` : current.status,
      }));

    const perMemberId: Record<string, number> = {};
    for (const current of sessionSpirits) {
      perMemberId[current.memberId] = (perMemberId[current.memberId] ?? 0) + current.tokensUsed;
    }

    return {
      run,
      approvals: sessionApprovals,
      messages: sessionMessages,
      steps,
      ...(message ? { message } : {}),
      activeAgents,
      tokens: { perMemberId },
      tools: aggregateToolUsage(sessionMessages),
    } satisfies RunDetail;
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

  private async advanceRun(run: RunState): Promise<RunState> {
    const currentRun = this.repo.getRun(run.organizationId, run.id);
    if (currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status)) {
      return currentRun;
    }

    applyDashboardTeamOverrides(this.repo, run.organizationId, this.teamStore);
    const team = requireTeam(this.teamStore, run.organizationId);
    const member = this.repo.getMember(run.organizationId, run.agentId);
    if (!member) {
      throw new Error(`Member not found: ${run.agentId}`);
    }
    if (member.retiredAt) {
      return this.failRun(run, `Agent retired: ${run.agentId}`);
    }

    const role = team.getRole(member.roleName);
    if (!role) {
      throw new Error(`Role not found: ${member.roleName}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      return this.failRun(run, `Agent not found: ${member.id}`);
    }

    // No strict pre-flight on the *preferred* provider's key — that
    // short-circuits the runtime fallback in `resolveSpiritModel`,
    // which walks every team-configured provider with a key and
    // picks the first usable one. The fallback is the whole point of
    // letting an org swap providers without per-role migration; the
    // old gate here turned a recoverable "no key for the preferred
    // provider" state into a hard run failure even when other
    // providers were ready to serve. If *no* provider has a key,
    // `resolveSpiritModel` throws a clear "No usable provider for
    // member ..." error and the outer catch below converts that to
    // `failRun` with the same friendly summary.

    const preCancel = this.repo.getRun(run.organizationId, run.id);
    if (preCancel?.status === 'cancelled') {
      return preCancel;
    }

    const running = this.repo.saveRun({
      ...run,
      status: 'running',
      step: 'running',
      summary: 'Run executing',
    });

    const postCancel = this.repo.getRun(run.organizationId, run.id);
    if (postCancel?.status === 'cancelled') {
      return postCancel;
    }

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: running },
      this.getRooms(running),
    );

    const abortKey = this.runKey(run.organizationId, run.id);
    const abortController = new AbortController();
    this.runAbortControllers.set(abortKey, abortController);

    try {
      const goalModeActive = this.isGoalModeActive(run.organizationId, run.threadId ?? '');
      const latestHumanMessage = this.repo.getLatestHumanMessageInThread(run.organizationId, run.threadId ?? '');
      const systemPromptSuffix = [
        goalModeSystemPromptSuffix({
          goalMode: goalModeActive,
          messageContent: latestHumanMessage?.content,
        }),
        scheduleToolSystemPromptSuffix({
          messageContent: latestHumanMessage?.content,
        }),
      ]
        .filter(Boolean)
        .join('\n\n') || undefined;
      let streamedText = '';
      let streamedReasoning = '';
      const ai = this.ai;
      if (!ai) {
        throw new Error('Run execution is not wired into SpiritService');
      }
      const result = await ai.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId ?? '',
        runId: run.id,
        summary: run.summary,
        systemPromptSuffix,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          if (chunk.kind === 'text') streamedText += chunk.delta;
          if (chunk.kind === 'reasoning') streamedReasoning += chunk.delta;
          this.emitRunChunk(
            {
              organizationId: running.organizationId,
              runId: running.id,
              threadId: running.threadId,
              agentId: running.agentId,
            },
            chunk,
          );
        },
      });

      const latestRun = this.repo.getRun(run.organizationId, run.id);
      if (latestRun && latestRun.status !== 'running') {
        return latestRun;
      }

      if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
        const afterApprovedTools = await this.executePendingApprovedRunTools(running);
        return this.advanceRun(afterApprovedTools);
      }

      const statuses = [
        ...result.toolResults,
        ...result.steps.flatMap((step: (typeof result.steps)[number]) => step?.toolResults ?? []),
      ]
        .map((toolResult) => (toolResult?.output as { status?: string } | undefined)?.status)
        .filter((status): status is string => typeof status === 'string');
      if (statuses.includes('blocked')) {
        return this.failRun(running, 'Tool action blocked');
      }

      if (statuses.includes('waiting_for_approval')) {
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }

      const pendingApprovalExists = this.repo
        .listPendingApprovals(run.organizationId)
        .some((approval) => approval.runId === run.id);
      if (pendingApprovalExists) {
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }

      const text = (result.text || streamedText).trim();
      const reasoningContent = extractReasoningChunk(result) ?? (streamedReasoning.trim() || undefined);
      const runSteps = this.repo.listRunSteps?.(run.organizationId, run.id) ?? [];
      const detectedTerminatingTool =
        findTerminatingTool(result) ?? findTerminatingToolFromRunSteps(runSteps);
      // Preserve any silent terminator that a mid-run side-effect
      // already persisted onto the run row (mirror-loop guard fires
      // `tryMirrorSuppress` which writes `terminatingTool='channel.ack'`).
      // Without this preservation step, the freshly-computed
      // `detected` value (which sees the model's original
      // `channel.reply` toolcall via `result.steps`) would clobber
      // the silent terminator on the way through `completeRun`,
      // and metrics would report a publish that never happened.
      const persistedRunRow = this.repo.getRun(run.organizationId, run.id);
      const persistedTerminator = persistedRunRow?.terminatingTool;
      const persistedIsSilent =
        persistedTerminator === 'channel.ack' || persistedTerminator === 'channel.pass';
      const terminatingTool: string | null = persistedIsSilent
        ? persistedTerminator
        : detectedTerminatingTool;
      const usedPass = runUsedChannelPass(result) || terminatingTool === 'channel.pass';
      const finalThreadId = run.threadId;
      const channelId = finalThreadId
        ? this.repo.getThread(run.organizationId, finalThreadId)?.channelId
        : undefined;
      const wakeReason = (running.wakeReason ?? null) as WakeReason | null;
      const now = new Date().toISOString();
      const goalToolCalls = result.steps.flatMap((step: (typeof result.steps)[number]) => step?.toolCalls ?? []);
      const goalArtifactToolCall =
        (await appendGoalArtifactToolCall(goalToolCalls, team.workspace.root)) ??
        (await appendGoalArtifactToolCall(
          runSteps.map((step) => ({
            toolName: step.toolId,
            input: {
              action: step.action,
              resourcePath: step.resourcePath,
              ...step.input,
            },
          })),
          team.workspace.root,
        ));

      if (usedPass && text.length > 0) {
        this.realtime.emit(
          SocketEventNames.agentPassedWithText,
          {
            organizationId: run.organizationId,
            channelId,
            threadId: run.threadId,
            memberId: run.agentId,
            runId: run.id,
            droppedText: text,
            occurredAt: now,
          },
          this.getRooms(running),
        );
      }

      if (terminatingTool === 'channel.pass') {
        this.realtime.emit(
          SocketEventNames.runSilentCompletion,
          {
            organizationId: run.organizationId,
            runId: run.id,
            memberId: run.agentId,
            wakeReason: wakeReason ?? undefined,
            occurredAt: now,
          },
          this.getRooms(running),
        );
        return this.completeRun(running, 'passed', 'channel.pass');
      }

      if (!terminatingTool && text.length === 0 && !goalArtifactToolCall) {
        if (wakeReason === 'mention') {
          const byMemberId = running.byMemberId ?? run.agentId;
          const messageId = running.sourceMessageId;
          if (messageId) {
            this.realtime.emit(
              SocketEventNames.memberMustReplyFailed,
              {
                organizationId: run.organizationId,
                runId: run.id,
                memberId: run.agentId,
                byMemberId,
                channelId,
                threadId: run.threadId,
                messageId,
                occurredAt: now,
              },
              this.getRooms(running),
            );
          }
          return this.failRun(running, 'must_reply_failed: agent was @mentioned but did not reply');
        }
        this.realtime.emit(
          SocketEventNames.runEmptyCompletion,
          {
            organizationId: run.organizationId,
            runId: run.id,
            memberId: run.agentId,
            wakeReason: wakeReason ?? undefined,
            occurredAt: now,
          },
          this.getRooms(running),
        );
        return this.completeRun(running, 'empty', null);
      }

      const reply = text || 'Goal artifact updated.';
      const skipFinalThreadMessage = terminatingTool !== null || runUsedThreadPublishingTool(result);
      let publishedMessages = 0;
      let publishedGoalArtifact = false;
      let lastPublishedContent: string | undefined;
      for (const [index, step] of result.steps.entries()) {
        const stepText = typeof step.text === 'string' ? step.text.trim() : '';
        const stepToolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        if (!stepText && stepToolCalls.length === 0) {
          continue;
        }

        // Skip per-step text publication when this step used a thread-publishing
        // tool (message, channel.reply, channel.post, etc.) — the tool already
        // wrote to the thread, so re-publishing stepText would double-post.
        const stepUsedPublishingTool = runUsedThreadPublishingTool({ steps: [step] });

        const stepGoalArtifactToolCall =
          (await appendGoalArtifactToolCall(stepToolCalls, team.workspace.root)) ??
          (await appendGoalArtifactToolCall(
            (this.repo.listRunSteps?.(run.organizationId, run.id) ?? [])
              .filter((step) => step.toolCallId === stepToolCalls.at(-1)?.toolCallId)
              .map((step) => ({
                toolName: step.toolId,
                input: {
                  action: step.action,
                  resourcePath: step.resourcePath,
                  ...step.input,
                },
              })),
            team.workspace.root,
          ));
        if (stepGoalArtifactToolCall) {
          publishedGoalArtifact = true;
        }
        const toolCalls = [...stepToolCalls, ...(stepGoalArtifactToolCall ? [stepGoalArtifactToolCall] : [])];
        const stepReasoning = extractReasoningChunk(step) ?? (index === result.steps.length - 1 ? reasoningContent : undefined);
        const threadId = run.threadId;
        if (!threadId) {
          continue;
        }
        const channelId = this.repo.getThread(run.organizationId, threadId)?.channelId;
        if (stepUsedPublishingTool && !stepGoalArtifactToolCall) {
          continue;
        }
        if (!stepText && !stepGoalArtifactToolCall) {
          continue;
        }
        const content = stepText || 'Goal artifact updated.';
        this.conversations?.publishMessage(
          MessageSchema.parse({
            id: randomUUID(),
            organizationId: run.organizationId,
            threadId,
            ...(channelId ? { channelId } : {}),
            senderId: run.agentId,
            senderKind: AGENT_KIND,
            kind: AGENT_KIND,
            content,
            metadata: { runId: run.id },
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
            ...(stepReasoning ? { reasoningContent: stepReasoning } : {}),
            createdAt: new Date().toISOString(),
          }),
        );
        publishedMessages += 1;
        lastPublishedContent = content;
      }

      const finalArtifactMessageNeeded = !!goalArtifactToolCall && !publishedGoalArtifact;
      const shouldPublishFinalMessage =
        !!finalThreadId &&
        !skipFinalThreadMessage &&
        (publishedMessages === 0 || reply !== lastPublishedContent || finalArtifactMessageNeeded);
      if (finalThreadId && shouldPublishFinalMessage) {
        const channelId = this.repo.getThread(run.organizationId, finalThreadId)?.channelId;
        this.conversations?.publishMessage(
          MessageSchema.parse({
            id: randomUUID(),
            organizationId: run.organizationId,
            threadId: finalThreadId,
            ...(channelId ? { channelId } : {}),
            senderId: run.agentId,
            senderKind: AGENT_KIND,
            kind: AGENT_KIND,
            content: reply,
            metadata: { runId: run.id },
            ...(reasoningContent ? { reasoningContent } : {}),
            createdAt: new Date().toISOString(),
          }),
        );
      }

      if (finalThreadId && finalArtifactMessageNeeded) {
        const goalArtifactMessage = buildGoalArtifactMessage({
          goalArtifactToolCall,
          organizationId: run.organizationId,
          threadId: finalThreadId,
          channelId: this.repo.getThread(run.organizationId, finalThreadId)?.channelId,
          senderId: run.agentId,
          senderKind: AGENT_KIND,
          kind: AGENT_KIND,
          runId: run.id,
          content: reply,
        });
        if (goalArtifactMessage) {
          this.conversations?.publishMessage(goalArtifactMessage);
        }
      }

      return this.completeRun(running, terminatingTool ?? reply, terminatingTool);
    } catch (error) {
      if (findToolApprovalRequiredError(error)) {
        if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
          const afterApprovedTools = await this.executePendingApprovedRunTools(running);
          return this.advanceRun(afterApprovedTools);
        }
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }
      const latestAfterError = this.repo.getRun(run.organizationId, run.id);
      if (latestAfterError?.status === 'cancelled') {
        return latestAfterError;
      }
      return this.failRun(running, (error as Error).message);
    } finally {
      this.runAbortControllers.delete(abortKey);
    }
  }

  /**
   * Plug in (or replace) the post-completion hook. Used by
   * `services/index.ts` to late-bind `CommitmentService.onRunCompleted`
   * after both services exist — same chicken-and-egg pattern as the
   * MCP tool resolver. Pass `undefined` to clear.
   */
  setRunCompletedHook(hook: ((run: RunState) => Promise<void> | void) | undefined): void {
    this.runCompletedHook = hook;
  }

  private completeRun(run: RunState, summary: string, terminatingTool: string | null = null): RunState {
    const completed = this.repo.saveRun({
      ...run,
      status: 'completed',
      step: 'completed',
      summary,
      terminatingTool,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: completed },
      this.getRooms(run),
    );

    if (this.runCompletedHook) {
      try {
        const result = this.runCompletedHook(completed);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch(() => {
            // best-effort
          });
        }
      } catch {
        // best-effort
      }
    }

    return completed;
  }

  private waitForApproval(run: RunState, summary: string): RunState {
    const waiting = this.repo.saveRun({
      ...run,
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary,
    });

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: waiting },
      this.getRooms(run),
    );

    return waiting;
  }

  private failRun(run: RunState, summary: string): RunState {
    const failed = this.repo.saveRun({
      ...run,
      status: 'failed',
      step: 'failed',
      summary,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: failed },
      this.getRooms(run),
    );

    return failed;
  }

  private getRooms(run: RunState) {
    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.id)];
    if (run.threadId) {
      rooms.push(threadRoom(run.threadId));
      const channelId = this.repo.getThread(run.organizationId, run.threadId)?.channelId;
      if (channelId) {
        rooms.push(channelRoom(channelId));
      }
    }
    return rooms;
  }

  private emitRunChunk(
    run: { organizationId: string; runId: string; threadId?: string; agentId: string },
    chunk: AgentLoopChunk,
  ): void {
    if (!run.threadId || !chunk.delta) {
      return;
    }

    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.runId), threadRoom(run.threadId)];
    const channelId = this.repo.getThread(run.organizationId, run.threadId)?.channelId;
    if (channelId) {
      rooms.push(channelRoom(channelId));
    }

    this.realtime.emit(
      SocketEventNames.runChunk,
      {
        organizationId: run.organizationId,
        runId: run.runId,
        threadId: run.threadId,
        agentId: run.agentId,
        kind: chunk.kind,
        delta: chunk.delta,
      },
      rooms,
    );
  }

  private listAllThreadMessages(organizationId: string, threadId: string): Message[] {
    const messages: Message[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = this.repo.listMessages(organizationId, threadId, cursor, 100);
      messages.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return messages;
  }

  private listAllChannelMessages(organizationId: string, channelId: string): Message[] {
    const messages: Message[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = this.repo.listChannelMessages(organizationId, channelId, { cursor, limit: 100 });
      messages.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return messages;
  }

  private async executePendingApprovedRunTools(run: RunState): Promise<RunState> {
    const pendingApprovalToolCallIds = new Set(
      this.repo
        .listPendingApprovals(run.organizationId)
        .filter((approval) => approval.runId === run.id && approval.toolCallId)
        .map((approval) => approval.toolCallId as string),
    );
    const pendingSteps = this.repo
      .listRunSteps?.(run.organizationId, run.id) ?? [];
    for (const step of pendingSteps.filter((item) => {
      const output = item.output as { status?: unknown } | undefined;
      return output?.status === 'waiting_for_approval' && !pendingApprovalToolCallIds.has(item.toolCallId);
    })) {
      const invocation: ToolInvocationInput = {
        organizationId: step.organizationId,
        runId: step.runId,
        memberId: step.agentId,
        threadId: step.threadId,
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
        // Tool failures are already persisted by ToolService; keep going.
      }
    }
    return run;
  }

  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }

  private consumeDeferredApprovalResume(organizationId: string, runId: string): boolean {
    const key = this.runKey(organizationId, runId);
    if (!this.deferredApprovalResumes.has(key)) {
      return false;
    }
    this.deferredApprovalResumes.delete(key);
    return true;
  }

  private isGoalModeActive(organizationId: string, threadId: string): boolean {
    if (!threadId) return false;
    return goalModeEnabledFromMessage(
      this.repo.getLatestHumanMessageInThread(organizationId, threadId),
    );
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
      return ch.kind === 'general' || ch.kind === 'group';
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

    if (
      isDirectMessageThread(threadId) ||
      (channelId !== undefined && isDirectMessageThread(channelId))
    ) {
      return null;
    }

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
      repo?: ApiRepository;
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
    if (workers.some((spirit) => isLiveSpiritStatus(spirit.status))) {
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

    for (const spirit of workers.slice().reverse()) {
      const latestMessage = spirit.lastMessageId
        ? this.repo.getMessage(organizationId, spirit.lastMessageId)
        : null;
      const content = latestMessage?.content.trim();
      if (content) {
        return content;
      }
    }

    const failed = workers.find((spirit) => spirit.status === 'failed');
    if (failed?.lastError) {
      return failed.lastError;
    }

    const membersById = new Map(
      this.repo.listMembers(organizationId).map((member) => [member.id, member]),
    );
    const completedNames = workers
      .filter((spirit) => spirit.status === 'completed')
      .map((spirit) => membersById.get(spirit.memberId)?.name ?? spirit.memberId);
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
      const team = requireTeam(this.teamStore, organizationId);
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
   *
   * Public so callers that don't own a `SpiritService` instance can
   * still resolve the same palette — specifically `AiService`, which
   * handles the wake-run path (advanceRun) and would otherwise build
   * a tool palette without MCP tools, leaving the model with no
   * playwright/etc. tools and a system prompt that says "Available
   * tools: none".
   */
  async buildMcpToolDefinitions(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{ toolSet: ToolSet; servers: McpServerSummary[] }> {
    if (!this.mcpPool || !this.mcpResolver) return { toolSet: {} as ToolSet, servers: [] };
    let resolutions: SpiritMcpResolution[];
    try {
      resolutions = await this.mcpResolver({
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        role: ctx.role,
      });
    } catch {
      return { toolSet: {} as ToolSet, servers: [] };
    }
    if (resolutions.length === 0) return { toolSet: {} as ToolSet, servers: [] };

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
    const servers: McpServerSummary[] = [];
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
      if (toolList.length > 0) {
        servers.push({
          serverName: resolution.serverName,
          serverId: resolution.serverId,
          toolNames: toolList.map((t) => t.name),
        });
      }
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
    const toolSet = Object.fromEntries(
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
              return toModelToolErrorOutput(error);
            }
          },
        }),
      ]),
    ) as ToolSet;
    return { toolSet, servers };
  }
}

/**
 * Per-MCP-server tool summary, threaded through to the system prompt
 * so the model sees a clear "Attached MCP servers" block with friendly
 * names and original tool names — instead of having to infer that
 * `mcp__playwright_<hash>__browser_close` belongs to Playwright.
 */
export interface McpServerSummary {
  serverName: string;
  serverId: string;
  toolNames: string[];
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

function aggregateToolUsage(
  messages: readonly { toolCalls?: readonly { toolName?: string; result?: unknown }[] }[],
): Record<string, RunDetailAggregate> {
  const tools: Record<string, RunDetailAggregate> = {};
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const toolName = toolCall.toolName ?? 'unknown';
      const current = tools[toolName] ?? { count: 0, pending: 0 };
      current.count += 1;
      const output = toolCall.result as { status?: string } | undefined;
      if (output?.status && output.status !== 'completed') {
        current.pending += 1;
      }
      tools[toolName] = current;
    }
  }
  return tools;
}
