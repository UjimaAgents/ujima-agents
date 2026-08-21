import { clientFetchJson } from "@/lib/client-api";

export interface ApprovalResolutionInput {
  organizationId: string;
  approvalId: string;
  resolution: "allow_once" | "allow_always" | "allow_family" | "reject";
}

export async function resolveWorkspaceApproval({
  organizationId,
  approvalId,
  resolution,
}: ApprovalResolutionInput): Promise<unknown> {
  return clientFetchJson<unknown>(`/api/approvals/${approvalId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      resolution,
      reason: `Resolved from workspace (${resolution}).`,
    }),
  }, "Unable to resolve approval.");
}
