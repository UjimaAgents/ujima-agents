import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "./workspace-api";

afterEach(() => vi.unstubAllGlobals());

describe("createWorkspaceApi", () => {
  it("serializes duplicate copy options with the API field names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "ws_copy",
          root_path: "/tmp/copy",
          label: "Copy",
          created_at: 1,
          updated_at: 1,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createWorkspaceApi({
      name: "Copy",
      rootPath: "/tmp/copy",
      sourceWorkspaceId: "ws_source",
      copyOptions: {
        providerKeys: ["openai"],
        providerConfigs: true,
        agents: true,
        roles: true,
        channels: true,
        tools: true,
        policies: true,
        orgChart: true,
      },
    });

    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      copy_options: {
        provider_keys: ["openai"],
        provider_configs: true,
        org_chart: true,
      },
    });
  });
});
