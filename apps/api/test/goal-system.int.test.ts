import { describe, expect, it } from 'vitest';
import { ChannelSchema, OrganizationSchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  GoalSystemService,
  IMPLEMENT_QUESTION_OPTION,
  IMPLEMENT_QUESTION_TEXT,
} from '@ujima/orchestrator';

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

describe('GoalSystemService.start', () => {
  it('keeps multiple goals in the same channel instead of overwriting the previous one', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);

    const first = startPlan(goals, orgId, 'channel-shared');
    const second = goals.start({
      organizationId: orgId,
      channelId: 'channel-shared',
      supervisorId: 'supervisor-2',
      title: 'Ship the other thing',
      planMarkdown: '## Plan 2',
      tasks: [{ title: 'Step 2', assigneeId: 'agent-2' }],
    });

    expect(first.goal.id).not.toBe(second.goal.id);
    expect(repo.listGoalsByChannel(orgId, 'channel-shared').map((goal) => goal.id).sort()).toEqual(
      [first.goal.id, second.goal.id].sort(),
    );
    expect(repo.listGoalTasks(orgId, first.goal.id)).toHaveLength(1);
    expect(repo.listGoalTasks(orgId, second.goal.id)).toHaveLength(1);
  });

  it('keeps agent DM goal assignment single-goal and replaces its task list', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    repo.saveChannel(ChannelSchema.parse({
      id: 'dm:agent-1:agent-2',
      organizationId: orgId,
      name: 'agent DM',
      kind: 'dm',
      topic: '',
      memberIds: ['agent-1', 'agent-2'],
      createdAt: new Date().toISOString(),
    }));

    const first = startPlan(goals, orgId, 'dm:agent-1:agent-2');
    const oldPrompt = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'dm:agent-1:agent-2',
      agentName: 'planner',
    })!;
    const second = goals.start({
      organizationId: orgId,
      channelId: 'dm:agent-1:agent-2',
      supervisorId: 'supervisor-2',
      title: 'Updated DM goal',
      planMarkdown: '## Plan 2',
      tasks: [{ title: 'Replacement step', assigneeId: 'agent-2' }],
    });

    expect(second.goal.id).toBe(first.goal.id);
    expect(second.goal.planVersion).toBe(2);
    expect(repo.listGoalsByChannel(orgId, 'dm:agent-1:agent-2')).toHaveLength(1);
    expect(repo.listGoalTasks(orgId, first.goal.id).map((task) => task.title)).toEqual(['Replacement step']);
    expect(repo.getInteractiveQuestion(orgId, oldPrompt.id)?.status).toBe('superseded');
  });
});

describe('GoalSystemService.maybePromptImplement', () => {
  it('prompts for each planning goal in a channel without superseding the others', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const first = startPlan(goals, orgId, 'channel-many-prompts');
    const second = goals.start({
      organizationId: orgId,
      channelId: 'channel-many-prompts',
      supervisorId: 'supervisor-2',
      title: 'Ship the other thing',
      planMarkdown: '## Plan 2',
      tasks: [{ title: 'Step 2', assigneeId: 'agent-2' }],
    });

    const prompt1 = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-many-prompts',
      agentName: 'planner',
    });
    const prompt2 = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-many-prompts',
      agentName: 'planner',
    });

    expect([prompt1?.goalId, prompt2?.goalId].sort()).toEqual([first.goal.id, second.goal.id].sort());
  });
});

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
      status: 'completed',
      questionId: 'question-1',
      selectedOption: 'Yes (Recommended)',
    });
  });

  it('preserves goal.start task ids while recording the chosen option', () => {
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
      status: 'completed',
      questionId: 'question-output',
      selectedOption: IMPLEMENT_QUESTION_OPTION,
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

  // Supervisor can rename a task without going through goal.start.
  // Plan-edit fields (title/description/assignee_id) require the
  // caller to be the goal's supervisor; status edits do not.
  it('lets the supervisor rename a task and reassign it', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-edit',
      supervisorId: 'supervisor-1',
      title: 'Plan',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Original title', assigneeId: 'agent-a' }],
    });
    const updated = goals.updateTask({
      organizationId: orgId,
      taskId: tasks[0]!.id,
      title: 'Renamed title',
      assigneeId: 'agent-b',
      callerMemberId: 'supervisor-1',
    });
    expect(updated.title).toBe('Renamed title');
    expect(updated.assigneeId).toBe('agent-b');
    expect(updated.status).toBe('pending');
  });

  it('rejects plan-edits from a non-supervisor caller', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-edit-auth',
      supervisorId: 'supervisor-1',
      title: 'Plan',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Original', assigneeId: 'agent-a' }],
    });
    expect(() =>
      goals.updateTask({
        organizationId: orgId,
        taskId: tasks[0]!.id,
        title: 'Hijack',
        callerMemberId: 'agent-a',
      }),
    ).toThrow(/Only the goal supervisor/);
  });

  // Regression: callerMemberId must be REQUIRED when editing the
  // plan, not opt-in. The previous shape `if (callerMemberId && ...)`
  // short-circuited the check when callerMemberId was omitted, so
  // any caller could rewrite another user's task definition.
  it('rejects plan-edits when callerMemberId is missing', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-edit-anon',
      supervisorId: 'supervisor-1',
      title: 'Plan',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Original', assigneeId: 'agent-a' }],
    });
    expect(() =>
      goals.updateTask({
        organizationId: orgId,
        taskId: tasks[0]!.id,
        title: 'Anon hijack',
        // callerMemberId intentionally omitted
      }),
    ).toThrow(/callerMemberId is required/);
  });

  // Regression: a single call that combines plan edits +
  // handoverSummary must persist BOTH. Pre-fix the
  // `if (handoverSummary && !editsPlan)` branch swallowed the note
  // whenever the same call also rewrote title/description/assignee.
  it('persists handoverSummary on the same call as a plan edit', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-edit-handover',
      supervisorId: 'supervisor-1',
      title: 'Plan',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Original', assigneeId: 'agent-a' }],
    });
    const updated = goals.updateTask({
      organizationId: orgId,
      taskId: tasks[0]!.id,
      title: 'Renamed',
      handoverSummary: 'Why the rename matters',
      callerMemberId: 'supervisor-1',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.handoverSummary).toBe('Why the rename matters');
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

  // Replaces the deleted commitment-sweeper hand-off behaviour.
  // When Task A completes, every PENDING task whose
  // depends_on_task_id was A must get a single DM nudge @-mentioning
  // its assignee.
  it('nudges the dependent task assignee when a blocking task completes', () => {
    const { repo, orgId } = bootstrap();
    const posts: { recipientId: string; senderId: string; content: string; mentions?: string[] }[] = [];
    const conversations = {
      sendDirectMessage: (args: {
        organizationId: string;
        senderId: string;
        recipientId: string;
        content: string;
        mentions?: string[];
      }) => {
        posts.push({
          recipientId: args.recipientId,
          senderId: args.senderId,
          content: args.content,
          mentions: args.mentions,
        });
        return undefined as never;
      },
    };
    const goals = new GoalSystemService(repo, undefined, conversations as never);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-handoff',
      supervisorId: 'supervisor-1',
      title: 'Two-step',
      planMarkdown: '## Plan',
      tasks: [
        { title: 'Step 1', assigneeId: 'agent-a' },
        { title: 'Step 2', assigneeId: 'agent-b', dependsOnTaskIndex: 0 },
      ],
    });

    goals.updateTask({
      organizationId: orgId,
      taskId: tasks[0]!.id,
      status: 'completed',
      handoverSummary: 'Step 1 done; Step 2 inputs ready.',
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.recipientId).toBe('agent-b');
    expect(posts[0]?.senderId).toBe('supervisor-1');
    expect(posts[0]?.mentions).toEqual(['agent-b']);
    expect(posts[0]?.content).toContain('Step 2');
    expect(posts[0]?.content).toContain('unblocked');
  });

  // sweepAllPendingTasks must also poke in-progress tasks that
  // have gone stale, BUT skip when the assignee has an active run
  // (the "is the agent still working?" guard). Without the guard
  // we'd interrupt agents mid-tool-call.
  it('sweep nudges stalled in-progress tasks but skips when assignee has an active run', () => {
    const { repo, orgId } = bootstrap();
    const posts: { content: string }[] = [];
    const conversations = {
      sendDirectMessage: (args: { content: string }) => {
        posts.push({ content: args.content });
        return undefined as never;
      },
    };
    const goals = new GoalSystemService(repo, undefined, conversations as never);
    const { tasks, goal } = goals.start({
      organizationId: orgId,
      channelId: 'channel-stalled',
      supervisorId: 'supervisor-1',
      title: 'Solo',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Step 1', assigneeId: 'agent-a' }],
    });
    // Flip the (only) task to in_progress and backdate updated_at
    // past the IN_PROGRESS idle threshold so the sweep will consider
    // it stalled. saveGoalTask round-trips updated_at.
    const t = tasks[0]!;
    const stalledAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    repo.saveGoalTask({ ...t, status: 'in_progress', updatedAt: stalledAt });
    // Mark the goal running so the sweep enters it.
    repo.saveGoal({ ...goal, status: 'running', updatedAt: stalledAt });

    // First sweep: no active run → must nudge.
    goals.sweepAllPendingTasks();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.content).toContain('in progress with no update');

    // Reset dedup so the next sweep can fire, then add an active
    // run for the assignee — must NOT nudge.
    (goals as unknown as { lastNudgedAt: Map<string, number> }).lastNudgedAt.clear();
    repo.saveRun({
      id: 'active-run-1',
      organizationId: orgId,
      agentId: 'agent-a',
      threadId: 'channel-stalled',
      status: 'running',
      step: 'running',
      summary: 'working',
      startedAt: new Date().toISOString(),
    });
    goals.sweepAllPendingTasks();
    expect(posts).toHaveLength(1);
  });

  // Dedup guard: a second completion that would re-target the
  // same task within the dedup window must be a no-op. Without
  // this, a goal whose task gets re-completed (e.g. a status
  // toggle in the UI) would spam every dependent assignee.
  it('does not re-nudge the same dependent within the dedup window', () => {
    const { repo, orgId } = bootstrap();
    const posts: unknown[] = [];
    const conversations = {
      sendDirectMessage: () => {
        posts.push(true);
        return undefined as never;
      },
    };
    const goals = new GoalSystemService(repo, undefined, conversations as never);
    const { tasks } = goals.start({
      organizationId: orgId,
      channelId: 'channel-dedup',
      supervisorId: 'supervisor-1',
      title: 'Two-step',
      planMarkdown: '## Plan',
      tasks: [
        { title: 'Step 1', assigneeId: 'agent-a' },
        { title: 'Step 2', assigneeId: 'agent-b', dependsOnTaskIndex: 0 },
      ],
    });
    goals.updateTask({
      organizationId: orgId,
      taskId: tasks[0]!.id,
      status: 'completed',
      handoverSummary: 'Step 1 done; Step 2 inputs ready.',
    });
    goals.updateTask({
      organizationId: orgId,
      taskId: tasks[0]!.id,
      status: 'completed',
      handoverSummary: 'Step 1 done; Step 2 inputs ready.',
    });
    expect(posts).toHaveLength(1);
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
