import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  approvalWaitFromSteps,
  inputWaitFromSteps,
  mergeInterruptMessages,
  stepPausesRun,
  stepTerminatesRun,
} from './agent-loop.js';

describe('stepTerminatesRun', () => {
  it('stops when the SDK exposes channel.pass as a dynamic call', () => {
    expect(stepTerminatesRun({ dynamicToolCalls: [{ toolName: 'channel.pass' }] })).toBe(true);
  });

  it('stops from the executed pass result even when the SDK omits the tool name', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'passed' } }] })).toBe(true);
  });

  it('does not stop for ordinary tool results', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'ok' } }] })).toBe(false);
  });

  // Fix: tool-name sanitization (underscore → dot normalization).
  // `toModelToolName` converts dots to underscores, so the model
  // may return `channel_reply` / `channel_pass` / etc.
  it('stops for underscored channel_pass in dynamicToolCalls', () => {
    expect(stepTerminatesRun({ dynamicToolCalls: [{ toolName: 'channel_pass' }] })).toBe(true);
  });

  it('stops for acked tool results', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'acked' } }] })).toBe(true);
  });
});

describe('mergeInterruptMessages', () => {
  it('appends interrupts without duplicating when the SDK reuses the same array', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'reply' },
        ],
      },
    ];
    const interrupts: ModelMessage[] = [{ role: 'user', content: 'wait, also do this' }];

    mergeInterruptMessages(messages, messages, interrupts);

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'reply' },
        ],
      },
      { role: 'user', content: 'wait, also do this' },
    ]);
  });

  it('replaces transcript when the SDK passes a fresh array', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'stale' }];
    const nextMessages: ModelMessage[] = [{ role: 'user', content: 'fresh' }];
    const interrupts: ModelMessage[] = [{ role: 'user', content: 'interrupt' }];

    mergeInterruptMessages(messages, nextMessages, interrupts);

    expect(messages).toEqual([
      { role: 'user', content: 'fresh' },
      { role: 'user', content: 'interrupt' },
    ]);
  });
});

describe('approval/input wait detection', () => {
  it('pauses when approval is returned as an SDK result payload', () => {
    const step = {
      staticToolResults: [{ result: { status: 'waiting_for_approval', approvalId: 'approval-2' } }],
    };

    expect(approvalWaitFromSteps([step])).toBe('approval-2');
    expect(stepPausesRun(step)).toBe(true);
  });

  it('pauses when input is returned as a content result payload', () => {
    expect(
      inputWaitFromSteps([
        { content: [{ result: { status: 'waiting_for_input', questionId: 'question-2' } }] },
      ]),
    ).toBe('question-2');
  });
});
