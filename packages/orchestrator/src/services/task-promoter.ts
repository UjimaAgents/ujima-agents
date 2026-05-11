import { randomUUID } from 'node:crypto';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { selectLanguageModel, type ProviderKind } from '@ujima/llm';
import {
  AGENT_KIND,
  MessageSchema,
  type AuditEvent,
  type Channel,
  type Message,
  type MessageCard,
  type TaskExecutionMode,
} from '@ujima/shared';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { RunService } from './run.js';
import type { TaskSessionService } from './task-session.js';
import type { TeamStore } from './team-store.js';

export interface TaskPromotionInput {
  organizationId: string;
  channelId: string;
  threadId?: string;
  messageId?: string;
  requestedBy: string;
  prompt: string;
  assignedAgentId?: string;
  reason?: string;
}

export interface TaskPromotionResult {
  runId: string;
  organizationId: string;
  assignedAgentId: string;
  status: string;
  auditEventId: string;
}

const TaskPromotionDecisionSchema = z.object({
  decision: z.enum(['promote', 'confirm', 'skip']),
  confidence: z.number().min(0).max(1).default(0),
  team: z.array(z.string()).default([]),
  executionMode: z.enum(['concurrent', 'slim']).optional(),
  slugHint: z.string().min(1).optional(),
  rationale: z.string().default(''),
});

export type TaskPromotionDecision = z.infer<typeof TaskPromotionDecisionSchema>;

export interface PromoterMessageInput {
  organizationId: string;
  messageId: string;
}

export interface PromoterMessageOutcome {
  decision: TaskPromotionDecision['decision'];
  confidence: number;
  auditEventId: string;
  taskSessionId?: string;
  taskChannelId?: string;
}

export interface TaskPromotionEvaluatorInput {
  organizationId: string;
  channel: Channel;
  message: Message;
  recentChannelMessages: Message[];
  orgChart: Record<string, unknown>;
  roles: readonly { name: string; title: string; channels: readonly string[] }[];
  activeRuns: readonly { slug: string; status: string; team: readonly string[] }[];
}

export type TaskPromotionEvaluator = (
  input: TaskPromotionEvaluatorInput,
) => Promise<TaskPromotionDecision> | TaskPromotionDecision;

export interface TaskPromoterServiceOptions {
  teamStore?: TeamStore;
  taskSessions?: TaskSessionService;
  conversations?: ConversationService;
  evaluator?: TaskPromotionEvaluator;
  autoStart?: boolean;
  channelCooldownMs?: number;
  dedupeWindowMs?: number;
  confirmTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_CHANNEL_COOLDOWN_MS = 3_000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const EXPLICIT_TASK_RUN_RE = /^\/task\s+run(?:\s+\[([^\]]+)\])?\s+(.+)$/i;

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
  throw new Error(`Provider "${providerName}" has no \`kind\` declared.`);
}

export class TaskPromoterService {
  private readonly processedMessageIds = new Set<string>();
  private readonly channelAttemptAt = new Map<string, number>();
  private readonly channelDedupes = new Map<string, { prompt: string; at: number }[]>();
  private readonly teamStore?: TeamStore;
  private readonly taskSessions?: TaskSessionService;
  private readonly conversations?: ConversationService;
  private readonly evaluator?: TaskPromotionEvaluator;
  private readonly autoStart: boolean;
  private readonly channelCooldownMs: number;
  private readonly dedupeWindowMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly repo: ApiRepository,
    private readonly runs: RunService,
    options: TaskPromoterServiceOptions = {},
  ) {
    this.teamStore = options.teamStore;
    this.taskSessions = options.taskSessions;
    this.conversations = options.conversations;
    this.evaluator = options.evaluator;
    this.autoStart = options.autoStart ?? true;
    this.channelCooldownMs = options.channelCooldownMs ?? DEFAULT_CHANNEL_COOLDOWN_MS;
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  // Legacy explicit run-promotion path. Kept intact for the existing
  // `/tasks/promote` API while the task-shell promoter grows around it.
  async promote(input: TaskPromotionInput): Promise<TaskPromotionResult> {
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      const audit = this.writeLegacyAudit(input, null, 'blocked', 'organization not found');
      throw Object.assign(new Error(`Organization not found: ${input.organizationId}`), {
        auditEventId: audit.id,
      });
    }

    const assignee = this.resolveAssignee(input);
    if (!assignee) {
      const audit = this.writeLegacyAudit(input, null, 'blocked', 'no agent member available');
      throw Object.assign(new Error('No agent member available to own the task'), {
        auditEventId: audit.id,
      });
    }

    const threadId = input.threadId ?? input.channelId;
    const run = await this.runs.createRun({
      organizationId: input.organizationId,
      agentId: assignee,
      threadId,
      summary: input.prompt,
    });

    const audit = this.writeLegacyAudit(input, assignee, 'ok', 'promoted to run', run.id);

    return {
      runId: run.id,
      organizationId: input.organizationId,
      assignedAgentId: assignee,
      status: run.status,
      auditEventId: audit.id,
    };
  }

  async handlePostedMessage(input: PromoterMessageInput): Promise<PromoterMessageOutcome | null> {
    const message = this.repo.getMessage(input.organizationId, input.messageId);
    if (!message || !message.channelId) {
      return null;
    }
    if (this.processedMessageIds.has(message.id)) {
      return null;
    }
    this.processedMessageIds.add(message.id);

    const channel = this.repo.getChannel(input.organizationId, message.channelId);
    const sender = this.repo.getMember(input.organizationId, message.senderId);
    if (!channel || !sender || sender.kind !== 'human' || message.kind !== 'human') {
      return null;
    }

    const explicit = parseExplicitTaskCommand(message.content);
    const eligiblePublicChannel = channel.kind === 'general' || channel.kind === 'group';
    if (!explicit && !eligiblePublicChannel) {
      return null;
    }

    // Public-channel promotion is intentionally conservative: we only evaluate
    // once per message, cool down repeated checks in noisy channels, and
    // suppress near-duplicate requests so the promoter does not feel trigger-happy.
    if (!explicit) {
      if (this.shouldRateLimit(channel.id)) {
        const audit = this.writePromoterAudit({
          organizationId: input.organizationId,
          requestedBy: message.senderId,
          channelId: channel.id,
          messageId: message.id,
          decision: 'skip',
          confidence: 0,
          rationale: 'channel cooldown window active',
          prompt: message.content,
        });
        return { decision: 'skip', confidence: 0, auditEventId: audit.id };
      }

      const normalizedPrompt = normalizePromotionPrompt(message.content);
      if (this.isDuplicatePrompt(channel.id, normalizedPrompt)) {
        const audit = this.writePromoterAudit({
          organizationId: input.organizationId,
          requestedBy: message.senderId,
          channelId: channel.id,
          messageId: message.id,
          decision: 'skip',
          confidence: 0,
          rationale: 'near-duplicate human message in dedupe window',
          prompt: message.content,
        });
        return { decision: 'skip', confidence: 0, auditEventId: audit.id };
      }

      this.channelAttemptAt.set(channel.id, this.now());
      this.rememberPrompt(channel.id, normalizedPrompt);
    }

    const decision = explicit
      ? TaskPromotionDecisionSchema.parse({
          decision: 'promote',
          confidence: 1,
          team: explicit.teamHints,
          executionMode: 'concurrent',
          rationale: 'explicit /task run command',
        })
      : await this.evaluateMessage({ organizationId: input.organizationId, message, channel });

    const audit = this.writePromoterAudit({
      organizationId: input.organizationId,
      requestedBy: message.senderId,
      channelId: channel.id,
      messageId: message.id,
      decision: decision.decision,
      confidence: decision.confidence,
      rationale: decision.rationale,
      prompt: message.content,
      team: decision.team,
      executionMode: decision.executionMode,
      slugHint: decision.slugHint,
      explicitCommand: Boolean(explicit),
    });

    if (decision.decision === 'skip') {
      return {
        decision: decision.decision,
        confidence: decision.confidence,
        auditEventId: audit.id,
      };
    }

    if (decision.decision === 'confirm') {
      this.publishPromotionConfirm(message, channel, decision);
      return {
        decision: decision.decision,
        confidence: decision.confidence,
        auditEventId: audit.id,
      };
    }

    const taskSessions = this.taskSessions;
    if (!taskSessions) {
      return {
        decision: 'skip',
        confidence: 0,
        auditEventId: audit.id,
      };
    }

    const team = this.resolveTaskTeam(
      input.organizationId,
      channel,
      decision.team,
    );
    if (team.length === 0) {
      return {
        decision: 'skip',
        confidence: 0,
        auditEventId: audit.id,
      };
    }

    const detail = taskSessions.create({
      organizationId: input.organizationId,
      requestedBy: message.senderId,
      prompt: explicit?.prompt ?? message.content,
      team,
      executionMode: decision.executionMode ?? 'concurrent',
      origin: { channelId: channel.id, messageId: message.id },
      promotionMetadata: {
        confidence: decision.confidence,
        rationale: decision.rationale,
        explicitCommand: Boolean(explicit),
      },
      slug: decision.slugHint,
    });

    if (this.autoStart) {
      queueMicrotask(() => {
        void taskSessions
          .start(input.organizationId, detail.session.id, { runFirstTurn: true })
          .catch((err) => {
            const messageText = err instanceof Error ? err.message : String(err);
            this.writePromoterAudit({
              organizationId: input.organizationId,
              requestedBy: message.senderId,
              channelId: channel.id,
              messageId: message.id,
              decision: 'skip',
              confidence: 0,
              rationale: `task session auto-start failed: ${messageText}`,
              prompt: message.content,
              status: 'error',
            });
          });
      });
    }

    return {
      decision: decision.decision,
      confidence: decision.confidence,
      auditEventId: audit.id,
      taskSessionId: detail.session.id,
      taskChannelId: detail.session.channelId,
    };
  }

  private async evaluateMessage(input: {
    organizationId: string;
    message: Message;
    channel: Channel;
  }): Promise<TaskPromotionDecision> {
    if (this.evaluator) {
      const recent = this.repo.listChannelMessages(input.organizationId, input.channel.id, {
        limit: 10,
      }).data;
      return TaskPromotionDecisionSchema.parse(
        await this.evaluator({
          organizationId: input.organizationId,
          channel: input.channel,
          message: input.message,
          recentChannelMessages: recent,
          orgChart: this.repo.getOrganization(input.organizationId)?.organizationChart ?? {},
          roles: this.listRoleSummaries(),
          activeRuns: this.listActiveTaskSessions(input.organizationId),
        }),
      );
    }

    const model = this.resolvePromoterModel(input.organizationId);
    if (!model) {
      return TaskPromotionDecisionSchema.parse({
        decision: 'skip',
        confidence: 0,
        rationale: 'no promoter model configured',
      });
    }

    const recent = this.repo
      .listChannelMessages(input.organizationId, input.channel.id, { limit: 10 })
      .data
      .map((message) => ({
        senderId: message.senderId,
        kind: message.kind,
        content: message.content,
      }));

    try {
      const result = await generateText({
        model,
        temperature: 0,
        maxOutputTokens: 400,
        system: [
          'You decide whether a human message in an org channel should become a tracked task.',
          'Return strict JSON with keys: decision, confidence, team, executionMode, slugHint, rationale.',
          'decision must be one of promote, confirm, skip.',
          'Only promote when the message clearly asks for concrete multi-step work.',
          'Use confirm when the message implies work but team/intent is ambiguous.',
          'Use skip for casual conversation, status chatter, or vague thoughts.',
        ].join('\n'),
        prompt: JSON.stringify({
          message: input.message.content,
          channelName: input.channel.name,
          recentChannelMessages: recent,
          orgChart: this.repo.getOrganization(input.organizationId)?.organizationChart ?? {},
          roles: this.listRoleSummaries(),
          activeRuns: this.listActiveTaskSessions(input.organizationId),
        }),
      });

      return TaskPromotionDecisionSchema.parse(parseJsonObject(result.text));
    } catch (err) {
      return TaskPromotionDecisionSchema.parse({
        decision: 'skip',
        confidence: 0,
        rationale: `promoter fallback: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private resolvePromoterModel(organizationId: string): LanguageModel | null {
    const team = this.teamStore?.getTeam();
    if (!team) {
      return null;
    }

    for (const role of team.roles) {
      if (!role.provider) {
        continue;
      }
      const provider = team.getProvider(role.provider);
      if (!provider) {
        continue;
      }
      const modelId = role.model ?? provider.defaultModel;
      if (!modelId) {
        continue;
      }
      const apiKey = this.repo.getProviderCredential(organizationId, role.provider);
      if (!apiKey) {
        continue;
      }
      const kind = resolveProviderKind(role.provider, provider.kind);
      if (!SUPPORTED_PROVIDER_KINDS.has(kind)) {
        continue;
      }
      return selectLanguageModel({
        kind,
        modelId,
        apiKey,
        baseUrl: provider.baseUrl,
      });
    }

    return null;
  }

  private listRoleSummaries(): { name: string; title: string; channels: string[] }[] {
    const team = this.teamStore?.getTeam();
    if (!team) {
      return [];
    }
    return team.roles.map((role) => ({
      name: role.name,
      title: role.title,
      channels: [...role.channels],
    }));
  }

  private listActiveTaskSessions(
    organizationId: string,
  ): { slug: string; status: string; team: string[] }[] {
    return this.repo.listTaskSessions(organizationId, { limit: 20 }).data
      .filter((session) => session.status === 'queued' || session.status === 'running')
      .map((session) => ({
        slug: session.slug,
        status: session.status,
        team: session.teamMemberIds,
      }));
  }

  private publishPromotionConfirm(
    sourceMessage: Message,
    channel: Channel,
    decision: TaskPromotionDecision,
  ): void {
    const conversations = this.conversations;
    if (!conversations) {
      return;
    }

    const card: MessageCard = {
      kind: 'task.promotion-confirm',
      cardId: randomUUID(),
      decision: 'confirm',
      team: this.resolveTaskTeam(sourceMessage.organizationId, channel, decision.team),
      rationale: decision.rationale,
    };

    conversations.publishMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: sourceMessage.organizationId,
        threadId: sourceMessage.threadId,
        channelId: channel.id,
        parentMessageId: sourceMessage.id,
        senderId: 'system',
        senderKind: 'human',
        kind: 'system',
        content: `Should I run this as a task? ${decision.rationale}`.trim(),
        mentions: [],
        toolCalls: [
          {
            toolCallId: card.cardId,
            toolName: `card.${card.kind}`,
            args: card as unknown as Record<string, unknown>,
            isError: false,
          },
        ],
        createdAt: new Date().toISOString(),
      }),
      [],
    );

    const timeoutMs = this.confirmTimeoutMs;
    if (timeoutMs <= 0) {
      return;
    }
    const timeout = setTimeout(() => {
      conversations.publishMessage(
        MessageSchema.parse({
          id: randomUUID(),
          organizationId: sourceMessage.organizationId,
          threadId: sourceMessage.threadId,
          channelId: channel.id,
          parentMessageId: sourceMessage.id,
          senderId: 'system',
          senderKind: 'human',
          kind: 'system',
          content: 'Task promotion timed out with no confirmation.',
          createdAt: new Date().toISOString(),
        }),
        [],
      );
    }, timeoutMs);
    timeout.unref?.();
  }

  private resolveTaskTeam(
    organizationId: string,
    channel: Channel,
    teamHints: readonly string[] = [],
  ): string[] {
    const activeAgents = this.repo
      .listMembers(organizationId)
      .filter((member) => member.kind === 'agent' && !member.retiredAt);

    const byNameOrId = new Map<string, string[]>();
    for (const member of activeAgents) {
      byNameOrId.set(member.id.toLowerCase(), [member.id]);
      byNameOrId.set(member.name.toLowerCase(), [member.id]);
      const roleKey = member.roleName.toLowerCase();
      byNameOrId.set(roleKey, [...(byNameOrId.get(roleKey) ?? []), member.id]);
    }

    const resolved: string[] = [];
    for (const hint of teamHints) {
      const key = hint.trim().toLowerCase();
      if (!key) continue;
      for (const memberId of byNameOrId.get(key) ?? []) {
        if (!resolved.includes(memberId)) {
          resolved.push(memberId);
        }
      }
    }
    if (resolved.length > 0) {
      return resolved;
    }

    const channelAgents = activeAgents
      .filter((member) => channel.memberIds.includes(member.id))
      .map((member) => member.id);
    if (channelAgents.length > 0) {
      return channelAgents;
    }

    return activeAgents.map((member) => member.id);
  }

  private shouldRateLimit(channelId: string): boolean {
    const last = this.channelAttemptAt.get(channelId);
    if (last === undefined) {
      return false;
    }
    return this.now() - last < this.channelCooldownMs;
  }

  private isDuplicatePrompt(channelId: string, prompt: string): boolean {
    const cutoff = this.now() - this.dedupeWindowMs;
    const recent = (this.channelDedupes.get(channelId) ?? []).filter((entry) => entry.at >= cutoff);
    this.channelDedupes.set(channelId, recent);
    return recent.some((entry) => entry.prompt === prompt);
  }

  private rememberPrompt(channelId: string, prompt: string): void {
    const cutoff = this.now() - this.dedupeWindowMs;
    const recent = (this.channelDedupes.get(channelId) ?? []).filter((entry) => entry.at >= cutoff);
    recent.push({ prompt, at: this.now() });
    this.channelDedupes.set(channelId, recent);
  }

  private resolveAssignee(input: TaskPromotionInput): string | null {
    if (input.assignedAgentId) {
      const member = this.repo.getMember(input.organizationId, input.assignedAgentId);
      if (member && member.kind === AGENT_KIND && !member.retiredAt) return member.id;
      return null;
    }
    const agents = this.repo
      .listMembers(input.organizationId)
      .filter((m) => m.kind === AGENT_KIND && !m.retiredAt);
    return agents[0]?.id ?? null;
  }

  private writeLegacyAudit(
    input: TaskPromotionInput,
    assignee: string | null,
    status: 'ok' | 'blocked' | 'error',
    reason: string,
    runId?: string,
  ): AuditEvent {
    return this.repo.saveAuditEvent({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorId: input.requestedBy,
      action: 'task.promoted',
      targetType: 'message',
      targetId: input.messageId,
      status,
      metadata: {
        channelId: input.channelId,
        threadId: input.threadId,
        assignedAgentId: assignee,
        runId,
        reason: input.reason ?? reason,
        prompt: input.prompt,
      },
      createdAt: new Date().toISOString(),
    });
  }

  private writePromoterAudit(input: {
    organizationId: string;
    requestedBy: string;
    channelId: string;
    messageId: string;
    decision: TaskPromotionDecision['decision'];
    confidence: number;
    rationale: string;
    prompt: string;
    team?: readonly string[];
    executionMode?: TaskExecutionMode;
    slugHint?: string;
    explicitCommand?: boolean;
    status?: 'ok' | 'blocked' | 'error';
  }): AuditEvent {
    return this.repo.saveAuditEvent({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorId: input.requestedBy,
      action: 'audit.task_promoter',
      targetType: 'message',
      targetId: input.messageId,
      status: input.status ?? 'ok',
      metadata: {
        channelId: input.channelId,
        decision: input.decision,
        confidence: input.confidence,
        rationale: input.rationale,
        team: input.team ?? [],
        executionMode: input.executionMode,
        slugHint: input.slugHint,
        explicitCommand: input.explicitCommand ?? false,
        prompt: input.prompt,
      },
      createdAt: new Date().toISOString(),
    });
  }
}

function parseExplicitTaskCommand(
  content: string,
): { teamHints: string[]; prompt: string } | null {
  const match = content.trim().match(EXPLICIT_TASK_RUN_RE);
  if (!match) {
    return null;
  }
  const teamHints = match[1]
    ? match[1]
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  const prompt = match[2]?.trim();
  if (!prompt) {
    return null;
  }
  return { teamHints, prompt };
}

function normalizePromotionPrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('promoter model did not return JSON');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}
