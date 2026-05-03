import { randomUUID } from 'node:crypto';
import {
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import {
  MessageSchema,
  RunStateSchema,
  SocketEventNames,
  SpiritSchema,
  channelRoom,
  memberRoom,
  orgRoom,
  runRoom,
  type Member,
  type Message,
  type MessageCard,
  type MessageToolCall,
  type Spirit,
} from '@ujima/shared';
import { buildAgentSystemPrompt, type AgentTeamHandle, type ProviderKind } from '@ujima/framework';
import { selectLanguageModel } from '@ujima/llm';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  ORCHESTRATOR_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from '../tools/index.js';
import { toModelToolName } from '../tools/names.js';
import type { OrchestratorTool } from '../tools/types.js';
import { ActiveSpiritRegistry, isAliveStatus } from './active-spirit-registry.js';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';

// ----------------------------------------------------------------------
// SpiritService — Phase 2.A.4
//
// A "spirit" is the per-{task_session_id, member_id, role} runtime
// instance that drives an agent through a task session. The service
// owns the lifecycle (spawn / get / list / updateStatus / retire) and
// the multi-turn AI SDK execution path that landed in Phase 2.5.
//
// Spirit-role split:
//   * worker     — the multi-turn loop owning the work
//   * supervisor — the lazy DM/@mention answerer (called by SupervisorService)
//
// Spawn registers the spirit in the in-memory ActiveSpiritRegistry so
// the supervisor gate has O(1) "is this member alive?" lookups.
// Retire / completion / failure all unregister.
//
// The execution path intentionally does NOT depend on the legacy MCP
// `runAiSdkLoop` (that wraps a single MCPConnection). Spirit turns go
// through the orchestrator ToolService so the existing IAM matrix,
// approval gate, and audit trail all apply.
// ----------------------------------------------------------------------

const SUPPORTED_PROVIDER_KINDS: ReadonlySet<ProviderKind> = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
]);

function resolveProviderKind(
  providerName: string,
  declared: ProviderKind | undefined,
): ProviderKind {
  if (declared) return declared;
  if (providerName === 'openai' || providerName === 'anthropic' || providerName === 'google') {
    return providerName;
  }
  throw new Error(
    `Provider "${providerName}" has no \`kind\` declared. Add \`kind\` to the provider config.`,
  );
}

export interface ModelResolverInput {
  organizationId: string;
  memberId: string;
  role: 'worker' | 'supervisor';
}

/**
 * Resolves an AI SDK LanguageModel for a worker or supervisor turn. The
 * default impl walks the team / repo provider credentials; tests inject
 * a custom resolver that returns a `MockLanguageModelV3`. The cheaper-
 * tier supervisor pick is encapsulated here so production is one
 * config field flip away from a custom routing strategy.
 */
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
   * Inject the in-memory active-spirit registry. Optional — when not
   * provided, the service spins up its own. Sharing one across
   * `SpiritService` + `SupervisorService` is the production pattern.
   */
  registry?: ActiveSpiritRegistry;
}

export interface SpawnSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  role?: 'worker' | 'supervisor';
}

export interface RunSpiritInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  /** Optional extra prompt — supervisor uses this to carry the alert context. */
  extraPrompt?: string;
  /** Override the iteration cap for a single call (e.g. 1 for supervisor). */
  maxIterations?: number;
  /** Restrict the tool palette to a specific allowlist (supervisor mode). */
  toolAllowlist?: readonly string[];
  /** Force role on the spirit row. Default 'worker'. */
  role?: 'worker' | 'supervisor';
}

export interface RunSpiritOutcome {
  spirit: Spirit;
  finalText: string;
  iterations: number;
  toolCalls: number;
  tokensUsed: number;
}

export class SpiritService {
  private readonly maxIterationsPerRun: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly temperature: number;
  private readonly modelResolver: ModelResolver;
  private readonly registry: ActiveSpiritRegistry;

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly tools: ToolService,
    options: SpiritServiceOptions = {},
  ) {
    this.maxIterationsPerRun = options.maxIterationsPerRun ?? 12;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature ?? 0.2;
    this.modelResolver = options.modelResolver ?? this.defaultModelResolver();
    this.registry = options.registry ?? new ActiveSpiritRegistry();
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
      if (member.kind !== 'agent') continue;
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
    this.requireOrganization(input.organizationId);
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== 'agent') {
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
    const team = this.requireTeam();
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
      .data
      .slice()
      .reverse();
    const messages = this.toModelMessages(recent, member);
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

    // All validation passed. Now commit the spirit.
    const spirit = this.spawn({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
    });

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
    const toolDefs = this.buildToolDefinitions(allowedToolIds, {
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

    const maxIterations = input.maxIterations ?? this.maxIterationsPerRun;
    let totalTurns = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastText = '';

    try {
      const result = streamText({
        model,
        system,
        messages,
        tools: toolDefs,
        stopWhen: stepCountIs(maxIterations),
        ...(this.maxOutputTokens !== undefined ? { maxOutputTokens: this.maxOutputTokens } : {}),
        temperature: this.temperature,
      });

      // Drain the full stream so tool execute() callbacks run and the
      // finish frame fires. textStream alone closes on text-end and
      // would skip the usage payload.
      for await (const part of result.fullStream) {
        // intentional discard — we only need the side effects
        void part;
      }
      const [steps, usage] = await Promise.all([result.steps, result.usage]);

      // Each step in `steps` is one model turn. We persist one
      // `kind='agent'` message per step that produced text or tool
      // calls, with tool-call cards inlined. This keeps the channel
      // history readable as a turn-by-turn timeline.
      let lastMessageId: string | undefined;
      for (const step of steps) {
        totalTurns += 1;
        const stepText = typeof step.text === 'string' ? step.text : '';
        const stepToolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        const stepToolResults = Array.isArray(step.toolResults) ? step.toolResults : [];
        totalToolCalls += stepToolCalls.length;

        if (!stepText && stepToolCalls.length === 0) {
          continue;
        }

        const toolCalls = this.toMessageToolCalls(stepToolCalls, stepToolResults, spirit);
        const message = MessageSchema.parse({
          id: randomUUID(),
          organizationId: input.organizationId,
          threadId: session.channelId,
          channelId: session.channelId,
          senderId: member.id,
          senderKind: 'agent',
          kind: 'agent',
          content: stepText || `[tool turn — ${stepToolCalls.length} call(s)]`,
          toolCalls,
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

      return {
        spirit: completed,
        finalText: lastText,
        iterations: totalTurns,
        toolCalls: totalToolCalls,
        tokensUsed: totalTokens,
      };
    } catch (err) {
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
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  private resolveToolAllowlist(
    roleTools: readonly string[],
    role: 'worker' | 'supervisor',
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
      spiritRole: 'worker' | 'supervisor';
      team: AgentTeamHandle;
    },
  ): ToolSet {
    const entries: [string, OrchestratorTool][] = [];
    for (const toolId of toolIds) {
      const def = ORCHESTRATOR_TOOLS[toolId] as OrchestratorTool | undefined;
      if (def) entries.push([toolId, def]);
    }
    // Inline `tool({...})` per iteration mirrors `AiService.buildToolDefinition`
    // and keeps the `Tool<args, ...>` generic resolved per-iteration. A
    // `Record<string, ReturnType<typeof tool>>` collapses the generic to
    // `Tool<never, never>` and breaks the assignment.
    return Object.fromEntries(
      entries.map(([toolId, definition]) => [
        toModelToolName(toolId),
        tool({
          description: ctx.team.tools[toolId]?.description ?? `${toolId} tool`,
          inputSchema: definition.schema,
          execute: async (rawArgs, { toolCallId }) => {
            const invocationData = definition.toInvocation(rawArgs);
            const result = await this.tools.invoke({
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
            if (!result.ok) {
              return { error: result.error ?? 'tool invocation failed' };
            }
            return result.output ?? { ok: true };
          },
        }),
      ]),
    ) as ToolSet;
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
      const card: MessageCard = {
        kind: 'tool.call',
        cardId: randomUUID(),
        taskSessionId: spirit.taskSessionId,
        runId: spirit.runId,
        toolCallId,
        toolName,
        args,
        result,
        isError: false,
      };
      return {
        toolCallId,
        toolName,
        args,
        result: card,
        isError: false,
      };
    });
  }

  private toModelMessages(messages: Message[], self: Member): ModelMessage[] {
    return messages.map((m) => ({
      role:
        m.kind === 'system'
          ? 'system'
          : m.senderId === self.id
            ? 'assistant'
            : 'user',
      content: m.content,
    }));
  }

  private requireTeam(): AgentTeamHandle {
    const team = this.teamStore.getTeam();
    if (!team) {
      throw new Error('Team config not loaded');
    }
    return team;
  }

  private requireOrganization(organizationId: string): void {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
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

  private defaultModelResolver(): ModelResolver {
    return ({ organizationId, memberId, role }) => {
      const team = this.requireTeam();
      const member = this.repo.getMember(organizationId, memberId);
      if (!member) {
        throw new Error(`Member not found: ${memberId}`);
      }
      const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
      if (!agent) {
        throw new Error(`Agent not found: ${memberId}`);
      }
      const teamRole = team.getRole(agent.roleName);
      if (!teamRole) {
        throw new Error(`Role not found: ${agent.roleName}`);
      }
      if (!teamRole.provider) {
        throw new Error(`Role "${teamRole.name}" is missing a provider`);
      }
      const provider = team.getProvider(teamRole.provider);
      if (!provider) {
        throw new Error(`Provider not found: ${teamRole.provider}`);
      }
      const modelId = pickProviderModel({ teamRole, provider, role });
      if (!modelId) {
        throw new Error(`Provider "${teamRole.provider}" has no model id`);
      }
      const apiKey = this.repo.getProviderCredential(organizationId, teamRole.provider);
      if (!apiKey) {
        throw new Error(`Provider key missing for "${teamRole.provider}"`);
      }
      const kind = resolveProviderKind(teamRole.provider, provider.kind);
      if (!SUPPORTED_PROVIDER_KINDS.has(kind)) {
        throw new Error(`Unsupported provider kind "${kind}"`);
      }
      return selectLanguageModel({
        kind,
        modelId,
        apiKey,
        baseUrl: provider.baseUrl,
      });
    };
  }
}

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
  role: 'worker' | 'supervisor';
}): string | undefined {
  const baseModel = input.teamRole.model ?? input.provider.defaultModel;
  if (input.role !== 'supervisor') return baseModel;
  const supervisorTier =
    (input.provider as { supervisorModel?: string; supervisor_model?: string })
      .supervisorModel ??
    (input.provider as { supervisorModel?: string; supervisor_model?: string })
      .supervisor_model;
  return supervisorTier ?? baseModel;
}
