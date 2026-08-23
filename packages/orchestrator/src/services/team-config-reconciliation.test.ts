import { describe, expect, it } from 'vitest';
import { normalizeStoredTeamConfig } from './team-config-reconciliation.js';

describe('normalizeStoredTeamConfig', () => {
  it('keeps the organization workspace root authoritative', () => {
    const result = normalizeStoredTeamConfig(JSON.stringify({
      name: 'Org',
      workspace: { root: '/old-root', roleScopes: {} },
      providers: { openai: { defaultModel: 'gpt-5.4', models: [] } },
      roles: [],
      agents: [],
      channels: [],
    }), '/active-root');
    expect(result.config.workspace.root).toBe('/active-root');
    expect(result.config.providers.openai?.kind).toBe('openai');
    expect(result.migrated).toBe(true);
  });

  it('replaces out-of-root role scopes with the workspace root', () => {
    const result = normalizeStoredTeamConfig(JSON.stringify({
      name: 'Org',
      workspace: { root: '/active-root', roleScopes: {} },
      providers: { openai: { kind: 'openai', defaultModel: 'gpt-5.4', models: [] } },
      roles: [{ name: 'writer', workspaceScopes: ['../../secrets'], tools: [], channels: [] }],
      agents: [],
      channels: [],
    }), '/active-root');
    expect(result.config.roles[0]?.workspaceScopes).toEqual(['.']);
  });
});
