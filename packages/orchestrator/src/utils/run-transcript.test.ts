import { describe, expect, it } from 'vitest';
import type { Message, RunStep } from '@ujima/shared';
import { appendMissingRunStepMessages, runStepsToModelMessages } from './run-transcript.js';

describe('runStepsToModelMessages', () => {
  it('emits assistant tool-call and tool result pairs in step order', () => {
    const steps: RunStep[] = [
      {
        id: 'step-1',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '',
        input: { command: 'pwd' },
        output: { stdout: '/tmp\n' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
      {
        id: 'step-2',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-2',
        toolId: 'view',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'README.md',
        input: { path: 'README.md' },
        output: { content: '# Hi' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];

    expect(runStepsToModelMessages(steps)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'shell',
            input: { command: 'pwd' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'shell',
            output: { type: 'json', value: { stdout: '/tmp\n' } },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'view',
            input: { path: 'README.md' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'view',
            output: { type: 'json', value: { content: '# Hi' } },
          },
        ],
      },
    ]);
  });
});

describe('appendMissingRunStepMessages', () => {
  it('skips steps already represented in thread tool calls', () => {
    const threadMessages: Message[] = [
      {
        id: 'agent-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: 'done',
        mentions: [],
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'shell',
            args: { command: 'pwd' },
            result: { stdout: '/tmp\n' },
            isError: false,
          },
        ],
        attachments: [],
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    ];
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const steps: RunStep[] = [
      {
        id: 'step-1',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '',
        input: { command: 'pwd' },
        output: { stdout: '/tmp\n' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:00.000Z',
      },
      {
        id: 'step-2',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-2',
        toolId: 'view',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'README.md',
        input: { path: 'README.md' },
        output: { content: '# Hi' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];

    appendMissingRunStepMessages(messages, threadMessages, steps);

    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-2' }],
    });
  });
});
