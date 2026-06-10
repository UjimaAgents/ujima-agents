import { describe, expect, it } from 'vitest';
import {
  CURATED_REGISTRY,
  findRegistryEntry,
  instantiateFromRegistry,
  searchRegistry,
} from './registry';

describe('curated registry', () => {
  it('includes the Day-1 minimum: filesystem + sqlite', () => {
    const ids = CURATED_REGISTRY.map((e) => e.id);
    expect(ids).toContain('filesystem');
    expect(ids).toContain('sqlite');
  });

  it('also ships figma + playwright for Day-2', () => {
    const ids = CURATED_REGISTRY.map((e) => e.id);
    expect(ids).toContain('figma-ai-bridge');
    expect(ids).toContain('playwright');
  });

  it('search matches name, tags, or description', () => {
    const hits = searchRegistry('design').map((e) => e.id);
    expect(hits).toContain('figma-ai-bridge');
    expect(searchRegistry('   ').length).toBe(CURATED_REGISTRY.length);
  });

  it('findRegistryEntry returns entries by id', () => {
    expect(findRegistryEntry('filesystem')?.name).toBe('Filesystem');
    expect(findRegistryEntry('missing')).toBeUndefined();
  });

  it('instantiate substitutes arg placeholders', () => {
    const def = instantiateFromRegistry('filesystem', {
      argSubstitutions: { rootDir: '/tmp/scope' },
    });
    expect(def.args).toContain('/tmp/scope');
    expect(def.args).not.toContain('${rootDir}');
  });

  it('instantiate merges env overrides and keeps transport', () => {
    const def = instantiateFromRegistry('figma-ai-bridge', {
      envOverrides: { FIGMA_API_KEY: 'abc' },
    });
    expect(def.env).toEqual({ FIGMA_API_KEY: 'abc' });
    expect(def.transport).toBe('stdio');
  });

  it('figma entry requests the canonical FIGMA_API_KEY env var', () => {
    const figma = findRegistryEntry('figma-ai-bridge');
    expect(figma?.requires?.envVars).toEqual(['FIGMA_API_KEY']);
    expect(figma?.defaults.args).toEqual(['-y', 'figma-developer-mcp', '--stdio']);
  });

  it('playwright entry uses @playwright/mcp and flags destructive tools', () => {
    const pw = findRegistryEntry('playwright');
    expect(pw?.defaults.args).toEqual(['-y', '@playwright/mcp@latest']);
    expect(pw?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['browser_close', 'browser_execute_js']),
    );
  });

  it('figma entry flags destructive tools for permission presets', () => {
    const figma = findRegistryEntry('figma-ai-bridge');
    expect(figma?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['delete_node', 'update_styles']),
    );
  });

  it('throws on unknown ids', () => {
    expect(() => instantiateFromRegistry('nope')).toThrow(/Unknown registry entry/);
  });

  it('ships git, github, postgres, notion, slack (v0.2 expansion)', () => {
    const ids = CURATED_REGISTRY.map((e) => e.id);
    for (const expected of ['git', 'github', 'postgres', 'notion', 'slack']) {
      expect(ids).toContain(expected);
    }
  });

  it('git is per-agent isolated and scoped to a repo', () => {
    const git = findRegistryEntry('git');
    expect(git?.defaults.isolation).toBe('per-agent');
    expect(git?.requires?.args?.[0]?.key).toBe('rootDir');
    expect(git?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['git_reset', 'git_checkout']),
    );
    const def = instantiateFromRegistry('git', { argSubstitutions: { rootDir: '/srv/repo' } });
    expect(def.args).toEqual(['mcp-server-git', '--repository', '/srv/repo']);
  });

  it('github requests GITHUB_PERSONAL_ACCESS_TOKEN and flags mutating tools', () => {
    const gh = findRegistryEntry('github');
    expect(gh?.requires?.envVars).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
    expect(gh?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['create_or_update_file', 'merge_pull_request']),
    );
  });

  it('postgres takes a connection string and ships no destructive tools (read-only MCP)', () => {
    const pg = findRegistryEntry('postgres');
    expect(pg?.requires?.args?.[0]?.key).toBe('connectionString');
    expect(pg?.knownDestructiveTools).toBeUndefined();
    const def = instantiateFromRegistry('postgres', {
      argSubstitutions: { connectionString: 'postgres://u:p@h/db' },
    });
    expect(def.args).toContain('postgres://u:p@h/db');
  });

  it('notion requests NOTION_API_KEY and flags write operations', () => {
    const notion = findRegistryEntry('notion');
    expect(notion?.requires?.envVars).toEqual(['NOTION_API_KEY']);
    expect(notion?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['notion-update-page', 'notion-move-pages']),
    );
  });

  it('slack requires both SLACK_BOT_TOKEN and SLACK_TEAM_ID', () => {
    const slack = findRegistryEntry('slack');
    expect(slack?.requires?.envVars).toEqual(['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID']);
    expect(slack?.knownDestructiveTools).toEqual(
      expect.arrayContaining(['slack_post_message']),
    );
  });

  // PR 2 — connector dispatch substrate expansion. Two load-bearing
  // invariants only; per-entry shape assertions are not worth the
  // upkeep (typecheck already enforces the RegistryEntry contract).

  it('OAuth-only entries throw on instantiate (clear error, not silent half-config)', () => {
    // OAuth entries are listed for discovery but cannot instantiate
    // until the OAuth flow lands. Throwing here means the admin sees
    // "OAuth not yet supported" instead of an opaque connection
    // failure at runtime. Cover one of each OAuth entry to catch
    // accidental authMode flips.
    for (const id of ['linear-mcp', 'vercel-mcp', 'atlassian-mcp', 'notion-remote']) {
      expect(() => instantiateFromRegistry(id)).toThrow(/OAuth/i);
    }
  });

  it('a PAT-auth remote entry instantiates to an http-streamable MCPDef and substitutes header tokens from envOverrides', () => {
    // Two invariants in one assertion chain:
    //   1. No envOverrides → headers retain the literal placeholder
    //      (same semantics as args substitution; caller is responsible
    //      for supplying values).
    //   2. envOverrides supplied → the token is interpolated into the
    //      Authorization header before the MCPDef leaves this function.
    // Without (2) buildTransport would forward `Bearer ${GITHUB_TOKEN}`
    // as the literal Authorization header and every PAT-auth Track A
    // entry would fail auth in production with no useful error.
    const unbound = instantiateFromRegistry('github-mcp');
    expect(unbound.transport).toBe('http-streamable');
    expect(unbound.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(unbound.headers).toEqual({ Authorization: 'Bearer ${GITHUB_TOKEN}' });

    const bound = instantiateFromRegistry('github-mcp', {
      envOverrides: { GITHUB_TOKEN: 'ghp_test_token' },
    });
    expect(bound.headers).toEqual({ Authorization: 'Bearer ghp_test_token' });
  });
});
