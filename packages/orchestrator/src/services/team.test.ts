import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import { listProviderStatuses, validateProviderKeys } from './team.js';

function makeTeam(): AgentTeamHandle {
  const providers = {
    openai: { kind: 'openai' },
    ollama: { kind: 'ollama' },
  };
  return {
    providers,
    getProvider: (name: string) => providers[name as keyof typeof providers],
    roles: [
      { name: 'writer', provider: 'openai' },
      { name: 'local', provider: 'ollama' },
    ],
  } as unknown as AgentTeamHandle;
}

function makeCodexTeam(
  providers: Record<string, { kind: string; authMode?: 'chatgpt' }>,
  roles: { name: string; provider: string }[],
): AgentTeamHandle {
  return {
    providers: {
      ...providers,
    },
    getProvider: (name: string) => providers[name],
    roles,
  } as unknown as AgentTeamHandle;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('validateProviderKeys', () => {
  it('requires keys for hosted providers', () => {
    const result = validateProviderKeys(makeTeam(), {});
    expect(result.missingProviders).toEqual(['openai']);
  });

  it('does not require a key for ollama', () => {
    const result = validateProviderKeys(makeTeam(), { openai: 'key' });
    expect(result.missingProviders).toEqual([]);
  });

  it('uses the local Codex login for openai when authMode is chatgpt', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ujima-codex-auth-'));
    try {
      await writeFile(
        join(homeDir, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: { access_token: 'token' },
        }),
      );
      vi.stubEnv('CODEX_HOME', homeDir);

      const codexTeam = makeCodexTeam(
        { openai: { kind: 'openai', authMode: 'chatgpt' } },
        [{ name: 'writer', provider: 'openai' }],
      );

      expect(validateProviderKeys(codexTeam, {})).toEqual({
        unknownProviders: [],
        missingProviders: [],
      });
      expect(listProviderStatuses(codexTeam, {})).toEqual([{ name: 'openai', hasKey: true, authMode: 'chatgpt' }]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('includes baseUrl in provider status when configured', () => {
    const team = makeCodexTeam(
      { ollama: { kind: 'ollama', baseUrl: 'http://127.0.0.1:8000/v1' } as unknown as { kind: string } },
      [{ name: 'local', provider: 'ollama' }],
    );
    expect(listProviderStatuses(team, { ollama: true })).toEqual([
      { name: 'ollama', hasKey: true, authMode: undefined, baseUrl: 'http://127.0.0.1:8000/v1' },
    ]);
  });

  it('uses the local Codex login for openai-codex', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'ujima-codex-auth-'));
    try {
      await writeFile(
        join(homeDir, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: { access_token: 'token' },
        }),
      );
      vi.stubEnv('CODEX_HOME', homeDir);

      const codexTeam = makeCodexTeam(
        { 'openai-codex': { kind: 'openai-codex' } },
        [{ name: 'writer', provider: 'openai-codex' }],
      );

      expect(validateProviderKeys(codexTeam, {})).toEqual({
        unknownProviders: [],
        missingProviders: [],
      });
      expect(listProviderStatuses(codexTeam, {})).toEqual([
        { name: 'openai-codex', hasKey: true, authMode: 'chatgpt' },
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
