import { describe, expect, it } from 'vitest';
import { goalStartTool, questionAskTool } from './goal.js';

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

  it('keeps created task ids when replaying after implement approval', () => {
    const result = goalStartTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
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
        listInteractiveQuestionsByRunId: () => [
          {
            status: 'answered',
            selectedOption: 'Yes, implement (Recommended)',
            toolCallId: 'call-1',
            questionText: 'Do you want me to implement?',
          },
        ],
        listRunSteps: () => [
          {
            toolCallId: 'call-1',
            output: {
              status: 'waiting_for_input',
              questionId: 'question-1',
              tasks: [{ id: 'task-1', title: 'Task one' }],
            },
          },
        ],
      } as never,
      goals: {} as never,
    } as never);

    expect(result).toMatchObject({
      status: 'completed',
      selectedOption: 'Yes, implement (Recommended)',
      tasks: [{ id: 'task-1' }],
    });
    // Regression guard: the resumed-after-answer shape must NOT
    // leak `questionId` from the prior waiting_for_input step. The
    // model interpreted that dangling field as "tool still wants
    // input" and hallucinated an "interactive user input required"
    // error in chat (see goal.ts:70-94 for the fix rationale).
    expect((result as Record<string, unknown>).questionId).toBeUndefined();
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

  it('replays an answered question with the selected option', () => {
    const result = questionAskTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-2',
        memberId: 'carter-jordan',
        toolCallId: 'call-2',
        toolId: 'question.ask',
        action: 'create',
        resourceType: 'question',
        input: {
          question_text: 'Pick one',
          options: ['Yes (Recommended)', 'No'],
        },
        threadId: 'thread-1',
      } as never,
      repo: {
        getThread: () => ({ channelId: 'dm:carter-jordan:owner' }),
        listInteractiveQuestionsByRunId: () => [
          {
            status: 'answered',
            selectedOption: 'Yes (Recommended)',
            toolCallId: 'call-2',
          },
        ],
        listRunSteps: () => [
          {
            toolCallId: 'call-2',
            output: {
              status: 'waiting_for_input',
              questionId: 'question-2',
            },
          },
        ],
      } as never,
      goals: {} as never,
    } as never);

    expect(result).toEqual({
      status: 'completed',
      selectedOption: 'Yes (Recommended)',
    });
  });
});
