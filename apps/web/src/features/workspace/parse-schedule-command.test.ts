import { describe, expect, it } from "vitest";
import { parseScheduleCommand } from "./parse-schedule-command";

describe("parseScheduleCommand", () => {
  it("parses five cron fields and the remaining prompt", () => {
    expect(parseScheduleCommand("/schedule 0 9 * * 1-5 Standup")).toEqual({
      cronExpression: "0 9 * * 1-5",
      prompt: "Standup",
    });
  });

  it("supports multi-word prompts", () => {
    expect(parseScheduleCommand("/schedule 0 9 * * 1-5 Run daily standup")).toEqual({
      cronExpression: "0 9 * * 1-5",
      prompt: "Run daily standup",
    });
  });

  it("rejects incomplete commands", () => {
    expect(parseScheduleCommand("/schedule 0 9 * * 1-5")).toBeNull();
    expect(parseScheduleCommand("/schedule")).toBeNull();
  });
});
