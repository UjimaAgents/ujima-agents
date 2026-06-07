import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SPIRIT_TEMPERATURE,
  RunStateSchema,
  SocketEventNames,
  SpiritSchema,
  channelRoom,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type MCPDef,
  type Message,
  type RunState,
  type Spirit,
  AGENT_KIND,
  isDirectMessageThread,
} from '@ujima/shared';
import { composeSystemPromptSuffix, runWakeReason } from './spirit-run-detail.js';
import type { ActiveSpiritEntry } from './active-spirit-registry.js';
import type { ToolInvocationInput } from './tool-service.js';
import { createSpiritModelResolver } from '../utils/create-spirit-model-resolver.js';
import { ActiveSpiritRegistry } from './active-spirit-registry.js';
import { AsyncMutex } from '../utils/async-mutex.js';
import { filterVisibleMessages } from '../utils/message-visibility.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
import { goalModeEnabledFromMessage } from './goal-mode-prompt.js';
import { isLiveSpiritStatus } from './live-status.js';
import type { AiService } from '../ai-service.js';
import type { AgentLoopChunk } from './agent-loop.js';
import { accumulateStepUsage, hasTokenUsage } from './token-usage.js';
import { materializeMcpDef } from './mcp-runtime.js';
import { requireOrganization } from '../utils/require-organization.js';
import type { SpawnSpiritInput } from './spirit-types.js';
import { maybeFinalizeTaskSession as finalizeTaskSession } from './task-session-finalizer.js';
import type {
  SpiritMcpPool,
  SpiritMcpResolver,
  ModelResolver,
  SpiritServiceOptions,
} from './spirit-types.js';

export const DEFAULT_SUPERVISOR_DEBOUNCE_MS = 2_000;
export const DEFAULT_SUPERVISOR_TURN_CAP_PER_SESSION = 10;

export class SpiritServiceBase {
  protected readonly maxIterationsPerRun: number;
  protected readonly maxOutputTokens: number | undefined;
  protected readonly temperature: number;
  protected readonly modelResolver: ModelResolver;
  protected readonly registry: ActiveSpiritRegistry;
  protected readonly conversations?: ConversationService;
  protected readonly ai?: AiService;
  protected readonly mcpPool?: SpiritMcpPool;
  protected readonly mcpResolver?: SpiritMcpResolver;
  protected readonly supervisorDebounceMs: number;
  protected readonly supervisorTurnCapPerSession: number;
  protected readonly supervisorMutex = new AsyncMutex();
  protected readonly supervisorLastAlertAt = new Map<string, number>();
  protected readonly deferredApprovalResumes = new Set<string>();
  protected readonly runAbortControllers = new Map<string, AbortController>();
  protected runCompletedHook?: (run: RunState) => Promise<void> | void;

  constructor(
    protected readonly teamStore: TeamStore,
    protected readonly repo: ApiRepository,
    protected readonly realtime: RealtimeService,
    protected readonly tools: ToolService,
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

  /** Hydrate registry from DB; register oldest→newest so `registeredAt` matches runtime order. */
  bootstrap(organizationId: string): void {
    const members = this.repo.listMembers(organizationId);
    for (const member of members) {
      if (member.kind !== AGENT_KIND) continue;
      const active = this.repo.listActiveSpiritsForMember(organizationId, member.id);
      for (const spirit of active.slice().reverse()) {
        this.registry.register(spirit);
      }
    }
  }

  bootstrapAll(): void {
    for (const org of this.repo.listOrganizations()) {
      this.bootstrap(org.id);
    }
  }

  getActiveRegistry(): ActiveSpiritRegistry {
    return this.registry;
  }

  spawn(input: SpawnSpiritInput): Spirit {
    return this.spawnTracked(input).spirit;
  }

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
      throw new Error(`Member "${input.memberId}" is not an agent`);
    }
    if (member.retiredAt) {
      throw new Error(`Member "${input.memberId}" is retired`);
    }

    const existing = this.repo.getSpiritByTriple(
      input.organizationId,
      input.taskSessionId,
      input.memberId,
      role,
    );
    if (existing) {
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

  protected maybeFinalizeTaskSession(
    organizationId: string,
    taskSessionId: string,
    preferredSummary?: string,
  ): void {
    finalizeTaskSession({
      repo: this.repo,
      realtime: this.realtime,
      conversations: this.conversations,
      organizationId,
      taskSessionId,
      preferredSummary,
    });
  }

  protected findActiveSpiritByRunId(organizationId: string, runId: string): Spirit | null {
    for (const member of this.repo.listMembers(organizationId)) {
      if (member.kind !== AGENT_KIND) continue;
      const spirit = this.repo
        .listActiveSpiritsForMember(organizationId, member.id)
        .find((item) => item.runId === runId);
      if (spirit) return spirit;
    }
    return null;
  }

  protected resolveSpiritForRun(organizationId: string, runId: string): Spirit | null {
    return (
      this.repo.getSpiritByRunId?.(organizationId, runId) ??
      this.findActiveSpiritByRunId(organizationId, runId)
    );
  }

  protected toolInvocationContextForSpirit(
    spirit: Spirit,
    run?: RunState | null,
  ): Pick<ToolInvocationInput, 'taskSessionId' | 'spiritRole' | 'wakeReason'> {
    return {
      taskSessionId: spirit.taskSessionId,
      spiritRole: spirit.role,
      wakeReason: run ? runWakeReason(run) : null,
    };
  }

  protected toolInvocationContextForRun(
    run: RunState,
  ): Pick<ToolInvocationInput, 'taskSessionId' | 'spiritRole' | 'wakeReason'> {
    const spirit = this.resolveSpiritForRun(run.organizationId, run.id);
    if (spirit) {
      return this.toolInvocationContextForSpirit(spirit, run);
    }
    return { wakeReason: runWakeReason(run) };
  }

  protected async replayApprovedToolsForRun(run: RunState): Promise<void> {
    await this.replayApprovedToolSteps(
      run.organizationId,
      run.id,
      this.toolInvocationContextForRun(run),
    );
  }

  protected async replayApprovedToolsForSpirit(spirit: Spirit): Promise<void> {
    const runId = spirit.runId ?? spirit.id;
    const run = this.repo.getRun(spirit.organizationId, runId);
    const context = run
      ? this.toolInvocationContextForRun(run)
      : this.toolInvocationContextForSpirit(spirit);
    await this.replayApprovedToolSteps(spirit.organizationId, runId, context);
  }

  protected listStepsAwaitingApprovedReplay(organizationId: string, runId: string) {
    const pendingApprovalToolCallIds = new Set(
      this.repo
        .listPendingApprovals(organizationId)
        .filter((approval) => approval.runId === runId && approval.toolCallId)
        .map((approval) => approval.toolCallId as string),
    );
    return (this.repo.listRunSteps?.(organizationId, runId) ?? []).filter((step) => {
      const output = step.output as { status?: unknown; questionId?: unknown } | undefined;
      if (output?.status === 'waiting_for_approval' && !pendingApprovalToolCallIds.has(step.toolCallId)) {
        return true;
      }
      if (output?.status === 'waiting_for_input' && typeof output.questionId === 'string') {
        const question = this.repo.getInteractiveQuestion(organizationId, output.questionId);
        if (question && question.status === 'answered') {
          return true;
        }
      }
      return false;
    });
  }

  protected async replayApprovedToolSteps(
    organizationId: string,
    runId: string,
    context: Pick<ToolInvocationInput, 'taskSessionId' | 'spiritRole' | 'wakeReason'>,
  ): Promise<void> {
    for (const step of this.listStepsAwaitingApprovedReplay(organizationId, runId)) {
      const invocation: ToolInvocationInput = {
        organizationId: step.organizationId,
        runId: step.runId,
        memberId: step.agentId,
        threadId: step.threadId,
        ...context,
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
        // ToolService persists failures; continue replay.
      }
    }
  }

  protected isBroadOrgChannelSurface(
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

  protected findActiveSpiritForThread(
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

  setRunCompletedHook(hook: ((run: RunState) => Promise<void> | void) | undefined): void {
    this.runCompletedHook = hook;
  }

  protected invokeRunTerminalHook(run: RunState): void {
    if (!this.runCompletedHook) return;
    try {
      const result = this.runCompletedHook(run);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch(() => {
          // best-effort
        });
      }
    } catch {
      // best-effort
    }
  }

  protected getRooms(run: RunState) {
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

  protected saveRunAndEmit(
    event: typeof SocketEventNames.runStarted | typeof SocketEventNames.runUpdated | typeof SocketEventNames.runCompleted,
    run: RunState,
  ): RunState {
    const saved = this.repo.saveRun(run);
    this.realtime.emit(
      event,
      { organizationId: saved.organizationId, run: saved },
      this.getRooms(saved),
    );
    return saved;
  }

  protected emitRunChunk(
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

  protected emitRunTokens(
    organizationId: string,
    runId: string,
    threadId: string | undefined,
    agentId: string,
    steps: readonly { usage?: unknown }[],
  ): void {
    const usage = accumulateStepUsage(steps);
    if (!hasTokenUsage(usage)) return;

    const rooms = [orgRoom(organizationId), memberRoom(agentId), runRoom(runId)];
    if (threadId) {
      rooms.push(threadRoom(threadId));
      const channelId = this.repo.getThread(organizationId, threadId)?.channelId;
      if (channelId) rooms.push(channelRoom(channelId));
    }

    this.realtime.emit(
      SocketEventNames.runTokens,
      {
        organizationId,
        runId,
        ...(threadId ? { threadId } : {}),
        agentId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      rooms,
    );
  }

  protected listAllThreadMessages(organizationId: string, threadId: string): Message[] {
    const messages: Message[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = this.repo.listMessages(organizationId, threadId, cursor, 100);
      messages.push(...filterVisibleMessages(page.data));
      cursor = page.nextCursor;
    } while (cursor);
    return messages;
  }

  protected listAllChannelMessages(organizationId: string, channelId: string): Message[] {
    const messages: Message[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = this.repo.listChannelMessages(organizationId, channelId, { cursor, limit: 100 });
      messages.push(...filterVisibleMessages(page.data));
      cursor = page.nextCursor;
    } while (cursor);
    return messages;
  }

  protected runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }

  protected consumeDeferredApprovalResume(organizationId: string, runId: string): boolean {
    const key = this.runKey(organizationId, runId);
    if (!this.deferredApprovalResumes.has(key)) {
      return false;
    }
    this.deferredApprovalResumes.delete(key);
    return true;
  }

  protected isGoalModeActive(organizationId: string, threadId: string): boolean {
    if (!threadId) return false;
    return goalModeEnabledFromMessage(
      this.repo.getLatestHumanMessageInThread(organizationId, threadId),
    );
  }

  protected resolveSystemPromptSuffix(input: {
    organizationId: string;
    taskSessionId?: string;
    threadId?: string;
    extraSuffix?: string;
    messageContent?: string | null;
    goalMode?: boolean;
  }): string | undefined {
    let messageContent = input.messageContent;
    let goalMode = input.goalMode;

    if (messageContent === undefined && goalMode === undefined && input.taskSessionId) {
      const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
      const originMessageId = session?.origin?.messageId;
      const originMessage = originMessageId
        ? this.repo.getMessage(input.organizationId, originMessageId)
        : null;
      messageContent = originMessage?.content;
      goalMode = goalModeEnabledFromMessage(originMessage);
    }

    if (messageContent === undefined && input.threadId) {
      messageContent = this.repo.getLatestHumanMessageInThread(
        input.organizationId,
        input.threadId,
      )?.content;
    }

    if (goalMode === undefined && input.threadId) {
      goalMode = this.isGoalModeActive(input.organizationId, input.threadId);
    }

    return composeSystemPromptSuffix({
      extraSuffix: input.extraSuffix,
      messageContent,
      goalMode,
    });
  }

  protected emit(event: string, spirit: Spirit): void {
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

  protected defaultModelResolver(): ModelResolver {
    return createSpiritModelResolver(this.teamStore, this.repo);
  }

  protected defaultMcpResolver(): SpiritMcpResolver {
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

  protected mcpServerToDef(server: {
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
}
