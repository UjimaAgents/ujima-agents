import { describe, expect, it } from 'vitest';
import {
  appendGoalTaskToolCalls,
  buildGoalBoardCreatedCard,
  buildGoalTaskUpdatedCard,
} from './goal-task-card.js';

describe('goal-task-card', () => {
  it('builds a goal board card from goal.start output', () => {
    const card = buildGoalBoardCreatedCard({
      goal: {
        id: 'goal-1',
        organizationId: 'org-1',
        channelId: 'channel-1',
        title: 'Ship feature',
        status: 'planning',
        supervisorId: 'supervisor-1',
        planMarkdown: '',
        planVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      tasks: [
        {
          id: 'task-1',
          organizationId: 'org-1',
          goalId: 'goal-1',
          title: 'Implement API',
          description: '',
          status: 'pending',
          assigneeId: 'agent-1',
          createdBy: 'supervisor-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(card?.kind).toBe('goal.board.created');
    expect(card?.goalTitle).toBe('Ship feature');
    expect(card?.tasks).toHaveLength(1);
  });

  it('builds a task updated card when status changes', () => {
    const card = buildGoalTaskUpdatedCard({
      id: 'task-1',
      organizationId: 'org-1',
      goalId: 'goal-1',
      title: 'Implement API',
      description: '',
      status: 'in_progress',
      assigneeId: 'agent-1',
      createdBy: 'supervisor-1',
      previousStatus: 'pending',
      handoverSummary: 'Starting work',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(card?.kind).toBe('goal.task.updated');
    expect(card?.previousStatus).toBe('pending');
    expect(card?.status).toBe('in_progress');
    expect(card?.handoverSummary).toBe('Starting work');
  });

  it('skips task updated cards when status did not change', () => {
    const card = buildGoalTaskUpdatedCard({
      id: 'task-1',
      organizationId: 'org-1',
      goalId: 'goal-1',
      title: 'Implement API',
      description: '',
      status: 'pending',
      assigneeId: 'agent-1',
      createdBy: 'supervisor-1',
      previousStatus: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(card).toBeUndefined();
  });

  it('appends cards for goal tool calls in a step', () => {
    const cards = appendGoalTaskToolCalls(
      [
        { toolCallId: 'call-1', toolName: 'goal.start', args: {} },
        { toolCallId: 'call-2', toolName: 'goal.task.update', args: {} },
      ],
      [
        {
          toolCallId: 'call-1',
          output: {
            goal: {
              id: 'goal-1',
              organizationId: 'org-1',
              channelId: 'channel-1',
              title: 'Ship feature',
              status: 'planning',
              supervisorId: 'supervisor-1',
              planMarkdown: '',
              planVersion: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            tasks: [
              {
                id: 'task-1',
                organizationId: 'org-1',
                goalId: 'goal-1',
                title: 'Implement API',
                description: '',
                status: 'pending',
                assigneeId: 'agent-1',
                createdBy: 'supervisor-1',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        },
        {
          toolCallId: 'call-2',
          output: {
            id: 'task-1',
            organizationId: 'org-1',
            goalId: 'goal-1',
            title: 'Implement API',
            description: '',
            status: 'completed',
            assigneeId: 'agent-1',
            createdBy: 'supervisor-1',
            previousStatus: 'in_progress',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    );

    expect(cards).toHaveLength(2);
    expect(cards[0]?.toolName).toBe('card.goal.board.created');
    expect(cards[1]?.toolName).toBe('card.goal.task.updated');
  });
});
