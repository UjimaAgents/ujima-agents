export interface ApprovalResolutionInput {
  organizationId: string;
  approvalId: string;
  resolution: "allow_once" | "allow_always" | "allow_family" | "reject";
  fetchImpl?: typeof fetch;
}

export async function resolveWorkspaceApproval({
  organizationId,
  approvalId,
  resolution,
  fetchImpl = fetch,
}: ApprovalResolutionInput): Promise<Response> {
  return fetchImpl(`/api/approvals/${approvalId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      resolution,
      reason: `Resolved from workspace (${resolution}).`,
    }),
  });
}
