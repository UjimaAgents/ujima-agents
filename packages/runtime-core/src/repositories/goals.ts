import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  GoalSchema,
  GoalTaskSchema,
  InteractiveQuestionSchema,
  type Goal,
  type GoalTask,
  type GoalTaskStatus,
  type InteractiveQuestion,
} from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

const toGoal = (row: Row): Goal =>
  GoalSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: rowString(row, 'channel_id'),
    title: rowString(row, 'title'),
    status: rowString(row, 'status'),
    supervisorId: rowString(row, 'supervisor_id'),
    planMarkdown: rowString(row, 'plan_markdown'),
    planVersion: Number(row.plan_version) || 1,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });

const toTask = (row: Row): GoalTask =>
  GoalTaskSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    goalId: rowString(row, 'goal_id'),
    title: rowString(row, 'title'),
    description: rowString(row, 'description'),
    status: rowString(row, 'status'),
    assigneeId: rowString(row, 'assignee_id'),
    createdBy: rowString(row, 'created_by'),
    dependsOnTaskId: optionalRowString(row, 'depends_on_task_id'),
    handoverSummary: optionalRowString(row, 'handover_summary'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });

const toQuestion = (row: Row): InteractiveQuestion =>
  InteractiveQuestionSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: rowString(row, 'channel_id'),
    goalId: optionalRowString(row, 'goal_id'),
    runId: optionalRowString(row, 'run_id'),
    toolCallId: optionalRowString(row, 'tool_call_id'),
    questionText: rowString(row, 'question_text'),
    options: JSON.parse(rowString(row, 'options_json')),
    status: rowString(row, 'status'),
    selectedOption: optionalRowString(row, 'selected_option'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });

export function saveGoal(db: DbHandle, goal: Goal): Goal {
  const payload = GoalSchema.parse(goal);
  db.prepare(
    `INSERT INTO goals (
      id, organization_id, channel_id, title, status, supervisor_id,
      plan_markdown, plan_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      supervisor_id = excluded.supervisor_id,
      plan_markdown = excluded.plan_markdown,
      plan_version = excluded.plan_version,
      updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId,
    payload.title,
    payload.status,
    payload.supervisorId,
    payload.planMarkdown,
    payload.planVersion,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getGoal(db: DbHandle, organizationId: string, goalId: string): Goal | null {
  const row = db.prepare('SELECT * FROM goals WHERE organization_id = ? AND id = ?').get(
    organizationId,
    goalId,
  ) as Row | null;
  return row ? toGoal(row) : null;
}

export function getGoalByChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): Goal | null {
  const row = db.prepare('SELECT * FROM goals WHERE organization_id = ? AND channel_id = ?').get(
    organizationId,
    channelId,
  ) as Row | null;
  return row ? toGoal(row) : null;
}

export function listGoals(db: DbHandle, organizationId: string): Goal[] {
  return (db
    .prepare('SELECT * FROM goals WHERE organization_id = ? ORDER BY updated_at DESC')
    .all(organizationId) as Row[]).map(toGoal);
}

export function saveGoalTask(db: DbHandle, task: GoalTask): GoalTask {
  const payload = GoalTaskSchema.parse(task);
  db.prepare(
    `INSERT INTO goal_tasks (
      id, organization_id, goal_id, title, description, status, assignee_id,
      created_by, depends_on_task_id, handover_summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      assignee_id = excluded.assignee_id,
      depends_on_task_id = excluded.depends_on_task_id,
      handover_summary = excluded.handover_summary,
      updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.goalId,
    payload.title,
    payload.description,
    payload.status,
    payload.assigneeId,
    payload.createdBy,
    payload.dependsOnTaskId ?? null,
    payload.handoverSummary ?? null,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function deleteGoalTasks(db: DbHandle, organizationId: string, goalId: string): void {
  db.prepare('DELETE FROM goal_tasks WHERE organization_id = ? AND goal_id = ?').run(
    organizationId,
    goalId,
  );
}

export function listGoalTasks(db: DbHandle, organizationId: string, goalId: string): GoalTask[] {
  return (db
    .prepare('SELECT * FROM goal_tasks WHERE organization_id = ? AND goal_id = ? ORDER BY created_at ASC')
    .all(organizationId, goalId) as Row[]).map(toTask);
}

export function getGoalTask(
  db: DbHandle,
  organizationId: string,
  taskId: string,
): GoalTask | null {
  const row = db.prepare('SELECT * FROM goal_tasks WHERE organization_id = ? AND id = ?').get(
    organizationId,
    taskId,
  ) as Row | null;
  return row ? toTask(row) : null;
}

export function updateGoalTaskStatus(
  db: DbHandle,
  organizationId: string,
  taskId: string,
  status: GoalTaskStatus,
  options: { handoverSummary?: string } = {},
): GoalTask | null {
  const existing = db.prepare('SELECT * FROM goal_tasks WHERE organization_id = ? AND id = ?').get(
    organizationId,
    taskId,
  ) as Row | null;
  if (!existing) return null;
  const existingTask = toTask(existing);
  if ((status === 'in_progress' || status === 'completed') && existingTask.dependsOnTaskId) {
    const dependency = getGoalTask(db, organizationId, existingTask.dependsOnTaskId);
    if (!dependency || dependency.status !== 'completed') {
      throw new Error('Cannot start or complete a task before its dependency is completed');
    }
  }
  if (
    status === 'completed' &&
    !options.handoverSummary &&
    !existingTask.handoverSummary &&
    db.prepare('SELECT 1 FROM goal_tasks WHERE organization_id = ? AND depends_on_task_id = ? LIMIT 1').get(
      organizationId,
      taskId,
    )
  ) {
    throw new Error('handover_summary is required when completing a task with downstream dependents');
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE goal_tasks
       SET status = ?, handover_summary = COALESCE(?, handover_summary), updated_at = ?
     WHERE organization_id = ? AND id = ?`,
  ).run(status, options.handoverSummary ?? null, now, organizationId, taskId);
  if (status === 'completed') {
    db.prepare(
      `UPDATE goal_tasks SET status = 'pending', updated_at = ?
       WHERE organization_id = ? AND depends_on_task_id = ? AND status = 'blocked'`,
    ).run(now, organizationId, taskId);
  }
  if (status === 'failed' || status === 'cancelled') {
    db.prepare(
      `WITH RECURSIVE downstream(id) AS (
         SELECT id FROM goal_tasks WHERE organization_id = ? AND depends_on_task_id = ?
         UNION ALL
         SELECT goal_tasks.id FROM goal_tasks
         JOIN downstream ON goal_tasks.depends_on_task_id = downstream.id
         WHERE goal_tasks.organization_id = ?
       )
       UPDATE goal_tasks SET status = 'blocked_by_failure', updated_at = ?
       WHERE organization_id = ? AND id IN (SELECT id FROM downstream)
         AND status NOT IN ('completed', 'cancelled', 'failed')`,
    ).run(organizationId, taskId, organizationId, now, organizationId);
  } else if (status !== 'completed') {
    db.prepare(
      `WITH RECURSIVE downstream(id) AS (
         SELECT id FROM goal_tasks WHERE organization_id = ? AND depends_on_task_id = ?
         UNION ALL
         SELECT goal_tasks.id FROM goal_tasks
         JOIN downstream ON goal_tasks.depends_on_task_id = downstream.id
         WHERE goal_tasks.organization_id = ?
       )
       UPDATE goal_tasks SET status = 'blocked', updated_at = ?
       WHERE organization_id = ? AND id IN (SELECT id FROM downstream)
         AND status IN ('pending', 'in_progress')`,
    ).run(organizationId, taskId, organizationId, now, organizationId);
  }
  const row = db.prepare('SELECT * FROM goal_tasks WHERE organization_id = ? AND id = ?').get(
    organizationId,
    taskId,
  ) as Row;
  return toTask(row);
}

export function saveInteractiveQuestion(db: DbHandle, question: InteractiveQuestion): InteractiveQuestion {
  const payload = InteractiveQuestionSchema.parse(question);
  db.prepare(
    `INSERT INTO interactive_questions (
      id, organization_id, channel_id, goal_id, run_id, tool_call_id, question_text, options_json,
      status, selected_option, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      selected_option = excluded.selected_option,
      updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId,
    payload.goalId ?? null,
    payload.runId ?? null,
    payload.toolCallId ?? null,
    payload.questionText,
    JSON.stringify(payload.options),
    payload.status,
    payload.selectedOption ?? null,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getInteractiveQuestion(
  db: DbHandle,
  organizationId: string,
  questionId: string,
): InteractiveQuestion | null {
  const row = db
    .prepare('SELECT * FROM interactive_questions WHERE organization_id = ? AND id = ?')
    .get(organizationId, questionId) as Row | null;
  return row ? toQuestion(row) : null;
}

export function listPendingInteractiveQuestions(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): InteractiveQuestion[] {
  return (db
    .prepare(
      `SELECT * FROM interactive_questions
       WHERE organization_id = ? AND channel_id = ? AND status = 'pending'
       ORDER BY created_at ASC`,
    )
    .all(organizationId, channelId) as Row[]).map(toQuestion);
}

export function listInteractiveQuestionsByRunId(
  db: DbHandle,
  organizationId: string,
  runId: string,
): InteractiveQuestion[] {
  return (db
    .prepare(
      `SELECT * FROM interactive_questions
       WHERE organization_id = ? AND run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(organizationId, runId) as Row[]).map(toQuestion);
}
