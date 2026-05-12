import { describe, expect, it } from "vitest";
import { getExactSlashCommand, getSlashQuery } from "./chat-input";

describe("chat-input slash commands", () => {
  it("recognizes exact slash commands only", () => {
    expect(getExactSlashCommand("/summarize")).toBe("summarize");
    expect(getExactSlashCommand(" /clear ")).toBe("clear");
    expect(getExactSlashCommand("/clear extra")).toBeNull();
    expect(getExactSlashCommand("hello")).toBeNull();
  });

  it("only opens the slash palette for a single command token", () => {
    expect(getSlashQuery("/")).toBe("");
    expect(getSlashQuery("/s")).toBe("s");
    expect(getSlashQuery(" /clear")).toBe("clear");
    expect(getSlashQuery("/clear ")).toBeNull();
    expect(getSlashQuery("/clear more")).toBeNull();
    expect(getSlashQuery("hello")).toBeNull();
  });
});
