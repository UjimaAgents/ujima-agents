import { describe, expect, it } from 'vitest';
import type { Message, RunStep } from '@ujima/shared';
import { buildPromptMessages } from './prompt-assembly.js';

describe('buildPromptMessages', () => {
  it('keeps transcript chronological and puts current request last', () => {
    const historyMessages: Message[] = [
      {
        id: 'human-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'human-1',
        senderKind: 'human',
        kind: 'human',
        content: 'first',
        mentions: [],
        toolCalls: [],
        attachments: [],
        createdAt: '2026-06-07T00:00:00.000Z',
      },
      {
        id: 'agent-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: 'second',
        mentions: [],
        toolCalls: [],
        attachments: [],
        createdAt: '2026-06-07T00:00:02.000Z',
      },
    ];
    const runSteps: RunStep[] = [
      {
        id: 'step-b',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-b',
        toolId: 'view',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'b.txt',
        input: { path: 'b.txt' },
        output: { content: 'b' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:01.500Z',
      },
      {
        id: 'step-a',
        organizationId: 'org-1',
        runId: 'run-1',
        agentId: 'agent-1',
        toolCallId: 'call-a',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '',
        input: { command: 'pwd' },
        output: { stdout: '/tmp\n' },
        status: 'ok',
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];
    const currentRequest: Message = {
      id: 'human-2',
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'human-2',
      senderKind: 'human',
      kind: 'human',
      content: 'latest',
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt: '2026-06-07T00:00:03.000Z',
    };

    const out = buildPromptMessages({
      historyMessages,
      currentMemberId: 'agent-1',
      runSteps,
      contextMessages: [{ role: 'user', content: 'context' }],
      currentRequestMessage: currentRequest,
    });

    expect(out.at(-2)).toEqual({ role: 'user', content: 'context' });
    expect(out.at(-1)).toEqual({ role: 'user', content: 'latest' });
    expect(out.findIndex((message) => message.role === 'assistant' && Array.isArray(message.content) && message.content[0]?.type === 'tool-call' && message.content[0]?.toolCallId === 'call-a')).toBeLessThan(
      out.findIndex((message) => message.role === 'assistant' && Array.isArray(message.content) && message.content[0]?.type === 'tool-call' && message.content[0]?.toolCallId === 'call-b'),
    );
  });

  it('keeps the persisted transcript prefix stable across wake contexts', () => {
    const base: Message = {
      id: 'human-1',
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'human-1',
      senderKind: 'human',
      kind: 'human',
      content: 'first',
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt: '2026-06-07T00:00:00.000Z',
    };
    const priorRequest: Message = {
      ...base,
      id: 'human-2',
      content: 'fix it',
      createdAt: '2026-06-07T00:00:01.000Z',
    };
    const toolReply: Message = {
      ...base,
      id: 'agent-1',
      senderId: 'agent-1',
      senderKind: 'agent',
      kind: 'agent',
      content: 'checking',
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'shell',
          args: { command: 'pwd' },
          result: { stdout: '/tmp\n' },
          isError: false,
        },
      ],
      createdAt: '2026-06-07T00:00:02.000Z',
    };
    const requestA: Message = {
      ...base,
      id: 'human-3',
      content: 'again',
      createdAt: '2026-06-07T00:00:03.000Z',
    };
    const requestB: Message = {
      ...base,
      id: 'human-4',
      content: 'one more',
      createdAt: '2026-06-07T00:00:05.000Z',
    };

    const wakeA = buildPromptMessages({
      historyMessages: [base, priorRequest, toolReply],
      currentMemberId: 'agent-1',
      currentRequestMessage: requestA,
      contextMessages: [{ role: 'user', content: '<wake-context>one</wake-context>' }],
    });
    const wakeB = buildPromptMessages({
      historyMessages: [base, priorRequest, toolReply],
      currentMemberId: 'agent-1',
      currentRequestMessage: requestB,
      contextMessages: [{ role: 'user', content: '<wake-context>two</wake-context>' }],
    });

    expect(wakeB.slice(0, 4)).toEqual(wakeA.slice(0, 4));
    expect(wakeB[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'checking' }, { type: 'tool-call', toolCallId: 'call-1' }],
    });
    expect(wakeB[3]).toMatchObject({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call-1' }],
    });
    expect(wakeA.at(-1)).toEqual({ role: 'user', content: 'again' });
    expect(wakeB.at(-1)).toEqual({ role: 'user', content: 'one more' });
  });
});
