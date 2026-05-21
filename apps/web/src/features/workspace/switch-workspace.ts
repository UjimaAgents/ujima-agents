export async function switchWorkspace(workspaceId: string): Promise<string> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as
    | { workspaceRoot?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.message ?? "Unable to switch workspace.");
  }

  return body?.workspaceRoot ?? "";
}

export function reloadAfterWorkspaceSwitch(): void {
  window.location.href = "/workspace";
}
