import { describe, it, expect } from 'vitest';
import {
  HEARTBEAT_SYSTEM_PROMPT,
  SELF_IMPROVEMENT_SYSTEM_PROMPT,
  heartbeatSystemPromptSuffix,
} from './heartbeat-prompt.js';

describe('HEARTBEAT_SYSTEM_PROMPT', () => {
  it('is a non-empty trimmed string', () => {
    expect(HEARTBEAT_SYSTEM_PROMPT).toBeTruthy();
    expect(typeof HEARTBEAT_SYSTEM_PROMPT).toBe('string');
    expect(HEARTBEAT_SYSTEM_PROMPT).toBe(HEARTBEAT_SYSTEM_PROMPT.trim());
  });

  it('mentions "stay silent" as the expected behavior', () => {
    expect(HEARTBEAT_SYSTEM_PROMPT).toContain('stay silent');
  });

  it('instructs not to use channel.post without meaningful content', () => {
    expect(HEARTBEAT_SYSTEM_PROMPT).toContain('channel.post');
  });

  it('mentions heartbeat mode', () => {
    expect(HEARTBEAT_SYSTEM_PROMPT).toContain('Heartbeat Mode');
  });
});

describe('SELF_IMPROVEMENT_SYSTEM_PROMPT', () => {
  it('is a non-empty trimmed string', () => {
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toBeTruthy();
    expect(typeof SELF_IMPROVEMENT_SYSTEM_PROMPT).toBe('string');
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toBe(SELF_IMPROVEMENT_SYSTEM_PROMPT.trim());
  });

  it('mentions memory.write and procedure add', () => {
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toContain('memory.write');
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toContain('procedure add');
  });

  it('mentions self-improvement mode', () => {
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toContain('Self-Improvement Mode');
  });

  it('instructs to stay silent unless there is a meaningful change', () => {
    expect(SELF_IMPROVEMENT_SYSTEM_PROMPT).toContain('Stay silent');
  });
});

describe('heartbeatSystemPromptSuffix', () => {
  it('returns HEARTBEAT_SYSTEM_PROMPT when heartbeatMode is true', () => {
    const result = heartbeatSystemPromptSuffix({ heartbeatMode: true });
    expect(result).toBe(HEARTBEAT_SYSTEM_PROMPT);
  });

  it('returns SELF_IMPROVEMENT_SYSTEM_PROMPT when selfImprovementMode is true', () => {
    const result = heartbeatSystemPromptSuffix({ selfImprovementMode: true });
    expect(result).toBe(SELF_IMPROVEMENT_SYSTEM_PROMPT);
  });

  it('self-improvement mode takes priority over heartbeat mode', () => {
    const result = heartbeatSystemPromptSuffix({
      heartbeatMode: true,
      selfImprovementMode: true,
    });
    expect(result).toBe(SELF_IMPROVEMENT_SYSTEM_PROMPT);
  });

  it('returns undefined when neither mode is set', () => {
    const result = heartbeatSystemPromptSuffix({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when both modes are false', () => {
    const result = heartbeatSystemPromptSuffix({
      heartbeatMode: false,
      selfImprovementMode: false,
    });
    expect(result).toBeUndefined();
  });

  it('ignores messageContent when determining the mode', () => {
    const result = heartbeatSystemPromptSuffix({
      messageContent: 'some content',
      heartbeatMode: true,
    });
    expect(result).toBe(HEARTBEAT_SYSTEM_PROMPT);
  });
});
