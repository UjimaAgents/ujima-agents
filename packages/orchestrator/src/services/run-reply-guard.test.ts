import { describe, expect, it } from 'vitest';
import { runUsedThreadPublishingTool } from './run-reply-guard.js';

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
