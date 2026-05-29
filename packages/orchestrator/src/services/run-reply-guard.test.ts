import { describe, expect, it } from 'vitest';
import {
  RUN_TERMINATING_TOOL_NAMES,
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  isAcknowledgementOnly,
  runUsedChannelPass,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';

describe('isAcknowledgementOnly', () => {
  it('matches only a bare acknowledgement', () => {
    expect(isAcknowledgementOnly('Acknowledged.')).toBe(true);
    expect(isAcknowledgementOnly('Acknowledged. Holding.')).toBe(false);
  });
});

describe('runUsedThreadPublishingTool', () => {
  it('returns true when toolResults include channel.dm', () => {
    expect(
      runUsedThreadPublishingTool({
        text: 'Done.',
        toolResults: [{ toolName: 'channel.dm', output: {} }],
        steps: [],
      }),
    ).toBe(true);
  });

  it('returns true when a step has channel.reply toolCalls', () => {
    expect(
      runUsedThreadPublishingTool({
        text: 'Ack',
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'channel.reply' }] }],
      }),
    ).toBe(true);
  });

  it('returns false when only non-thread tools ran', () => {
    expect(
      runUsedThreadPublishingTool({
        text: 'Done.',
        toolResults: [{ toolName: 'shell', output: {} }],
        steps: [],
      }),
    ).toBe(false);
  });
});

describe('RUN_TERMINATING_TOOL_NAMES (renamed from THREAD_PUBLISHING_TOOL_NAMES)', () => {
  it('includes channel.pass and channel.handoff', () => {
    // Loophole fix L1 — the new silent / handoff terminators must
    // be in the set so the agent-loop stops on them and the run-
    // loop branches correctly in run.ts.
    expect(RUN_TERMINATING_TOOL_NAMES.has('channel.pass')).toBe(true);
    expect(RUN_TERMINATING_TOOL_NAMES.has('channel.handoff')).toBe(true);
  });
});

describe('findTerminatingTool', () => {
  it('returns null when no terminating tool fired', () => {
    expect(
      findTerminatingTool({
        text: '',
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'filesystem' }] }],
      }),
    ).toBeNull();
  });

  it('returns channel.pass when only channel.pass fired', () => {
    expect(
      findTerminatingTool({
        text: '',
        toolResults: [],
        steps: [
          { toolCalls: [{ toolName: 'channel.pass' }] },
        ],
      }),
    ).toBe('channel.pass');
  });
});

describe('findTerminatingToolFromRunSteps', () => {
  it('recognizes a persisted successful channel.reply step', () => {
    expect(
      findTerminatingToolFromRunSteps([
        { toolId: 'channel.reply', status: 'ok' },
      ]),
    ).toBe('channel.reply');
  });

  it('ignores blocked persisted terminating steps', () => {
    expect(
      findTerminatingToolFromRunSteps([
        { toolId: 'channel.reply', status: 'blocked' },
      ]),
    ).toBeNull();
  });
});

describe('runUsedChannelPass', () => {
  it('detects a pass call', () => {
    expect(
      runUsedChannelPass({
        text: '',
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'channel.pass' }] }],
      }),
    ).toBe(true);
  });

  it('returns false when only channel.reply fired', () => {
    expect(
      runUsedChannelPass({
        text: '',
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'channel.reply' }] }],
      }),
    ).toBe(false);
  });
});

// B6 — when a model emits multiple terminating tools in one step
// (e.g. channel.reply + channel.pass), the order Set iteration
// returns them is implementation-defined. Precedence pins the
// outcome so run.ts always reaches the same branch.
describe('findTerminatingTool precedence (B6)', () => {
  it('picks the posting tool when channel.reply AND channel.pass both fire', () => {
    expect(
      findTerminatingTool({
        steps: [
          {
            toolCalls: [
              { toolName: 'channel.pass' },
              { toolName: 'channel.reply' },
            ],
          },
        ],
        toolResults: [],
      }),
    ).toBe('channel.reply');
  });

  it('picks channel.handoff over channel.pass', () => {
    expect(
      findTerminatingTool({
        steps: [
          {
            toolCalls: [
              { toolName: 'channel.pass' },
              { toolName: 'channel.handoff' },
            ],
          },
        ],
        toolResults: [],
      }),
    ).toBe('channel.handoff');
  });

  it('picks message over channel.handoff', () => {
    expect(
      findTerminatingTool({
        steps: [
          {
            toolCalls: [
              { toolName: 'channel.handoff' },
              { toolName: 'message' },
            ],
          },
        ],
        toolResults: [],
      }),
    ).toBe('message');
  });

  it('still returns channel.pass when it is the only terminator', () => {
    expect(
      findTerminatingTool({
        steps: [{ toolCalls: [{ toolName: 'channel.pass' }] }],
        toolResults: [],
      }),
    ).toBe('channel.pass');
  });
});
