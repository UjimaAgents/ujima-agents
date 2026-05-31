import { randomUUID } from 'node:crypto';
import type { Goal, GoalTask, GoalTaskStatus, InteractiveQuestion } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

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
    return this.repo.updateGoalTaskStatus(input.organizationId, input.taskId, input.status, {
      handoverSummary: input.handoverSummary,
    });
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
    return this.repo.saveInteractiveQuestion({
      id: randomUUID(),
      organizationId: input.organizationId,
      channelId: input.channelId,
      goalId: input.goalId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      questionText: input.questionText,
      options: input.options,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  answer(organizationId: string, questionId: string, selectedOption: string): InteractiveQuestion {
    const question = this.repo.getInteractiveQuestion(organizationId, questionId);
    if (!question) throw new Error(`Question not found: ${questionId}`);
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
      options: ['Yes, implement', `Tell ${input.agentName} to do something different`],
    });
  }
}
