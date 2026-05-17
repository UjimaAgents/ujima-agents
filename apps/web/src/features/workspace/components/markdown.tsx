import { useMemo } from "react";
import { marked } from "marked";
import { markdownTerminalCodeBlockHtml } from "./chat/terminal-chrome";

const SAFE_URL_PROTOCOLS = /^(https?:|mailto:)/i;
const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function h(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPE[ch]);
}

export function sanitizeUrl(href: unknown): string {
  if (typeof href !== "string") return "";
  if (SAFE_URL_PROTOCOLS.test(href)) return href;
  return "";
}

function createRenderer(mentionNames: string[]) {
  const renderer = new marked.Renderer();

  renderer.html = function () {
    return "";
  };

  renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
    return markdownTerminalCodeBlockHtml(h(text), h(lang ?? ""), Boolean(lang));
  };

  renderer.codespan = function ({ text }: { text: string }) {
    return `<code class="rounded-md bg-foreground/10 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">${h(text)}</code>`;
  };

  renderer.blockquote = function ({ tokens }: { tokens: unknown[] }) {
    return `<blockquote class="my-1 border-l-2 border-foreground/18 pl-3 text-foreground/60">${this.parser.parse(tokens as never)}</blockquote>`;
  };

  renderer.link = function ({ href, tokens }: { href: string; tokens: unknown[] }) {
    return `<a href="${h(sanitizeUrl(href))}" class="text-violet-600 underline underline-offset-2 dark:text-violet-400" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens as never)}</a>`;
  };

  renderer.image = function () {
    return "";
  };

  renderer.text = function ({ text }: { text: string }) {
    return renderInlineMarkdown(text, mentionNames);
  };

  return renderer;
}

export function highlightMentions(text: string, mentionNames: string[]): string {
  if (!mentionNames.length) return h(text);
  const uniqueNames = [...new Set(mentionNames.filter((name) => name.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (!uniqueNames.length) return h(text);
  const mentionPattern = new RegExp(
    `(^|[^@\\w])@(${uniqueNames.map((name) => escapeRegex(name)).join("|")})(?=\\s|[^\\w]|$)`,
    "g",
  );

  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(text))) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const matchStart = match.index;
    const mentionStart = matchStart + prefix.length;
    const mentionEnd = mentionStart + 1 + name.length;
    result += h(text.slice(cursor, matchStart));
    result += h(prefix);
    result += `<span class="font-semibold text-foreground">@${h(name)}</span>`;
    cursor = mentionEnd;
  }
  result += h(text.slice(cursor));
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripScriptTags(content: string): string {
  return content
    .replace(/<script\b[^>]*>/gi, "&lt;script&gt;")
    .replace(/<\/script>/gi, "&lt;/script&gt;");
}

export function renderMarkdown(content: string, mentionNames: string[]): string {
  return marked.parse(stripScriptTags(content), {
    gfm: true,
    breaks: true,
    renderer: createRenderer(mentionNames),
  }) as string;
}

interface StreamingMarkdownCache {
  content: string;
  prefix: string;
  prefixHtml: string;
}

const streamingMarkdownCaches = new Map<string, StreamingMarkdownCache>();

function joinRenderedFragments(prefix: string, trail: string): string {
  const left = prefix.trimEnd();
  const right = trail.trimStart();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n${right}`;
}

function isBlankLine(line: string): boolean {
  return /^\s*$/.test(line);
}

export function findSafeMarkdownBoundary(content: string): number {
  if (!content) return -1;

  const lines = content.split("\n");
  let offset = 0;
  let boundary = -1;
  let fenceCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineLen = line.length;
    if (/^\s*```/.test(line)) fenceCount += 1;
    if (isBlankLine(line) && fenceCount % 2 === 0) {
      const prev = lines[i - 1] ?? "";
      const next = lines[i + 1] ?? "";
      const trimmedPrev = prev.trim();
      const trimmedNext = next.trim();
      const endsWithHazard =
        /^\s*([-*+]|\d+\.)\s/.test(prev) ||
        /^\s*>/.test(prev) ||
        /^\s{4,}\S/.test(prev) ||
        /^\s*[|:\s-]*\|[|:\s-]*$/.test(prev) ||
        /^=+\s*$/.test(prev) ||
        /^-+\s*$/.test(prev);
      const nextIsSetextUnderline = /^=+\s*$/.test(trimmedNext) || /^-+\s*$/.test(trimmedNext);
      if (!endsWithHazard && !nextIsSetextUnderline && trimmedPrev.length > 0) {
        boundary = offset + lineLen + 1;
      }
    }
    offset += lineLen + 1;
  }

  return boundary;
}

export function renderStreamingMarkdown(
  content: string,
  mentionNames: string[],
): string {
  const mentionKey = mentionNames.join("\u0000");
  const cache = streamingMarkdownCaches.get(mentionKey) ?? {
    content: "",
    prefix: "",
    prefixHtml: "",
  };
  if (!streamingMarkdownCaches.has(mentionKey)) {
    streamingMarkdownCaches.set(mentionKey, cache);
  }

  if (!content.startsWith(cache.content)) {
    cache.content = "";
    cache.prefix = "";
    cache.prefixHtml = "";
  }

  const boundary = findSafeMarkdownBoundary(content);
  if (boundary < 0) {
    cache.content = content;
    cache.prefix = "";
    cache.prefixHtml = "";
    return renderMarkdown(content, mentionNames);
  }

  const prefix = content.slice(0, boundary);
  const trail = content.slice(boundary);
  if (prefix === cache.prefix && content.startsWith(cache.content)) {
    const prefixHtml = cache.prefixHtml;
    const trailHtml = trail ? renderMarkdown(trail, mentionNames) : "";
    cache.content = content;
    return trailHtml ? joinRenderedFragments(prefixHtml, trailHtml) : prefixHtml;
  }

  const prefixHtml = renderMarkdown(prefix, mentionNames);
  const trailHtml = trail ? renderMarkdown(trail, mentionNames) : "";
  streamingMarkdownCaches.set(mentionKey, {
    content,
    prefix,
    prefixHtml,
  });
  return trailHtml ? joinRenderedFragments(prefixHtml, trailHtml) : prefixHtml;
}

function renderInlineMarkdown(text: string, mentionNames: string[]): string {
  const withMentions = highlightMentions(text, mentionNames);
  return withMentions
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])\*([^*\n]+?)\*(?=[^\w]|$)/g, "$1<em>$2</em>");
}

export function Markdown({
  content,
  mentionNames = [],
  className = "",
}: {
  content: string;
  mentionNames?: string[];
  className?: string;
}) {
  const html = renderStreamingMarkdown(content, mentionNames);

  return (
    <div
      className={`min-w-0 break-words text-sm leading-7 text-foreground [overflow-wrap:anywhere]
        [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0
        [&>h1]:mt-5 [&>h1]:mb-2 [&>h1]:text-xl [&>h1]:font-semibold [&>h1]:leading-tight
        [&>h2]:mt-4 [&>h2]:mb-2 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:leading-tight
        [&>h3]:mt-3 [&>h3]:mb-1.5 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:leading-tight
        [&>h4]:mt-3 [&>h4]:mb-1.5 [&>h4]:text-sm [&>h4]:font-semibold [&>h4]:leading-tight
        [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal
        [&_li]:my-0.5 [&_li]:pl-0 [&_li]:leading-7 [&_li>p]:my-0 [&_li>p]:inline
        [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_li>ul]:pl-5 [&_li>ol]:pl-5
        [&_input[type='checkbox']]:mr-2 [&_input[type='checkbox']]:align-text-bottom
        [&>hr]:my-3 [&>hr]:border-foreground/20
        [&_strong]:font-semibold [&_em]:italic [&_a]:underline [&_a]:underline-offset-2 [&_code]:break-words
        ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MarkdownInline({
  content,
  mentionNames = [],
  className = "",
}: {
  content: string;
  mentionNames?: string[];
  className?: string;
}) {
  const html = useMemo(() => {
    return marked.parseInline(stripScriptTags(content), {
      gfm: true,
      renderer: createRenderer(mentionNames),
    }) as string;
  }, [content, mentionNames]);

  return (
    <span
      className={`break-words text-foreground [overflow-wrap:anywhere] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
