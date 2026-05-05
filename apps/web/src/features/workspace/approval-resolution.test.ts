import { describe, expect, it, vi } from "vitest";
import { resolveWorkspaceApproval } from "./approval-resolution";

describe("resolveWorkspaceApproval", () => {
  it("sends a rejected status for reject decisions", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await resolveWorkspaceApproval({
      organizationId: "org-1",
      approvalId: "ap-1",
      resolution: "reject",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/approvals/ap-1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: "org-1",
        resolution: "reject",
        reason: "Resolved from workspace (reject).",
      }),
    });
  });

  it("sends an approved status for allow decisions", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await resolveWorkspaceApproval({
      organizationId: "org-1",
      approvalId: "ap-1",
      resolution: "allow_always",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/approvals/ap-1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: "org-1",
        resolution: "allow_always",
        reason: "Resolved from workspace (allow_always).",
      }),
    });
  });
});
