import { describe, expect, it } from 'vitest';
import { composeSystemPromptSuffix } from './spirit-run-detail.js';
import { GOAL_MODE_SYSTEM_PROMPT } from './goal-mode-prompt.js';
import { SCHEDULE_TOOL_SYSTEM_PROMPT } from './schedule-prompt.js';

describe('composeSystemPromptSuffix', () => {
  it('includes goal and schedule guidance for the triggering message', () => {
    const suffix = composeSystemPromptSuffix({
      goalMode: true,
      messageContent: '/schedule daily standup',
    });
    expect(suffix).toContain(GOAL_MODE_SYSTEM_PROMPT);
    expect(suffix).toContain(SCHEDULE_TOOL_SYSTEM_PROMPT);
  });

  it('merges an extra suffix ahead of goal/schedule blocks', () => {
    expect(
      composeSystemPromptSuffix({
        extraSuffix: 'Custom block',
        messageContent: '/schedule',
      }),
    ).toBe(`Custom block\n\n${SCHEDULE_TOOL_SYSTEM_PROMPT}`);
  });
});
