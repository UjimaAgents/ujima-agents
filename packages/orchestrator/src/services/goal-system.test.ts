import { describe, expect, it } from 'vitest';
import { OrganizationSchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  GoalSystemService,
  IMPLEMENT_QUESTION_OPTION,
  IMPLEMENT_QUESTION_TEXT,
} from './goal-system.js';

function bootstrap() {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = 'org-goal-system-test';
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Goal System Test Org',
      workspace: { root: '/tmp/goal-system-test', roleScopes: {} },
    }),
  );
  return { repo, orgId };
}

function startPlan(goals: GoalSystemService, organizationId: string, channelId: string) {
  return goals.start({
    organizationId,
    channelId,
    supervisorId: 'supervisor-1',
    title: 'Ship the thing',
    planMarkdown: '## Plan',
    tasks: [{ title: 'Step 1', assigneeId: 'agent-1' }],
  });
}

function saveRunStep(
  repo: Repository,
  organizationId: string,
  input: {
    runId: string;
    toolId: string;
    status?: 'waiting_for_input' | 'completed';
    output?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();
  repo.saveRun({
    id: input.runId,
    organizationId,
    agentId: 'agent-1',
    threadId: 'thread-1',
    status: input.status ?? 'completed',
    step: input.status ?? 'completed',
    summary: 'run',
    startedAt: now,
  });
  repo.saveRunStep({
    id: `${input.runId}-step`,
    organizationId,
    runId: input.runId,
    threadId: 'thread-1',
    agentId: 'agent-1',
    toolCallId: `${input.runId}-call`,
    toolId: input.toolId,
    action: 'create',
    resourceType: 'goal',
    resourcePath: '',
    input: {},
    output: input.output ?? { status: 'completed' },
    status: 'ok',
    createdAt: now,
  });
  return `${input.runId}-call`;
}

describe('GoalSystemService.answer', () => {
  it('flips the goal from planning to running when the implement option is chosen', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { goal } = startPlan(goals, orgId, 'channel-impl');

    const question = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-impl',
      agentName: 'planner',
    });
    expect(question?.questionText).toBe(IMPLEMENT_QUESTION_TEXT);
    expect(question?.runId).toBeUndefined();
    expect(question?.goalId).toBe(goal.id);

    goals.answer(orgId, question!.id, IMPLEMENT_QUESTION_OPTION);

    expect(repo.getGoal(orgId, goal.id)?.status).toBe('running');
  });

  it('resumes a run-scoped implement prompt after the recommended option is chosen', async () => {
    const { repo, orgId } = bootstrap();
    let resumeCalls = 0;
    const goals = new GoalSystemService(repo, async () => {
      resumeCalls += 1;
    });
    const { goal } = startPlan(goals, orgId, 'channel-run-impl');
    const runId = 'run-impl';
    const toolCallId = saveRunStep(repo, orgId, {
      runId,
      toolId: 'goal.start',
      status: 'waiting_for_input',
    });
    const question = goals.ask({
      organizationId: orgId,
      channelId: 'channel-run-impl',
      goalId: goal.id,
      runId,
      toolCallId,
      questionText: IMPLEMENT_QUESTION_TEXT,
      options: [IMPLEMENT_QUESTION_OPTION, 'Tell planner to do something different'],
    });

    goals.answer(orgId, question.id, IMPLEMENT_QUESTION_OPTION);
    await new Promise((resolve) => setImmediate(resolve));

    expect(repo.getGoal(orgId, goal.id)?.status).toBe('running');
    expect(resumeCalls).toBe(1);
  });

  it('does not start the goal when the user chooses "do something different"', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { goal } = startPlan(goals, orgId, 'channel-redirect');
    const question = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-redirect',
      agentName: 'planner',
    });

    goals.answer(orgId, question!.id, `Tell planner to do something different`);

    expect(repo.getGoal(orgId, goal.id)?.status).toBe('planning');
  });

  it('keeps the run step replayable so the resumed agent sees the chosen option', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo, async () => {
      // resume not exercised in this test
    });
    const runId = 'run-step-rewrite';
    const toolCallId = saveRunStep(repo, orgId, {
      runId,
      toolId: 'question.ask',
      status: 'waiting_for_input',
      output: { status: 'waiting_for_input', questionId: 'question-1' },
    });
    const question = goals.ask({
      organizationId: orgId,
      channelId: 'channel-rewrite',
      runId,
      toolCallId,
      questionText: 'Pick one',
      options: ['Yes (Recommended)', 'No'],
    });

    goals.answer(orgId, question.id, 'Yes (Recommended)');

    const updatedStep = repo
      .listRunSteps(orgId, runId)
      .find((s) => s.toolCallId === toolCallId);
    expect(updatedStep?.output).toEqual({
      status: 'waiting_for_input',
      questionId: 'question-1',
    });
  });

  it('preserves goal.start task ids without finalizing the replayable step', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo, async () => {
      // resume not exercised in this test
    });
    const runId = 'run-goal-output';
    const toolCallId = saveRunStep(repo, orgId, {
      runId,
      toolId: 'goal.start',
      status: 'waiting_for_input',
    });
    const step = repo.listRunSteps(orgId, runId).find((s) => s.toolCallId === toolCallId)!;
    repo.saveRunStep({
      ...step,
      output: {
        status: 'waiting_for_input',
        questionId: 'question-output',
        goal: { id: 'goal-1' },
        tasks: [{ id: 'task-1' }],
      },
    });
    const question = goals.ask({
      organizationId: orgId,
      channelId: 'channel-output',
      goalId: 'goal-1',
      runId,
      toolCallId,
      questionText: IMPLEMENT_QUESTION_TEXT,
      options: [IMPLEMENT_QUESTION_OPTION, 'Tell planner to do something different'],
    });

    goals.answer(orgId, question.id, IMPLEMENT_QUESTION_OPTION);

    const updatedStep = repo.listRunSteps(orgId, runId).find((s) => s.toolCallId === toolCallId);
    expect(updatedStep?.output).toMatchObject({
      status: 'waiting_for_input',
      questionId: 'question-output',
      tasks: [{ id: 'task-1' }],
    });
  });

  it('only resumes a run after every pending question for that run is answered', async () => {
    const { repo, orgId } = bootstrap();
    let resumeCalls = 0;
    const goals = new GoalSystemService(repo, async () => {
      resumeCalls += 1;
    });
    const runId = 'run-multi';
    saveRunStep(repo, orgId, { runId, toolId: 'question.ask', status: 'waiting_for_input' });

    const q1 = goals.ask({
      organizationId: orgId,
      channelId: 'channel-multi',
      runId,
      questionText: 'First?',
      options: ['Yes (Recommended)', 'No'],
    });
    const q2 = goals.ask({
      organizationId: orgId,
      channelId: 'channel-multi',
      runId,
      questionText: 'Second?',
      options: ['Yes (Recommended)', 'No'],
    });

    goals.answer(orgId, q1.id, 'Yes (Recommended)');
    await new Promise((resolve) => setImmediate(resolve));
    expect(resumeCalls).toBe(0);

    goals.answer(orgId, q2.id, 'Yes (Recommended)');
    await new Promise((resolve) => setImmediate(resolve));
    expect(resumeCalls).toBe(1);
  });
});

describe('GoalSystemService.updateTask', () => {
  it('returns created task ids so the agent can update real rows', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);

    const { goal, tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-created-tasks',
      supervisorId: 'supervisor-1',
      title: 'Ship the thing',
      planMarkdown: '## Plan',
      tasks: [
        { title: 'Step 1', assigneeId: 'agent-1' },
        { title: 'Step 2', assigneeId: 'agent-1', dependsOnTaskIndex: 0 },
      ],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toBeTruthy();
    expect(tasks[1]?.dependsOnTaskId).toBe(tasks[0]?.id);
    expect(new Set(repo.listGoalTasks(orgId, goal.id).map((task) => task.id))).toEqual(
      new Set(tasks.map((task) => task.id)),
    );
  });

  it('fails loudly when the agent updates a task that was never created', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);

    expect(() =>
      goals.updateTask({
        organizationId: orgId,
        taskId: 'missing-task',
        status: 'completed',
      }),
    ).toThrow('Goal task not found: missing-task');
  });
});

describe('GoalSystemService.maybePromptImplement', () => {
  it('does nothing when the just-completed run did not call goal.start', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    startPlan(goals, orgId, 'channel-gate');
    const runId = 'run-unrelated';
    saveRunStep(repo, orgId, { runId, toolId: 'message.post' });

    const question = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-gate',
      agentName: 'planner',
      runId,
    });

    expect(question).toBeNull();
  });

  it('prompts when the just-completed run actually authored the plan', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    startPlan(goals, orgId, 'channel-author');
    const runId = 'run-author';
    saveRunStep(repo, orgId, { runId, toolId: 'goal.start' });

    const question = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-author',
      agentName: 'planner',
      runId,
    });

    expect(question?.questionText).toBe(IMPLEMENT_QUESTION_TEXT);
  });
});
