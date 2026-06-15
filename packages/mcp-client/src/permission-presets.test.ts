import { describe, expect, it } from 'vitest';
import { buildPermissionPreset } from './permission-presets';

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

  it('full allows every discovered tool including destructive', () => {
    const perms = buildPermissionPreset('figma-ai-bridge', 'full', {
      discoveredTools: figmaTools,
    });
    expect(perms.allowed_tools).toEqual(figmaTools);
    expect(perms.blocked_tools).toEqual([]);
  });

  it('throws on unknown registry id', () => {
    expect(() => buildPermissionPreset('nope', 'read_only')).toThrow(/Unknown registry entry/);
  });
});
