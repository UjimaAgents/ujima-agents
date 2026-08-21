import {
  organizationIdFromWorkspaceId,
  orgWorkspaceId,
} from "@ujima/shared/browser";
import { clientFetchVoid } from "@/lib/client-api";

export { organizationIdFromWorkspaceId, orgWorkspaceId };

export interface WorkspaceSwitchRouter {
  push: (href: string) => void;
  refresh: () => void;
}

export function reloadAfterWorkspaceSwitch(
  router: WorkspaceSwitchRouter,
  redirectTo?: string,
): void {
  if (redirectTo) {
    router.push(redirectTo);
  } else {
    router.refresh();
  }
}

export async function switchOrganization(
  router: WorkspaceSwitchRouter,
  organizationId: string,
  redirectTo?: string,
): Promise<void> {
  await clientFetchVoid("/api/auth/switch-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  }, "Unable to switch workspace");

  reloadAfterWorkspaceSwitch(router, redirectTo);
}

export async function switchToWorkspace(
  router: WorkspaceSwitchRouter,
  workspaceId: string,
  redirectTo?: string,
): Promise<void> {
  const organizationId = organizationIdFromWorkspaceId(workspaceId);
  if (!organizationId) {
    throw new Error("Invalid workspace id");
  }
  await switchOrganization(router, organizationId, redirectTo);
}
