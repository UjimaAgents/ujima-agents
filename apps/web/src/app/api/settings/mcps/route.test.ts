import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mockRequireProxyOrgAccess = vi.fn();
const mockDaemonFetch = vi.fn();
const mockGetSessionTokenFromCookie = vi.fn(async () => "session-token");

vi.mock("@/server/route-guards", () => ({
  requireProxyOrgAccess: (...args: unknown[]) => mockRequireProxyOrgAccess(...args),
}));

vi.mock("@/server/ujima-daemon", () => ({
  daemonFetch: (...args: unknown[]) => mockDaemonFetch(...args),
  getSessionTokenFromCookie: () => mockGetSessionTokenFromCookie(),
}));

describe("GET /api/settings/mcps", () => {
  beforeEach(() => {
    mockRequireProxyOrgAccess.mockReset();
    mockDaemonFetch.mockReset();
  });

  it("requires organizationId", async () => {
    const response = await GET(new Request("http://localhost/api/settings/mcps"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "ERR_BAD_REQUEST",
      message: "organizationId is required.",
    });
  });

  it("forwards daemon errors with status", async () => {
    mockRequireProxyOrgAccess.mockResolvedValue(undefined);
    mockDaemonFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "ERR_NOT_FOUND", message: "Organization not found" }), {
        status: 404,
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/settings/mcps?organizationId=org-1"),
    );

    expect(mockDaemonFetch).toHaveBeenCalledWith(
      "/api/settings/mcps?organizationId=org-1",
      {},
      "session-token",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "ERR_NOT_FOUND",
      message: "Organization not found",
    });
  });
});
