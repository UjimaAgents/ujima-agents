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

  it("correctly renders GFM tables", () => {
    const content = `
| Header 1 | Header 2 |
|---|---|
| Cell 1 | Cell 2 |
`.trim();
    const html = renderMarkdown(content, []);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>Header 1</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Cell 1</td>");
  });

  it("correctly renders premium images", () => {
    const content = '![logo](https://example.com/logo.png "Title")';
    const html = renderMarkdown(content, []);
    expect(html).toContain('<img src="https://example.com/logo.png" alt="logo" title="Title"');
    expect(html).toContain('class="max-w-full my-4 rounded-lg border border-foreground/10 bg-foreground/5 shadow-sm inline-block"');
  });

  it("escapes raw HTML from model output", () => {
    const content = '<details><summary>Click me</summary><a href="javascript:alert(1)">x</a></details>';
    const html = renderMarkdown(content, []);
    expect(html).not.toContain("<details>");
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain("&lt;details&gt;");
    expect(html).toContain("&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;");
  });
});
