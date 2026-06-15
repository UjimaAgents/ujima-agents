import { describe, expect, it, vi } from 'vitest';
import { resolveSpiritModel, defaultResolveProviderName, defaultResolveModelId } from './to-model-messages.js';

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
  providers: Record<string, { kind: string; defaultModel: string }>;
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

describe('resolveSpiritModel provider-fallback (Option 1)', () => {
  it('uses the preferred provider when it has a key', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      roleModel: 'deepseek-v4-flash',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-2.5-flash' },
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

  it('falls back to the next configured provider when the preferred one has no key', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      roleModel: 'deepseek-v4-flash',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-2.5-flash' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'google' ? 'google-key' : null,
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
    });
    expect(result).toBeDefined();
    expect(getKey).toHaveBeenCalledWith('org-1', 'deepseek');
    expect(getKey).toHaveBeenCalledWith('org-1', 'google');
    expect(warn).toHaveBeenCalled();
    // Warning message includes both the preferred and fallback names.
    const msg = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(msg).toMatch(/deepseek/);
    expect(msg).toMatch(/google/);
    warn.mockRestore();
  });

  // Regression: pre-fix, `resolveSpiritModel` cleared `teamRole.model`
  // on fallback but `member.model` was still preferred by ai-service's
  // closure (`member.model ?? r.model ?? p.defaultModel`). Since
  // `member.model` is provider-specific to the original provider, the
  // fallback path would feed an invalid id to the new provider and
  // run startup would fail. The new contract passes an `isFallback`
  // flag so resolvers can ignore member overrides on fallback.
  it('throws a clear error when NO provider has a key', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-2.5-flash' },
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
    ).toThrow(/No usable provider/);
  });
});
