import type { ToolAction } from '@ujima/shared';

export const PATH_SCOPED_TOOL_IDS = [
  'filesystem',
  'view',
  'write',
  'edit',
  'multiedit',
  'ls',
  'glob',
  'download',
] as const;

export type PathScopedToolId = (typeof PATH_SCOPED_TOOL_IDS)[number];

export const PATH_RESOLVING_TOOL_IDS = [...PATH_SCOPED_TOOL_IDS, 'shell'] as const;

export function isPathScopedToolId(toolId: string): toolId is PathScopedToolId {
  return (PATH_SCOPED_TOOL_IDS as readonly string[]).includes(toolId);
}

export function usesPathResolution(toolId: string): boolean {
  return (PATH_RESOLVING_TOOL_IDS as readonly string[]).includes(toolId);
}

export function isInScopeFileTool(toolId: string, action: ToolAction): boolean {
  return isPathScopedToolId(toolId) || (action === 'read' && toolId === 'grep');
}
