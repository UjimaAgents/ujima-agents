import { describe, expect, it } from 'vitest';
import { goalModeSystemPromptSuffix, GOAL_MODE_INACTIVE_SYSTEM_PROMPT, GOAL_MODE_SYSTEM_PROMPT } from './goal-mode-prompt.js';

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
