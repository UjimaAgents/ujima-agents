import { describe, expect, it } from "vitest";
import { buildCatalogUrl } from "./build-catalog-url";

// Regression coverage for two reviewer-flagged regressions in the
// governance catalog client wiring:
//
//   1. Role scope was being dropped from catalog refreshes (the
//      backend filters MCP attachments + per-tool grants by role,
//      so omitting `role` collapses worker/supervisor scope into a
//      union and the Exposed/allowlist indicators can disagree with
//      what the runtime palette loads).
//   2. Classification edits left agentView stale because the client
//      patched a single row instead of re-fetching. That's covered
//      separately by the hook test below — this file pins the URL
//      contract that the hook depends on for the post-mutation
//      refresh to actually reach the role-scoped endpoint.

describe("buildCatalogUrl", () => {
  it("emits the bare planning view when only orgId is supplied", () => {
    expect(buildCatalogUrl({ orgId: "org-1" })).toBe(
      "/api/settings/mcps/catalog?organizationId=org-1",
    );
  });

  it("threads agentId through (per-agent perspective)", () => {
    expect(
      buildCatalogUrl({ orgId: "org-1", agentId: "agent-x" }),
    ).toBe(
      "/api/settings/mcps/catalog?organizationId=org-1&agentId=agent-x",
    );
  });

  it("threads role through so worker/supervisor scope reaches the backend", () => {
    expect(
      buildCatalogUrl({ orgId: "org-1", agentId: "agent-x", role: "worker" }),
    ).toBe(
      "/api/settings/mcps/catalog?organizationId=org-1&agentId=agent-x&role=worker",
    );
    expect(
      buildCatalogUrl({
        orgId: "org-1",
        agentId: "agent-x",
        role: "supervisor",
      }),
    ).toBe(
      "/api/settings/mcps/catalog?organizationId=org-1&agentId=agent-x&role=supervisor",
    );
  });

  it("supports role without agentId (e.g. a defaults-tab refresh that wants role-aware union counts)", () => {
    expect(
      buildCatalogUrl({ orgId: "org-1", role: "supervisor" }),
    ).toBe(
      "/api/settings/mcps/catalog?organizationId=org-1&role=supervisor",
    );
  });

  it("encodes special characters in identifiers", () => {
    expect(
      buildCatalogUrl({ orgId: "org with space", agentId: "agent/x" }),
    ).toBe(
      "/api/settings/mcps/catalog?organizationId=org+with+space&agentId=agent%2Fx",
    );
  });
});
