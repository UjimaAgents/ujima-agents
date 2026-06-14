import { describe, expect, it } from 'vitest';
import type { AgentTeamHandle } from '@ujima/framework';
import { validateProviderKeys } from './team.js';

function makeTeam(): AgentTeamHandle {
  return {
    providers: {
      openai: { kind: 'openai' },
      ollama: { kind: 'ollama' },
    },
    roles: [
      { name: 'writer', provider: 'openai' },
      { name: 'local', provider: 'ollama' },
    ],
  } as unknown as AgentTeamHandle;
}

describe('validateProviderKeys', () => {
  it('requires keys for hosted providers', () => {
    const result = validateProviderKeys(makeTeam(), {});
    expect(result.missingProviders).toEqual(['openai']);
  });

  it('does not require a key for ollama', () => {
    const result = validateProviderKeys(makeTeam(), { openai: 'key' });
    expect(result.missingProviders).toEqual([]);
  });
});
