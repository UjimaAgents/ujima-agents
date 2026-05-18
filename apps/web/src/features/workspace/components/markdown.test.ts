import { describe, expect, it } from "vitest";
import { findSafeMarkdownBoundary, renderMarkdown, renderStreamingMarkdown } from "./markdown";

describe("markdown streaming renderer", () => {
  it("finds a safe boundary after a blank-line paragraph break", () => {
    expect(findSafeMarkdownBoundary("alpha\n\nbeta")).toBeGreaterThan(0);
  });

  it("avoids cutting through fenced code blocks", () => {
    expect(findSafeMarkdownBoundary("alpha\n\n```ts\nconst x = 1;\n```\n\nbeta")).toBeGreaterThan(0);
  });

  it("matches the full render for streamed extensions at safe boundaries", () => {
    const mentionNames = ["Ava"];
    const prefix = "Hello @Ava\n\nThis is a paragraph.";
    const content = `${prefix}\n\nMore text with **bold** and ` + "`code`";

    renderStreamingMarkdown(prefix, mentionNames);

    expect(renderStreamingMarkdown(content, mentionNames)).toBe(renderMarkdown(content, mentionNames));
  });
});
