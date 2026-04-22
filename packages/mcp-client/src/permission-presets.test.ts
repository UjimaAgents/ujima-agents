import { describe, expect, it } from 'vitest';
import { applyPreset, buildPermissionPreset, describePreset, isDestructive } from './permission-presets';
import { findRegistryEntry } from './registry';

describe('permission presets', () => {
  const figmaTools = [
    'get_file',
    'get_node',
    'search_nodes',
    'create_frame',
    'update_styles',
    'delete_node',
    'delete_nodes',
    'publish_library',
  ];

  it('read_only allows get/search/list and blocks destructive + writes', () => {
    const perms = buildPermissionPreset('figma-ai-bridge', 'read_only', {
      discoveredTools: figmaTools,
    });
    expect(perms.allowed_tools).toEqual(['get_file', 'get_node', 'search_nodes']);
    expect(perms.blocked_tools).toEqual(
      expect.arrayContaining([
        'create_frame',
        'update_styles',
        'delete_node',
        'delete_nodes',
        'publish_library',
      ]),
    );
  });

  it('read_write allows writes but blocks registry-flagged destructive tools', () => {
    const perms = buildPermissionPreset('figma-ai-bridge', 'read_write', {
      discoveredTools: figmaTools,
    });
    expect(perms.allowed_tools).toEqual(
      expect.arrayContaining(['get_file', 'create_frame']),
    );
    expect(perms.allowed_tools).not.toContain('delete_node');
    expect(perms.allowed_tools).not.toContain('update_styles');
    expect(perms.blocked_tools).toEqual(
      expect.arrayContaining(['delete_node', 'delete_nodes', 'update_styles', 'publish_library']),
    );
  });

  it('full allows every discovered tool including destructive', () => {
    const perms = buildPermissionPreset('figma-ai-bridge', 'full', {
      discoveredTools: figmaTools,
    });
    expect(perms.allowed_tools).toEqual(figmaTools);
    expect(perms.blocked_tools).toEqual([]);
  });

  it('applies defaults without a discovered tool list', () => {
    const perms = buildPermissionPreset('playwright', 'read_write');
    expect(perms.allowed_tools).toEqual([]);
    expect(perms.blocked_tools).toEqual(
      expect.arrayContaining(['browser_close', 'browser_execute_js']),
    );
    expect(perms.rate_limit.calls_per_minute).toBeGreaterThan(0);
  });

  it('respects custom rate limit overrides', () => {
    const perms = buildPermissionPreset('filesystem', 'read_write', {
      discoveredTools: ['list_dir', 'read_file', 'write_file'],
      rateLimit: { calls_per_minute: 5, max_session_tokens: 1_000 },
    });
    expect(perms.rate_limit).toEqual({ calls_per_minute: 5, max_session_tokens: 1_000 });
  });

  it('isDestructive reads from the registry flag', () => {
    const figma = findRegistryEntry('figma-ai-bridge');
    if (!figma) throw new Error('figma entry missing');
    expect(isDestructive(figma, 'delete_node')).toBe(true);
    expect(isDestructive(figma, 'get_file')).toBe(false);
  });

  it('applyPreset works directly with a RegistryEntry', () => {
    const pw = findRegistryEntry('playwright');
    if (!pw) throw new Error('playwright entry missing');
    const perms = applyPreset(pw, 'read_only', {
      discoveredTools: ['browser_snapshot', 'browser_click', 'browser_close'],
    });
    expect(perms.allowed_tools).toEqual(['browser_snapshot']);
    expect(perms.blocked_tools).toEqual(
      expect.arrayContaining(['browser_click', 'browser_close', 'browser_execute_js']),
    );
  });

  it('describePreset returns a human-readable summary for each preset', () => {
    expect(describePreset('read_only')).toMatch(/Read-only/);
    expect(describePreset('read_write')).toMatch(/destructive/);
    expect(describePreset('full')).toMatch(/caution/);
  });

  it('throws on unknown registry id', () => {
    expect(() => buildPermissionPreset('nope', 'read_only')).toThrow(/Unknown registry entry/);
  });
});
