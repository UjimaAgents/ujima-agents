import { describe, expect, test } from 'vitest';
import {
  ORCHESTRATOR_ENGINES,
  resolveOrchestratorEngine,
  type OrchestratorEngine,
} from './engine';

describe('resolveOrchestratorEngine', () => {
  test('defaults to ai-sdk when undefined', () => {
    expect(resolveOrchestratorEngine(undefined)).toBe('ai-sdk');
  });

  test('accepts both documented engines', () => {
    for (const e of ORCHESTRATOR_ENGINES) {
      const resolved: OrchestratorEngine = resolveOrchestratorEngine(e);
      expect(resolved).toBe(e);
    }
  });

  test('throws on an unknown engine', () => {
    expect(() => resolveOrchestratorEngine('mystery')).toThrow(/Invalid orchestrator engine/);
  });
});
