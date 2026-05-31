import { randomUUID } from 'node:crypto';
import type { Goal, GoalTask, GoalTaskStatus, InteractiveQuestion } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export const QUESTION_RECOMMENDED_SUFFIX = '(Recommended)';

export interface ParsedPlanTask {
  title: string;
  assigneeId: string;
  dependsOnTaskIndex?: number;
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
) => Promise<unknown> | unknown;

export class GoalSystemService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly resumeRun?: ResumeInputRun,
  ) {}

  start(input: {
    organizationId: string;
    channelId: string;
    supervisorId: string;
    title: string;
    planMarkdown: string;
    tasks: ParsedPlanTask[];
  }): Goal {
    const now = new Date().toISOString();
    const tasks = validatePlanTasks(input.tasks);
    return this.repo.transaction(() => {
      const existing = this.repo.getGoalByChannel(input.organizationId, input.channelId);
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
      this.repo.deleteGoalTasks(input.organizationId, goal.id);
      for (const question of this.repo.listPendingInteractiveQuestions(input.organizationId, input.channelId)) {
        this.repo.saveInteractiveQuestion({
          ...question,
          status: 'superseded',
          updatedAt: now,
        });
      }
      const taskIds = tasks.map(() => randomUUID());
      tasks.forEach((task, index) => {
        const taskId = taskIds[index];
        if (!taskId) throw new Error(`Missing task id for "${task.title}"`);
        this.repo.saveGoalTask({
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
        });
      });
      return goal;
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
    status: GoalTaskStatus;
    handoverSummary?: string;
  }): GoalTask | null {
    const task = this.repo.updateGoalTaskStatus(input.organizationId, input.taskId, input.status, {
      handoverSummary: input.handoverSummary,
    });
    if (!task) return null;
    this.syncGoalStatus(input.organizationId, task.goalId);
    return task;
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

    const runId = question.runId;
    if (runId && this.resumeRun) {
      const run = this.repo.getRun(organizationId, runId);
      if (run && run.status === 'waiting_for_input') {
        void Promise.resolve(this.resumeRun(organizationId, runId)).catch((error) => {
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

  /**
   * Auto-prompt the user after a planning-mode run completes:
   * once the agent has finished proposing the plan, ask whether
   * to implement it (or redirect). No-op unless the channel has a
   * goal in `planning` and no other question is pending.
   */
  maybePromptImplement(input: {
    organizationId: string;
    channelId: string;
    agentName: string;
  }): InteractiveQuestion | null {
    const goal = this.repo.getGoalByChannel(input.organizationId, input.channelId);
    if (!goal || goal.status !== 'planning') return null;
    const pending = this.repo.listPendingInteractiveQuestions(input.organizationId, input.channelId);
    if (pending.length > 0) return null;
    return this.ask({
      organizationId: input.organizationId,
      channelId: input.channelId,
      goalId: goal.id,
      questionText: 'Do you want me to implement?',
      options: ['Yes, implement (Recommended)', `Tell ${input.agentName} to do something different`],
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
