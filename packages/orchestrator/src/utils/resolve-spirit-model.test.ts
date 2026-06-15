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

  it('uses the fallback provider defaultModel (not the role.model from the original provider)', () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      // role.model belongs to deepseek; should NOT be used on Google fallback.
      roleModel: 'deepseek-v4-flash',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-2.5-flash' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'google' ? 'google-key' : null,
    );
    const resolveModelId = vi.fn(defaultResolveModelId);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId,
    });

    // resolveModelId is called twice: once with deepseek (rejected, no key),
    // once with google (accepted). On the google call, the teamRole.model
    // arg must be `undefined` so the resolver picks google's defaultModel.
    const googleCall = resolveModelId.mock.calls.find(
      (args) => (args[1] as { defaultModel?: string }).defaultModel === 'gemini-2.5-flash',
    );
    expect(googleCall).toBeDefined();
    expect(googleCall?.[0]).toEqual({ model: undefined });
  });

  it('uses a built-in default model when the fallback provider has no defaultModel configured', () => {
    // Real-world case: user pastes a Google API key via the UI,
    // the resulting team.providers.google has no `defaultModel`,
    // role still points at deepseek. Fallback must still work.
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'deepseek',
      roleModel: 'deepseek-v4-flash',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        // Note: no defaultModel — exactly the broken state from the
        // user's bug report.
        google: { kind: 'google', defaultModel: '' as unknown as string },
      },
    });
    // Strip defaultModel to mirror the real bug
    delete (team.providers as { google?: { defaultModel?: string } }).google?.defaultModel;
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'google' ? 'google-key' : null,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
  });

  // Regression: pre-fix, `resolveSpiritModel` cleared `teamRole.model`
  // on fallback but `member.model` was still preferred by ai-service's
  // closure (`member.model ?? r.model ?? p.defaultModel`). Since
  // `member.model` is provider-specific to the original provider, the
  // fallback path would feed an invalid id to the new provider and
  // run startup would fail. The new contract passes an `isFallback`
  // flag so resolvers can ignore member overrides on fallback.
  it('signals isFallback=true on the fallback provider call so member overrides can be ignored', () => {
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
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Closure that mirrors ai-service's bug-prone shape: prefer
    // member.model first. With the new `isFallback` flag honored
    // correctly, it must skip the member override on the fallback
    // provider call.
    const memberModel = 'deepseek-v4-pro'; // provider-specific to deepseek
    const resolveModelId = vi.fn(
      (
        r: { model?: string },
        p: { defaultModel?: string },
        _role: 'worker' | 'supervisor',
        isFallback: boolean,
      ): string | undefined =>
        (isFallback ? undefined : memberModel) ?? r.model ?? p.defaultModel,
    );

    resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1', model: memberModel },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId,
    });

    // Deepseek is rejected at the credential lookup (no API key)
    // BEFORE `resolveModelId` runs, so only the google branch reaches
    // the resolver. `isFallback` must be `true` for that call.
    expect(resolveModelId).toHaveBeenCalledTimes(1);
    const googleCall = resolveModelId.mock.calls[0]!;
    expect((googleCall[1] as { defaultModel?: string }).defaultModel).toBe('gemini-2.5-flash');
    expect(googleCall[3]).toBe(true);

    // The closure's return on the google call must be the google
    // defaultModel (NOT the deepseek-specific member.model), proving
    // the isFallback flag is honored end-to-end.
    expect(resolveModelId.mock.results[0]?.value).toBe('gemini-2.5-flash');
  });

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
