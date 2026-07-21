import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHistory } from "./use-conversation-sync";

afterEach(() => vi.unstubAllGlobals());

function message(id: string, createdAt: string) {
  return {
    id,
    organizationId: "org-1",
    threadId: "thread-1",
    senderId: "member-1",
    senderKind: "human",
    kind: "human",
    content: id,
    mentions: [],
    toolCalls: [],
    attachments: [],
    createdAt,
  };
}

describe("loadHistory", () => {
  it("loads every cursor page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [message("newer", "2026-07-18T01:00:00.000Z")],
            hasMore: true,
            nextCursor: "page-2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [message("older", "2026-07-18T00:00:00.000Z")], hasMore: false }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadHistory("org-1", "thread-1", new AbortController().signal);

    expect(result.map((item) => item.id)).toEqual(["older", "newer"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("cursor=");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=page-2");
  });
});
