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

describe('GoalSystemService.answer', () => {
  it('flips the goal from planning to running when the implement option is chosen', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const goal = goals.start({
      organizationId: orgId,
      channelId: 'channel-impl',
      supervisorId: 'supervisor-1',
      title: 'Ship the thing',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Step 1', assigneeId: 'agent-1' }],
    });

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

  it('does not start the goal when the user chooses "do something different"', () => {
    const { repo, orgId } = bootstrap();
    const goals = new GoalSystemService(repo);
    const goal = goals.start({
      organizationId: orgId,
      channelId: 'channel-redirect',
      supervisorId: 'supervisor-1',
      title: 'Ship the thing',
      planMarkdown: '## Plan',
      tasks: [{ title: 'Step 1', assigneeId: 'agent-1' }],
    });
    const question = goals.maybePromptImplement({
      organizationId: orgId,
      channelId: 'channel-redirect',
      agentName: 'planner',
    });

    goals.answer(orgId, question!.id, `Tell planner to do something different`);

    expect(repo.getGoal(orgId, goal.id)?.status).toBe('planning');
  });

  it('only resumes a run after every pending question for that run is answered', async () => {
    const { repo, orgId } = bootstrap();
    let resumeCalls = 0;
    const goals = new GoalSystemService(repo, async () => {
      resumeCalls += 1;
    });

    const runId = 'run-multi';
    const now = new Date().toISOString();
    repo.saveRun({
      id: runId,
      organizationId: orgId,
      agentId: 'agent-1',
      threadId: 'thread-1',
      status: 'waiting_for_input',
      step: 'waiting_for_input',
      summary: 'q1',
      startedAt: now,
    });

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
