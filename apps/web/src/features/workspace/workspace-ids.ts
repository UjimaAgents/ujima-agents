/** Workspace id for the 1:1 organization model (`ws_{organizationId}`). */
export function orgWorkspaceId(organizationId: string): string {
  return `ws_${organizationId}`;
}

export function organizationIdFromWorkspaceId(workspaceId: string): string | null {
  if (!workspaceId.startsWith("ws_") || workspaceId.length <= 3) return null;
  return workspaceId.slice(3);
}
