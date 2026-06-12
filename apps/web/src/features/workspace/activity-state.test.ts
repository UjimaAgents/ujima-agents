import { describe, expect, it } from "vitest";
import { conversationActivityState, runStatusToActivityState } from "./activity-state";

describe("activity-state", () => {
  it("treats waiting_for_input as working and failures as error", () => {
    expect(runStatusToActivityState("waiting_for_input", "offline")).toBe("working");
    expect(runStatusToActivityState("failed", "online")).toBe("error");
    expect(runStatusToActivityState("completed", "offline")).toBe("offline");
  });

  it("keeps active conversations working while a run waits for input", () => {
    expect(
      conversationActivityState({
        loading: false,
        activeRun: { status: "waiting_for_input" },
        presence: "offline",
      }),
    ).toBe("working");
  });
});
