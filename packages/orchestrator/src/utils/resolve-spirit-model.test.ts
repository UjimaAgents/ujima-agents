import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSpiritModel, defaultResolveProviderName, defaultResolveModelId } from './to-model-messages.js';

vi.mock('@ujima/llm', () => ({
  selectLanguageModel: vi.fn((input) => ({ input })),
}));

/**
 * Minimal fake `AgentTeamHandle` covering only the surface that
 * `resolveSpiritModel` touches. Avoids loading the real
 * `@ujima/framework` team builder for these unit tests.
 */
function buildTeam(input: {
  agentName: string;
  roleName: string;
  rolePreferredProvider: string;
  roleModel?: string;
  providers: Record<string, { kind: string; defaultModel?: string; authMode?: 'chatgpt' }>;
}) {
  const agent = { id: input.agentName, name: input.agentName, roleName: input.roleName };
  const role = {
    name: input.roleName,
    provider: input.rolePreferredProvider,
    model: input.roleModel,
  };
  return {
    kind: 'ujima.agent-team' as const,
    providers: input.providers,
    getAgent: (name: string) => (name === input.agentName ? agent : undefined),
    getRole: (name: string) => (name === input.roleName ? role : undefined),
    getProvider: (name: string) => input.providers[name],
  } as unknown as Parameters<typeof resolveSpiritModel>[0]['team'];
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('resolveSpiritModel', () => {
  it('uses the preferred provider when it has a key', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      roleModel: 'deepseek-v4-flash',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-3.1-pro' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'deepseek' ? 'deepseek-key' : null,
    );
    expect(() =>
      resolveSpiritModel({
        organizationId: 'org-1',
        memberId: 'agent-1',
        role: 'worker',
        member: { id: 'agent-1', name: 'agent-1' },
        team,
        getProviderCredential: getKey,
        resolveProviderName: defaultResolveProviderName,
        resolveModelId: defaultResolveModelId,
      }),
    ).not.toThrow();
    // Preferred provider was looked up.
    expect(getKey).toHaveBeenCalledWith('org-1', 'deepseek');
  });

  it('throws a clear error when no API key exists', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-3.1-pro' },
      },
    });
    const getKey = vi.fn(() => null);
    expect(() =>
      resolveSpiritModel({
        organizationId: 'org-1',
        memberId: 'agent-1',
        role: 'worker',
        member: { id: 'agent-1', name: 'agent-1' },
        team,
        getProviderCredential: getKey,
        resolveProviderName: defaultResolveProviderName,
        resolveModelId: defaultResolveModelId,
      }),
    ).toThrow(/No API key/);
  });
});
