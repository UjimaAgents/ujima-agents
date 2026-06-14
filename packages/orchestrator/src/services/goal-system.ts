import { randomUUID } from 'node:crypto';
import type { Goal, GoalTask, GoalTaskStatus, InteractiveQuestion } from '@ujima/shared';
import { goalTaskColumnLabel } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import { evictStaleTimestamps } from '../utils/ttl-map.js';

export type GoalTaskUpdateResult = GoalTask & { previousStatus?: GoalTaskStatus };

export const QUESTION_RECOMMENDED_SUFFIX = '(Recommended)';
export const IMPLEMENT_QUESTION_TEXT = 'Do you want me to implement?';
export const IMPLEMENT_QUESTION_OPTION = `Yes, implement ${QUESTION_RECOMMENDED_SUFFIX}`;
export const IMPLEMENT_QUESTION_REJECT_OPTION = 'No, stop';

export interface ParsedPlanTask {
  title: string;
  assigneeId: string;
  dependsOnTaskIndex?: number;
}

export interface GoalStartResult {
  goal: Goal;
  tasks: GoalTask[];
}

function validatePlanTasks(tasks: ParsedPlanTask[]): ParsedPlanTask[] {
  if (tasks.length === 0) {
    throw new Error('Plan must contain at least one task');
  }
  tasks.forEach((task, index) => {
    if (
      task.dependsOnTaskIndex !== undefined &&
      (task.dependsOnTaskIndex < 0 || task.dependsOnTaskIndex >= index)
    ) {
      throw new Error(`Invalid dependency for "${task.title}"`);
    }
  });
  return tasks;
}

function validateQuestionOptions(options: string[]): string[] {
  if (options.length < 2) {
    throw new Error('Question must include at least two options');
  }
  if (new Set(options).size !== options.length) {
    throw new Error('Question options must be unique');
  }
  const recommendedCount = options.filter((option) => option.endsWith(QUESTION_RECOMMENDED_SUFFIX)).length;
  if (recommendedCount !== 1) {
    throw new Error(`Question must include exactly one option ending with ${QUESTION_RECOMMENDED_SUFFIX}`);
  }
  return options;
}

export type ResumeInputRun = (
  organizationId: string,
  runId: string,
  allowRun?: boolean,
) => Promise<unknown> | unknown;

// Dedup window for goal-task nudges. A task gets nudged at most
// once per window per (taskId), regardless of which path fired —
// dependency-completion handover or the periodic sweep.
const NUDGE_DEDUP_WINDOW_MS = 10 * 60 * 1000;
// Pending tasks that have sat idle longer than this with no
// dependency are still nudged on every sweep (the periodic safety
// net) — keeps `updated_at` fresh while bounded by the dedup map.
const PENDING_IDLE_THRESHOLD_MS = 5 * 60 * 1000;
// In-progress tasks get a longer grace period since the assignee is
// already supposed to be working. We only nudge if BOTH no fresh
// run exists for the assignee AND the task hasn't been updated
// in this window.
const IN_PROGRESS_IDLE_THRESHOLD_MS = 10 * 60 * 1000;
// "Agent still working?" window for the in-progress nudge guard.
// If the assignee has any active run with started_at newer than
// this, skip the nudge — the agent is mid-task, no need to poke.
const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export class GoalSystemService {
  private readonly lastNudgedAt = new Map<string, number>();

  constructor(
    private readonly repo: ApiRepository,
    private readonly resumeRun?: ResumeInputRun,
    private readonly conversations?: ConversationService,
  ) {}

  start(input: {
    organizationId: string;
    channelId: string;
    supervisorId: string;
    title: string;
    planMarkdown: string;
    tasks: ParsedPlanTask[];
  }): GoalStartResult {
    const now = new Date().toISOString();
    const tasks = validatePlanTasks(input.tasks);
    return this.repo.transaction(() => {
      const channel = this.repo.getChannel(input.organizationId, input.channelId);
      const existing =
        channel?.kind === 'dm' || channel?.kind === 'self'
          ? this.repo.getGoalByChannel(input.organizationId, input.channelId)
          : null;
      const goal = this.repo.saveGoal({
        id: existing?.id ?? randomUUID(),
        organizationId: input.organizationId,
        channelId: input.channelId,
        title: input.title,
        status: 'planning',
        supervisorId: input.supervisorId,
        planMarkdown: input.planMarkdown,
        planVersion: (existing?.planVersion ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      if (existing) {
        this.repo.deleteGoalTasks(input.organizationId, goal.id);
        for (const question of this.repo.listPendingInteractiveQuestions(input.organizationId, input.channelId)) {
          if (question.goalId !== goal.id) continue;
          this.repo.saveInteractiveQuestion({ ...question, status: 'superseded', updatedAt: now });
        }
      }
      const taskIds = tasks.map(() => randomUUID());
      const savedTasks: GoalTask[] = [];
      tasks.forEach((task, index) => {
        const taskId = taskIds[index];
        if (!taskId) throw new Error(`Missing task id for "${task.title}"`);
        savedTasks.push(this.repo.saveGoalTask({
          id: taskId,
          organizationId: input.organizationId,
          goalId: goal.id,
          title: task.title,
          description: '',
          status: task.dependsOnTaskIndex === undefined ? 'pending' : 'blocked',
          assigneeId: task.assigneeId,
          createdBy: input.supervisorId,
          dependsOnTaskId:
            task.dependsOnTaskIndex === undefined ? undefined : taskIds[task.dependsOnTaskIndex],
          createdAt: now,
          updatedAt: now,
        }));
      });
      return { goal, tasks: savedTasks };
    });
  }

  implement(organizationId: string, goalId: string): { goal: Goal; tasks: GoalTask[] } {
    return this.repo.transaction(() => {
      const goal = this.repo.getGoal(organizationId, goalId);
      if (!goal) throw new Error(`Goal not found: ${goalId}`);
      if (goal.status !== 'planning') throw new Error('Only planning goals can be implemented');
      const now = new Date().toISOString();
      const tasks = this.repo.listGoalTasks(organizationId, goalId);
      if (tasks.length === 0) throw new Error('Goal has no tasks');
      const updated = this.repo.saveGoal({ ...goal, status: 'running', updatedAt: now });
      return { goal: updated, tasks };
    });
  }

  updateTask(input: {
    organizationId: string;
    taskId: string;
    status?: GoalTaskStatus;
    handoverSummary?: string;
    // Plan-edit fields — supervisor-only. callerMemberId is
    // required when any of these are set so we can authorize.
    title?: string;
    description?: string;
    assigneeId?: string;
    callerMemberId?: string;
  }): GoalTaskUpdateResult {
    const editsPlan =
      input.title !== undefined ||
      input.description !== undefined ||
      input.assigneeId !== undefined;

    return this.repo.transaction((): GoalTaskUpdateResult => {
      const existing = this.repo.getGoalTask(input.organizationId, input.taskId);
      if (!existing) throw new Error(`Goal task not found: ${input.taskId}`);
      const oldStatus = existing.status;

      if (editsPlan) {
        if (!input.callerMemberId) {
          throw new Error(
            'callerMemberId is required when editing task title / description / assignee.',
          );
        }
        const goal = this.repo.getGoal(input.organizationId, existing.goalId);
        if (!goal) throw new Error(`Goal not found for task: ${input.taskId}`);
        if (input.callerMemberId !== goal.supervisorId) {
          throw new Error(
            `Only the goal supervisor (${goal.supervisorId}) can edit task title / description / assignee.`,
          );
        }
        this.repo.saveGoalTask({
          ...existing,
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
          assigneeId: input.assigneeId ?? existing.assigneeId,
          handoverSummary: input.handoverSummary ?? existing.handoverSummary,
          updatedAt: new Date().toISOString(),
        });
      }

      if (input.status !== undefined) {
        this.lastNudgedAt.delete(input.taskId);
        const task = this.repo.updateGoalTaskStatus(
          input.organizationId,
          input.taskId,
          input.status,
          { handoverSummary: input.handoverSummary },
        );
        if (!task) throw new Error(`Goal task not found: ${input.taskId}`);
        this.syncGoalStatus(input.organizationId, task.goalId);
        if (
          task.assigneeId &&
          input.callerMemberId &&
          input.callerMemberId !== task.assigneeId &&
          oldStatus !== input.status
        ) {
          this.notifyTaskMoved(input.organizationId, task, oldStatus, input.callerMemberId);
        }
        if (input.status === 'completed') {
          this.notifyDependentsUnblocked(input.organizationId, task);
        }
        return {
          ...task,
          ...(oldStatus !== input.status ? { previousStatus: oldStatus } : {}),
        };
      }

      if (input.handoverSummary !== undefined && !editsPlan) {
        this.repo.saveGoalTask({
          ...existing,
          handoverSummary: input.handoverSummary,
          updatedAt: new Date().toISOString(),
        });
      }

      const refreshed = this.repo.getGoalTask(input.organizationId, input.taskId);
      if (!refreshed) throw new Error(`Goal task not found: ${input.taskId}`);
      return refreshed;
    });
  }

  // Dependency-wake: when `completedTask` flips to completed, find
  // every `pending` task in the same goal whose `depends_on_task_id`
  // matched it and DM each assignee. The @mention in the DM body
  // is the wake — Conversation's posting pipeline fans out from
  // there. Per-goal scope; multi-goal orgs are safe because we
  // query tasks by `goalId`.
  private notifyDependentsUnblocked(organizationId: string, completedTask: GoalTask): void {
    if (!this.conversations) return;
    const siblings = this.repo.listGoalTasks(organizationId, completedTask.goalId);
    for (const t of siblings) {
      if (t.status !== 'pending') continue;
      if (t.dependsOnTaskId !== completedTask.id) continue;
      this.nudgeAssignee(organizationId, t, 'unblocked', completedTask);
    }
  }

  // Board-move notification: when someone (human or agent) drags a
  // task to a different column, wake the assignee with a short
  // message describing the change. Deduped separately from nudges
  // so a move + nudge inside the window don't cancel each other.
  private notifyTaskMoved(
    organizationId: string,
    task: GoalTask,
    oldStatus: GoalTaskStatus,
    _moverMemberId: string,
  ): void {
    if (!this.conversations) return;
    const dedupKey = `moved:${task.id}`;
    const now = Date.now();
    const last = this.lastNudgedAt.get(dedupKey);
    if (last && now - last < NUDGE_DEDUP_WINDOW_MS) return;
    const goal = this.repo.getGoal(organizationId, task.goalId);
    if (!goal) return;
    const fromLabel = goalTaskColumnLabel(oldStatus);
    const toLabel = goalTaskColumnLabel(task.status);
    // Include mover identity so the assignee knows who made the change
    try {
      this.postNotificationToAssignee({
        organizationId,
        goal,
        task,
        body: `@${task.assigneeId} task "${task.title}" was moved from [${fromLabel}] → [${toLabel}]. (task_id: ${task.id})`,
        skipChannelCopy: true,
      });
      this.lastNudgedAt.set(dedupKey, now);
    } catch {
      // best-effort: a missing channel / unavailable sender must
      // not break the status update.
    }
  }

  // Periodic sweep across every org. Each `pending` task that has
  // no dependency (or a completed one) AND has gone idle longer
  // than the threshold gets a nudge. `in_progress` tasks idle
  // longer than the IN_PROGRESS threshold ALSO get a nudge, but
  // only when the assignee has no currently-active run in the
  // AGENT_ACTIVE_WINDOW (the "is the agent actually working?"
  // guard). `lastNudgedAt` dedups across both kinds so the 30s
  // scheduler tick can't spam.
  sweepAllPendingTasks(): void {
    if (!this.conversations) return;
    const now = Date.now();
    evictStaleTimestamps(this.lastNudgedAt, now, NUDGE_DEDUP_WINDOW_MS);
    for (const org of this.repo.listOrganizations()) {
      const activeRuns = this.repo.listActiveRuns?.(org.id) ?? [];
      const activeAssignees = new Set<string>();
      for (const run of activeRuns) {
        const startedMs = Date.parse(run.startedAt);
        if (Number.isFinite(startedMs) && now - startedMs < AGENT_ACTIVE_WINDOW_MS) {
          activeAssignees.add(run.agentId);
        }
      }
      for (const goal of this.repo.listGoals(org.id)) {
        if (goal.status !== 'running' && goal.status !== 'planning') continue;
        const tasks = this.repo.listGoalTasks(org.id, goal.id);
        const byId = new Map(tasks.map((t) => [t.id, t]));
        for (const t of tasks) {
          if (t.status === 'pending') {
            if (t.dependsOnTaskId) {
              const dep = byId.get(t.dependsOnTaskId);
              if (dep && dep.status !== 'completed') continue;
            }
            const updatedMs = Date.parse(t.updatedAt);
            if (Number.isFinite(updatedMs) && now - updatedMs < PENDING_IDLE_THRESHOLD_MS) continue;
            this.nudgeAssignee(org.id, t, 'idle');
            continue;
          }
          if (t.status === 'in_progress') {
            // "Still working?" guard: skip if the assignee already
            // has a fresh active run. They're mid-task; another nudge
            // would just add noise.
            if (activeAssignees.has(t.assigneeId)) continue;
            const updatedMs = Date.parse(t.updatedAt);
            if (Number.isFinite(updatedMs) && now - updatedMs < IN_PROGRESS_IDLE_THRESHOLD_MS) continue;
            this.nudgeAssignee(org.id, t, 'stalled');
          }
        }
      }
    }
  }

  // Post a task notification to the assignee. Wake is ALWAYS delivered
  // via DM — the DM participant fanout is the most reliable wake path
  // (no channel membership checks, no mention parsing, works for every
  // channel type). Separately, if the assignee is in the goal channel
  // we also post a visibility copy there WITHOUT @mention so the DM
  // handles the wake and the channel shows the event to everyone.
  private postNotificationToAssignee(input: {
    organizationId: string;
    goal: Goal;
    task: GoalTask;
    body: string;
    skipChannelCopy?: boolean;
  }): void {
    if (!this.conversations) return;
    const { organizationId, goal, task, body } = input;

    // Always wake the assignee via DM. The DM participant fanout
    // already excludes the sender (alertDirectMessageParticipants
    // filters memberIds.filter(id => id !== message.senderId)), so
    // the goal supervisor is not woken by their own notification.
    // This guarantees the assignee receives the wake regardless of
    // goal channel type (DM, shared, or otherwise).
    this.conversations.sendDirectMessage({
      organizationId,
      senderId: goal.supervisorId,
      recipientId: task.assigneeId,
      content: body,
      mentions: [task.assigneeId],
      metadata: {},
    });

    // Also post to the goal channel for shared visibility, but ONLY
    // if the assignee is a member (otherwise the message would refer
    // to an agent the channel readers can't even see). No @mention
    // here — the DM already handles the wake.
    if (!input.skipChannelCopy) {
      const channel = this.repo.getChannel(organizationId, goal.channelId);
      if (channel && channel.memberIds.includes(task.assigneeId)) {
        this.conversations.postToChannel({
          organizationId,
          senderId: goal.supervisorId,
          channelId: goal.channelId,
          body,
          mentions: [],
          metadata: {},
        });
      }
    }
  }

  private nudgeAssignee(
    organizationId: string,
    task: GoalTask,
    reason: 'unblocked' | 'idle' | 'stalled',
    completedDependency?: GoalTask,
  ): void {
    if (!this.conversations) return;
    const now = Date.now();
    // Dedup checks BOTH the in-memory map (fast path, no DB read)
    // AND the persisted task.lastNudgedAt (durable, survives a
    // daemon restart). Pre-fix the in-memory map was the only
    // gate, so a process recycle inside the dedup window let the
    // sweeper immediately re-nudge a task the UI was still showing
    // as "Next nudge in M:SS".
    const lastInMemory = this.lastNudgedAt.get(task.id);
    if (lastInMemory && now - lastInMemory < NUDGE_DEDUP_WINDOW_MS) return;
    if (task.lastNudgedAt) {
      const persistedMs = Date.parse(task.lastNudgedAt);
      if (Number.isFinite(persistedMs) && now - persistedMs < NUDGE_DEDUP_WINDOW_MS) {
        // Hydrate the in-memory map so subsequent ticks short-circuit
        // on the fast path until the window expires.
        this.lastNudgedAt.set(task.id, persistedMs);
        return;
      }
    }
    const goal = this.repo.getGoal(organizationId, task.goalId);
    if (!goal) return;
    const sender = goal.supervisorId;
    if (sender === task.assigneeId) return;
    const body =
      reason === 'unblocked'
        ? `@${task.assigneeId} task "${task.title}" is now unblocked${completedDependency ? ` (dependency "${completedDependency.title}" completed)` : ''}. You can start when ready. (task_id: ${task.id})`
        : reason === 'stalled'
          ? `@${task.assigneeId} task "${task.title}" has been in progress with no update for a while. Status check — please post progress or flip status if blocked. (task_id: ${task.id})`
          : `@${task.assigneeId} task "${task.title}" is still pending and unblocked. Please proceed when ready. (task_id: ${task.id})`;
    try {
      this.postNotificationToAssignee({
        organizationId,
        goal,
        task,
        body,
      });
      this.lastNudgedAt.set(task.id, now);
      // Persist so the UI countdown survives a daemon restart and
      // so the dedup state isn't lost on process recycle.
      this.repo.setGoalTaskLastNudgedAt?.(
        organizationId,
        task.id,
        new Date(now).toISOString(),
      );
    } catch {
      // best-effort: a missing channel / unavailable sender must
      // not break updateTask or the scheduler tick.
    }
  }

  ask(input: {
    organizationId: string;
    channelId: string;
    goalId?: string;
    runId?: string;
    toolCallId?: string;
    questionText: string;
    options: string[];
  }): InteractiveQuestion {
    const now = new Date().toISOString();
    const options = validateQuestionOptions(input.options);
    return this.repo.saveInteractiveQuestion({
      id: randomUUID(),
      organizationId: input.organizationId,
      channelId: input.channelId,
      goalId: input.goalId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      questionText: input.questionText,
      options,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  answer(organizationId: string, questionId: string, selectedOption: string): InteractiveQuestion {
    const question = this.repo.getInteractiveQuestion(organizationId, questionId);
    if (!question) throw new Error(`Question not found: ${questionId}`);
    if (question.status !== 'pending') throw new Error('Question is no longer pending');
    if (!question.options.includes(selectedOption)) throw new Error('Selected option is not valid for this question');
    const now = new Date().toISOString();

    const answeredQuestion = this.repo.saveInteractiveQuestion({
      ...question,
      status: 'answered',
      selectedOption,
      updatedAt: now,
    });

    if (question.runId && question.toolCallId) {
      const step = this.repo
        .listRunSteps(organizationId, question.runId)
        .find((candidate) => candidate.toolCallId === question.toolCallId);
      if (step) {
        const output = step.output && typeof step.output === 'object' && !Array.isArray(step.output)
          ? step.output as Record<string, unknown>
          : {};
        this.repo.saveRunStep({
          ...step,
          output: { ...output, status: 'completed', selectedOption },
        });
      }
    }

    const isImplementQuestion = question.questionText === IMPLEMENT_QUESTION_TEXT && !!question.goalId;
    const implementApproved = isImplementQuestion && selectedOption === IMPLEMENT_QUESTION_OPTION;
    const implementRejected = isImplementQuestion && selectedOption === IMPLEMENT_QUESTION_REJECT_OPTION;

    if (question.goalId && implementApproved) {
      try {
        this.implement(organizationId, question.goalId);
      } catch {
        // Surface failure quietly: the goal may have already been
        // implemented or cancelled. The supervisor agent can re-prompt
        // on a subsequent run if needed.
      }
    }

    const runId = question.runId;
    if (runId && this.resumeRun) {
      const run = this.repo.getRun(organizationId, runId);
      if (implementRejected) {
        for (const pending of this.repo.listInteractiveQuestionsByRunId(organizationId, runId)) {
          if (pending.status !== 'pending') continue;
          this.repo.saveInteractiveQuestion({ ...pending, status: 'superseded', updatedAt: now });
        }
      }
      // Only resume once *every* question this run posted has been
      // resolved. A run that asked two questions must not get its
      // execution back after just one answer — the agent would
      // proceed with a partially-known context.
      const stillPending = (
        this.repo.listInteractiveQuestionsByRunId?.(organizationId, runId) ?? []
      ).some((q) => q.status === 'pending');
      if (run && run.status === 'waiting_for_input' && !stillPending) {
        void Promise.resolve(this.resumeRun(organizationId, runId, !implementRejected)).catch((error) => {
          const current = this.repo.getRun(organizationId, runId);
          if (!current || current.status !== 'waiting_for_input') return;
          const message = error instanceof Error ? error.message : String(error);
          this.repo.saveRun({
            ...current,
            status: 'failed',
            step: 'failed',
            summary: message || 'Run failed while resuming after user input',
            endedAt: new Date().toISOString(),
          });
        });
      }
    }

    return answeredQuestion;
  }

  supersede(organizationId: string, questionId: string): InteractiveQuestion {
    const question = this.repo.getInteractiveQuestion(organizationId, questionId);
    if (!question) throw new Error(`Question not found: ${questionId}`);
    if (question.status !== 'pending') throw new Error('Question is no longer pending');
    return this.repo.saveInteractiveQuestion({
      ...question,
      status: 'superseded',
      updatedAt: new Date().toISOString(),
    });
  }

  private syncGoalStatus(organizationId: string, goalId: string): void {
    const goal = this.repo.getGoal(organizationId, goalId);
    if (!goal || goal.status === 'cancelled') return;
    const tasks = this.repo.listGoalTasks(organizationId, goalId);
    const now = new Date().toISOString();
    if (tasks.length > 0 && tasks.every((task) => task.status === 'completed')) {
      this.repo.saveGoal({ ...goal, status: 'completed', updatedAt: now });
      return;
    }
    if (tasks.length > 0 && tasks.every((task) => task.status === 'cancelled')) {
      this.repo.saveGoal({ ...goal, status: 'cancelled', updatedAt: now });
      return;
    }
    if (tasks.some((task) => task.status === 'failed' || task.status === 'blocked_by_failure')) {
      this.repo.saveGoal({ ...goal, status: 'suspended', updatedAt: now });
      return;
    }
    if (goal.status === 'planning' || goal.status === 'suspended' || goal.status === 'completed') {
      this.repo.saveGoal({ ...goal, status: 'running', updatedAt: now });
    }
  }
}
