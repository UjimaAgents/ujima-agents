import { describe, expect, it } from 'vitest';
import {
  RUN_TERMINATING_TOOL_NAMES,
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  normalizeToDottedToolName,
  runUsedChannelPass,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';

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

describe('RUN_TERMINATING_TOOL_NAMES', () => {
  it('includes channel.pass and channel.handoff', () => {
    // Loophole fix L1 — the new silent / handoff terminators must
    // be in the set so the agent-loop stops on them and the run-
    // loop branches correctly in run.ts.
    expect(RUN_TERMINATING_TOOL_NAMES.has('channel.pass')).toBe(true);
    expect(RUN_TERMINATING_TOOL_NAMES.has('channel.handoff')).toBe(true);
  });
});

describe('normalizeToDottedToolName', () => {
  it('converts underscores to dots', () => {
    expect(normalizeToDottedToolName('channel_reply')).toBe('channel.reply');
    expect(normalizeToDottedToolName('channel_pass')).toBe('channel.pass');
    expect(normalizeToDottedToolName('message')).toBe('message');
  });

  it('is idempotent on already-dotted names', () => {
    expect(normalizeToDottedToolName('channel.reply')).toBe('channel.reply');
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

  it('accepts model-style underscored names', () => {
    expect(
      findTerminatingTool({
        text: '',
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'channel_pass' }] }],
      }),
    ).toBe('channel.pass');
  });

  it('keeps precedence stable', () => {
    expect(
      findTerminatingTool({
        steps: [
          {
            toolCalls: [
              { toolName: 'channel_pass' },
              { toolName: 'channel.reply' },
            ],
          },
        ],
        toolResults: [],
      }),
    ).toBe('channel.reply');
  });
});

describe('findTerminatingToolFromRunSteps', () => {
  it('reads output status from persisted steps', () => {
    expect(
      findTerminatingToolFromRunSteps([
        { toolId: 'channel_ack', status: 'ok', output: { status: 'acked' } },
      ]),
    ).toBe('channel.ack');
  });

  it('ignores blocked persisted steps', () => {
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
});
