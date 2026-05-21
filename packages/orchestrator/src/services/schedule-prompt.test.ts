import { describe, expect, it } from 'vitest';
import { scheduleToolSystemPromptSuffix, SCHEDULE_TOOL_SYSTEM_PROMPT } from './schedule-prompt.js';

describe('scheduleToolSystemPromptSuffix', () => {
  it('returns a schedule prompt for the schedule command wake text', () => {
    expect(
      scheduleToolSystemPromptSuffix({
        messageContent: 'Please use the schedule tool for this request: remind me tomorrow',
      }),
    ).toBe(SCHEDULE_TOOL_SYSTEM_PROMPT);
  });

  it('returns a schedule prompt for direct slash-command text', () => {
    expect(
      scheduleToolSystemPromptSuffix({
        messageContent: '/schedule remind me tomorrow',
      }),
    ).toBe(SCHEDULE_TOOL_SYSTEM_PROMPT);
  });

  it('ignores unrelated messages', () => {
    expect(scheduleToolSystemPromptSuffix({ messageContent: 'hello' })).toBeUndefined();
  });
});
