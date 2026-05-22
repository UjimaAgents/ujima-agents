import { organizationIdFromWorkspaceId } from "./workspace-ids";

export { organizationIdFromWorkspaceId, orgWorkspaceId } from "./workspace-ids";

export function reloadAfterWorkspaceSwitch(redirectTo?: string): void {
  window.location.href =
    redirectTo ?? `${window.location.pathname}${window.location.search}`;
}

export async function switchOrganization(
  organizationId: string,
  redirectTo?: string,
): Promise<void> {
  const res = await fetch("/api/auth/switch-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { message?: string } | null)?.message ?? "Unable to switch workspace",
    );
  }

  reloadAfterWorkspaceSwitch(redirectTo);
}

export async function switchToWorkspace(
  workspaceId: string,
  redirectTo?: string,
): Promise<void> {
  const organizationId = organizationIdFromWorkspaceId(workspaceId);
  if (!organizationId) {
    throw new Error("Invalid workspace id");
  }
  await switchOrganization(organizationId, redirectTo);
}
