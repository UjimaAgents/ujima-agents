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
  providers: Record<string, { kind: string; defaultModel?: string; authMode?: 'chatgpt'; models?: string[] }>;
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

// A probe stub that reports a fixed set of providers as reachable.
function probeOnly(...reachable: string[]) {
  return vi.fn(async (input: { providerName: string }) => reachable.includes(input.providerName));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('resolveSpiritModel', () => {
  it('uses the preferred provider when it has a key (no probe)', async () => {
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
    const probe = probeOnly('deepseek', 'google');
    const result = (await resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
      probeFallbackModel: probe,
    })) as unknown as { input: { kind: string; modelId: string } };

    expect(result.input.kind).toBe('deepseek');
    expect(getKey).toHaveBeenCalledWith('org-1', 'deepseek');
    // Preferred is used as-is — the probe is fallback-only.
    expect(probe).not.toHaveBeenCalled();
  });

  it('throws when neither the preferred nor any fallback is usable', async () => {
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
    await expect(
      resolveSpiritModel({
        organizationId: 'org-1',
        memberId: 'agent-1',
        role: 'worker',
        member: { id: 'agent-1', name: 'agent-1' },
        team,
        getProviderCredential: getKey,
        resolveProviderName: defaultResolveProviderName,
        resolveModelId: defaultResolveModelId,
        listConfiguredProviders: () => ({ deepseek: true, google: true }),
        probeFallbackModel: probeOnly(), // nothing reachable
      }),
    ).rejects.toThrow(/No usable provider|health check/i);
  });

  it('validates the fallback with a live probe and uses the first that passes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'google',
      roleModel: 'gemini-3.1-pro',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-3.1-pro' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'deepseek' ? 'deepseek-key' : null,
    );
    const result = (await resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1', llm: 'google', model: 'gemini-3.1-pro' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
      listConfiguredProviders: () => ({ deepseek: true, google: true }),
      probeFallbackModel: probeOnly('deepseek'),
    })) as unknown as { input: { kind: string; modelId: string } };

    // Fell back to deepseek on ITS default model (not the member's gemini model).
    expect(result.input.kind).toBe('deepseek');
    expect(result.input.modelId).toBe('deepseek-v4-flash');
    warn.mockRestore();
  });

  it('SKIPS an unreachable fallback (probe fails) and picks the next reachable one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // ollama sorts/used first but is DOWN; deepseek is reachable.
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'google',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        ollama: { kind: 'ollama', defaultModel: 'qwen2.5:0.5b' },
        google: { kind: 'google' },
      },
    });
    const getKey = vi.fn((_org: string, p: string) => (p === 'google' ? null : `${p}-key`));
    const probe = probeOnly('deepseek'); // ollama probe fails
    const result = (await resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1', llm: 'google' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
      listConfiguredProviders: () => ({ deepseek: true, ollama: true, google: true }),
      // both deepseek + ollama have in-use models, so ordering is alphabetical:
      // deepseek before ollama. deepseek probes OK first anyway.
      listProviderModelsInUse: (name) =>
        name === 'deepseek' ? ['deepseek-v4-flash'] : name === 'ollama' ? ['qwen2.5:0.5b'] : [],
      probeFallbackModel: probe,
    })) as unknown as { input: { kind: string } };

    expect(result.input.kind).toBe('deepseek');
    warn.mockRestore();
  });

  it('derives the fallback model from in-use models when the provider has no defaultModel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'google',
      providers: {
        deepseek: { kind: 'deepseek' }, // no defaultModel, no models[]
        google: { kind: 'google', defaultModel: 'gemini-3.1-pro' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'deepseek' ? 'deepseek-key' : null,
    );
    const result = (await resolveSpiritModel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      role: 'worker',
      member: { id: 'agent-1', name: 'agent-1', llm: 'google' },
      team,
      getProviderCredential: getKey,
      resolveProviderName: defaultResolveProviderName,
      resolveModelId: defaultResolveModelId,
      listConfiguredProviders: () => ({ deepseek: true, google: true }),
      listProviderModelsInUse: (name) => (name === 'deepseek' ? ['deepseek-v4-flash'] : []),
      probeFallbackModel: probeOnly('deepseek'),
    })) as unknown as { input: { kind: string; modelId: string } };

    expect(result.input.kind).toBe('deepseek');
    expect(result.input.modelId).toBe('deepseek-v4-flash');
    warn.mockRestore();
  });

  it('does not fall back when listConfiguredProviders is absent (strict mode)', async () => {
    const team = buildTeam({
      agentName: 'agent-1',
      roleName: 'engineer',
      rolePreferredProvider: 'google',
      providers: {
        deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash' },
        google: { kind: 'google', defaultModel: 'gemini-3.1-pro' },
      },
    });
    const getKey = vi.fn((_org: string, providerName: string) =>
      providerName === 'deepseek' ? 'deepseek-key' : null,
    );
    await expect(
      resolveSpiritModel({
        organizationId: 'org-1',
        memberId: 'agent-1',
        role: 'worker',
        member: { id: 'agent-1', name: 'agent-1', llm: 'google' },
        team,
        getProviderCredential: getKey,
        resolveProviderName: defaultResolveProviderName,
        resolveModelId: defaultResolveModelId,
        // no listConfiguredProviders → no fallback attempted
        probeFallbackModel: probeOnly('deepseek'),
      }),
    ).rejects.toThrow();
  });
});
