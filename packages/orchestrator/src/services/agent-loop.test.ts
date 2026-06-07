import { describe, expect, it } from 'vitest';
import { stepTerminatesRun } from './agent-loop.js';

describe('stepTerminatesRun', () => {
  it('stops when the SDK exposes channel.pass as a dynamic call', () => {
    expect(stepTerminatesRun({ dynamicToolCalls: [{ toolName: 'channel.pass' }] })).toBe(true);
  });

  it('stops from the executed pass result even when the SDK omits the tool name', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'passed' } }] })).toBe(true);
  });

  it('does not stop for ordinary tool results', () => {
    expect(stepTerminatesRun({ toolResults: [{ output: { status: 'ok' } }] })).toBe(false);
  });
});
