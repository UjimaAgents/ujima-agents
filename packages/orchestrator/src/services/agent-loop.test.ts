import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  approvalWaitFromSteps,
  mergeInterruptMessages,
  stepHasFinalText,
  stepPausesRun,
  stepTerminatesRun,
} from './agent-loop.js';

describe('stepTerminatesRun', () => {
  it('stops when the SDK exposes channel.pass as a dynamic call', () => {
    expect(stepTerminatesRun({ dynamicToolCalls: [{ toolName: 'channel.pass' }] })).toBe(true);
  });

  it('does not stop for ordinary tool results', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'ok' } }] })).toBe(false);
  });

  // Fix: tool-name sanitization (underscore → dot normalization).
  // `toModelToolName` converts dots to underscores, so the model
  // may return `channel_reply` / `channel_pass` / etc.
});

describe('stepHasFinalText', () => {
  it('treats text-only steps as terminal', () => {
    expect(stepHasFinalText({ text: 'Done.' })).toBe(true);
  });

  it('does not treat text plus pending tool calls as terminal', () => {
    expect(stepHasFinalText({ text: 'Checking.', toolCalls: [{ toolName: 'grep' }] })).toBe(false);
  });

  it('allows provider-executed tool records with final text', () => {
    expect(
      stepHasFinalText({
        text: 'Done.',
        content: [{ type: 'tool-call', toolName: 'edit', providerExecuted: true }],
      }),
    ).toBe(true);
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

});

describe('approval/input wait detection', () => {
  it('pauses when approval is returned as an SDK result payload', () => {
    const step = {
      staticToolResults: [{ result: { status: 'waiting_for_approval', approvalId: 'approval-2' } }],
    };

    expect(approvalWaitFromSteps([step])).toBe('approval-2');
    expect(stepPausesRun(step)).toBe(true);
  });

});
