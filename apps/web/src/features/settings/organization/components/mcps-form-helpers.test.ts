import { describe, expect, it } from "vitest";
import {
  formatArgsInput,
  formatSecretKeysHint,
  parseArgsInput,
  parseSecretMapInput,
} from "./mcps-form-helpers";

describe("mcps-form-helpers", () => {
  it("parses args from newlines and commas", () => {
    expect(parseArgsInput("npx\n-y, @scope/pkg")).toEqual(["npx", "-y", "@scope/pkg"]);
  });

  it("parses secret maps from KEY=value lines", () => {
    expect(parseSecretMapInput("API_KEY=abc\nTOKEN=def")).toEqual({
      API_KEY: "abc",
      TOKEN: "def",
    });
  });

  it("returns undefined for empty secret input", () => {
    expect(parseSecretMapInput("   ")).toBeUndefined();
  });

  it("formats args and secret key hints", () => {
    expect(formatArgsInput(["npx", "-y"])).toBe("npx\n-y");
    expect(formatSecretKeysHint(["API_KEY", "TOKEN"])).toBe("API_KEY=\nTOKEN=");
  });
});
