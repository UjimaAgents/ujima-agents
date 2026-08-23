import { describe, expect, it } from 'vitest';
import { GoalSystemService } from '../services/goal-system.js';
import { goalModeTool, goalStartTool } from './goal.js';

describe('goal.start', () => {
  it('creates tasks and pauses for implement approval before execution continues', () => {
    const savedRuns: unknown[] = [];
    const result = goalStartTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'carter-jordan',
        toolCallId: 'call-1',
        toolId: 'goal.start',
        action: 'create',
        resourceType: 'goal',
        input: {
          title: 'Plan',
          plan_markdown: '## Plan',
          tasks: [{ title: 'Task one', assignee_id: 'carter-jordan' }],
        },
        threadId: 'thread-1',
      } as never,
      repo: {
        getThread: () => ({ channelId: 'dm:carter-jordan:owner' }),
        getChannel: () => ({ kind: 'dm' }),
        getGoalByChannel: () => null,
        listInteractiveQuestionsByRunId: () => [],
        listRunSteps: () => [],
        getMember: () => ({ name: 'Carter Jordan' }),
        getRun: () => ({
          id: 'run-1',
          organizationId: 'org-1',
          agentId: 'carter-jordan',
          threadId: 'thread-1',
          status: 'running',
          step: 'running',
          startedAt: 'now',
        }),
        saveRun: (run: unknown) => {
          savedRuns.push(run);
          return run;
        },
      } as never,
      goals: {
        start: () => ({
          goal: { id: 'goal-1', channelId: 'dm:carter-jordan:owner' },
          tasks: [{ id: 'task-1', title: 'Task one' }],
        }),
        ask: () => ({ id: 'question-1', questionText: 'Do you want me to implement?' }),
      } as never,
    } as never);

    expect(result).toMatchObject({
      status: 'waiting_for_input',
      questionId: 'question-1',
      tasks: [{ id: 'task-1' }],
    });
    expect(savedRuns[0]).toMatchObject({
      status: 'waiting_for_input',
      step: 'waiting_for_input',
      summary: 'Do you want me to implement?',
    });
  });

  it('reuses an already-running DM goal without asking again', () => {
    let starts = 0;
    let questions = 0;
    const result = goalStartTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-2',
        memberId: 'carter-jordan',
        toolCallId: 'call-2',
        toolId: 'goal.start',
        action: 'create',
        resourceType: 'goal',
        input: {
          title: 'Plan',
          plan_markdown: '## Plan',
          tasks: [{ title: 'Task one', assignee_id: 'carter-jordan' }],
        },
        threadId: 'thread-1',
      } as never,
      repo: {
        getThread: () => ({ channelId: 'dm:carter-jordan:owner' }),
        getChannel: () => ({ kind: 'dm' }),
        getGoalByChannel: () => ({
          id: 'goal-1',
          status: 'running',
          channelId: 'dm:carter-jordan:owner',
        }),
        listGoalTasks: () => [{ id: 'task-1', title: 'Task one' }],
        listInteractiveQuestionsByRunId: () => [],
      } as never,
      goals: {
        start: () => {
          starts += 1;
        },
        ask: () => {
          questions += 1;
        },
      } as never,
    } as never);

    expect(result).toMatchObject({
      status: 'completed',
      selectedOption: 'Yes, implement (Recommended)',
      goal: { id: 'goal-1' },
      tasks: [{ id: 'task-1' }],
    });
    expect(starts).toBe(0);
    expect(questions).toBe(0);
  });

});

describe('goal.mode', () => {
  const baseCtx = {
    invocation: {
      organizationId: 'org-1',
      memberId: 'agent-1',
      toolCallId: 'call-1',
      toolId: 'goal.mode',
      threadId: 'thread-1',
    },
    repo: {
      getThread: () => ({ channelId: 'dm:agent-1:owner' }),
      getChannel: () => ({ kind: 'dm' }),
    },
  };

  it('create passes title + description to the service', () => {
    let created: Record<string, unknown> | undefined;
    const result = goalModeTool.execute({
      ...baseCtx,
      invocation: { ...baseCtx.invocation, action: 'create', resourceType: 'goal', input: {
        action: 'create',
        title: 'Ship the exporter',
        description: 'Export every workspace to CSV.',
      } },
      goals: {
        create: (input: Record<string, unknown>) => {
          created = input;
          return { id: 'goal-9', status: 'planning' };
        },
      },
    } as never);

    expect(result).toMatchObject({ status: 'completed', action: 'create', goal: { id: 'goal-9' } });
    expect(created).toMatchObject({
      organizationId: 'org-1',
      channelId: 'dm:agent-1:owner',
      supervisorId: 'agent-1',
      title: 'Ship the exporter',
      description: 'Export every workspace to CSV.',
    });
  });

  it('resume resolves the channel goal and only un-suspends', () => {
    const result = goalModeTool.execute({
      ...baseCtx,
      invocation: { ...baseCtx.invocation, action: 'update', resourceType: 'goal', input: {
        action: 'resume',
      } },
      repo: {
        ...baseCtx.repo,
        getGoalByChannel: () => ({ id: 'goal-7', status: 'suspended' }),
      },
      goals: {
        resume: () => ({ id: 'goal-7', status: 'running' }),
      },
    } as never);

    expect(result).toMatchObject({
      status: 'completed',
      action: 'resume',
      goal: { id: 'goal-7', status: 'running' },
    });
  });

  it('pause and stop resolve the channel goal when no goal_id is given', () => {
    const paused = goalModeTool.execute({
      ...baseCtx,
      invocation: { ...baseCtx.invocation, action: 'update', resourceType: 'goal', input: {
        action: 'pause',
      } },
      repo: {
        ...baseCtx.repo,
        getGoalByChannel: () => ({ id: 'goal-7', status: 'running' }),
      },
      goals: { pause: () => ({ id: 'goal-7', status: 'suspended' }) },
    } as never);
    expect(paused).toMatchObject({ status: 'completed', action: 'pause', goal: { status: 'suspended' } });

    const stopped = goalModeTool.execute({
      ...baseCtx,
      invocation: { ...baseCtx.invocation, action: 'update', resourceType: 'goal', input: {
        action: 'stop',
        goal_id: 'goal-explicit',
      } },
      repo: {
        ...baseCtx.repo,
        getGoal: () => ({ id: 'goal-explicit', status: 'running' }),
      },
      goals: { stop: () => ({ id: 'goal-explicit', status: 'cancelled' }) },
    } as never);
    expect(stopped).toMatchObject({ status: 'completed', action: 'stop', goal: { status: 'cancelled' } });
  });

  it('throws a guiding error when no goal exists', () => {
    expect(() =>
      goalModeTool.execute({
        ...baseCtx,
        invocation: { ...baseCtx.invocation, action: 'update', resourceType: 'goal', input: {
          action: 'stop',
        } },
        repo: { ...baseCtx.repo, getGoalByChannel: () => null },
        goals: {},
      } as never),
    ).toThrow(/action "create" first/);
  });
});

describe('GoalSystemService lifecycle', () => {
  function makeRepo(initialGoals: Record<string, Record<string, unknown>> = {}) {
    const goals = new Map(Object.entries(initialGoals));
    const calls: string[] = [];
    return {
      calls,
      transaction: <T>(fn: () => T): T => fn(),
      getChannel: () => ({ kind: 'dm' }),
      getGoalByChannel: (_org: string, channelId: string) =>
        [...goals.values()].find((goal) => (goal as Record<string, unknown>).channelId === channelId) ?? null,
      listPendingInteractiveQuestions: () => [],
      deleteGoalTasks: (org: string, goalId: string) => calls.push(`deleteTasks:${goalId}`),
      saveInteractiveQuestion: (q: unknown) => q,
      saveGoal: (goal: Record<string, unknown>) => {
        goals.set(goal.id as string, goal);
        return goal;
      },
      getGoal: (_org: string, goalId: string) => goals.get(goalId) ?? null,
      state: goals,
    };
  }

  const baseGoal = {
    id: 'goal-1',
    organizationId: 'org-1',
    channelId: 'dm:x:y',
    title: 'Old',
    status: 'suspended',
    supervisorId: 'agent-1',
    planMarkdown: '',
    planVersion: 2,
    createdAt: 't0',
    updatedAt: 't0',
  };

  it('create resets a non-running goal in place', () => {
    const repo = makeRepo({ 'goal-1': { ...baseGoal } });
    const service = new GoalSystemService(repo as never);
    const goal = service.create({
      organizationId: 'org-1',
      channelId: 'dm:x:y',
      supervisorId: 'agent-1',
      title: 'New title',
      description: 'Fresh description.',
    });
    expect(goal).toMatchObject({ id: 'goal-1', status: 'planning', title: 'New title', planMarkdown: 'Fresh description.' });
    expect(repo.calls).toEqual(['deleteTasks:goal-1']);
  });

  it('create refuses to clobber a running goal', () => {
    const repo = makeRepo({ 'goal-1': { ...baseGoal, status: 'running' } });
    const service = new GoalSystemService(repo as never);
    expect(() =>
      service.create({
        organizationId: 'org-1',
        channelId: 'dm:x:y',
        supervisorId: 'agent-1',
        title: 'Another',
        description: 'Nope.',
      }),
    ).toThrow(/already running/);
  });

  it('pause moves planning/running → suspended and rejects terminal states', () => {
    const repo = makeRepo({ 'goal-1': { ...baseGoal, status: 'running' } });
    const service = new GoalSystemService(repo as never);
    expect(service.pause('org-1', 'goal-1')).toMatchObject({ status: 'suspended' });
    expect(() => service.pause('org-1', 'goal-1')).toThrow(/Cannot move goal from "suspended"/);
  });

  it('resume only un-suspends — planning goals must go through the approval gate', () => {
    const repo = makeRepo({ 'goal-1': { ...baseGoal, status: 'planning' } });
    const service = new GoalSystemService(repo as never);
    expect(() => service.resume('org-1', 'goal-1')).toThrow(/Cannot move goal from "planning"/);
    repo.state.set('goal-1', { ...baseGoal, status: 'suspended' });
    expect(service.resume('org-1', 'goal-1')).toMatchObject({ status: 'running' });
  });

  it('stop cancels and is idempotent for terminal goals', () => {
    const repo = makeRepo({ 'goal-1': { ...baseGoal, status: 'running' } });
    const service = new GoalSystemService(repo as never);
    expect(service.stop('org-1', 'goal-1')).toMatchObject({ status: 'cancelled' });
    expect(service.stop('org-1', 'goal-1')).toMatchObject({ status: 'cancelled' });
    repo.state.set('goal-2', { ...baseGoal, id: 'goal-2', status: 'completed' });
    expect(service.stop('org-1', 'goal-2')).toMatchObject({ status: 'completed' });
  });
});
