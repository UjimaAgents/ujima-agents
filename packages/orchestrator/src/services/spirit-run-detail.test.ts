import { describe, expect, it } from 'vitest';
import { composeSystemPromptSuffix } from './spirit-run-detail.js';
import {
  goalModeSystemPromptSuffix,
  GOAL_MODE_INACTIVE_SYSTEM_PROMPT,
  GOAL_MODE_SYSTEM_PROMPT,
} from './goal-mode-prompt.js';
import {
  scheduleToolSystemPromptSuffix,
  SCHEDULE_TOOL_SYSTEM_PROMPT,
} from './schedule-prompt.js';

describe('goalModeSystemPromptSuffix', () => {
  it('returns the active goal-mode prompt when goal mode is enabled', () => {
    expect(
      goalModeSystemPromptSuffix({
        goalMode: true,
        messageContent: 'Turn goal mode on',
      }),
    ).toBe(GOAL_MODE_SYSTEM_PROMPT);
  });

  it('returns the inactive reminder for goal-related messages when goal mode is off', () => {
    expect(
      goalModeSystemPromptSuffix({
        goalMode: false,
        messageContent: 'Start a goal for me',
      }),
    ).toBe(GOAL_MODE_INACTIVE_SYSTEM_PROMPT);
  });

  it('returns nothing for unrelated messages when goal mode is off', () => {
    expect(
      goalModeSystemPromptSuffix({
        goalMode: false,
        messageContent: 'What did we do today?',
      }),
    ).toBeUndefined();
  });
});

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
