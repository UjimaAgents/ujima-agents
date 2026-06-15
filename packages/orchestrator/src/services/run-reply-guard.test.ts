import { describe, expect, it } from 'vitest';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
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

});

describe('findTerminatingToolFromRunSteps', () => {
  it('reads output status from persisted steps', () => {
    expect(
      findTerminatingToolFromRunSteps([
        { toolId: 'channel_ack', status: 'ok', output: { status: 'acked' } },
      ]),
    ).toBe('channel.ack');
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
