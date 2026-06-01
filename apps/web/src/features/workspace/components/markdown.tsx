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

  renderer.html = function ({ text }: { text: string }) {
    const tagRegex = /(<\/?[a-zA-Z0-9]+(?:\s+[^>]*?)?>)/g;
    const allowedTags = new Set([
      'br', 'kbd', 'sub', 'sup', 'details', 'summary',
      'p', 'div', 'span', 'code', 'pre', 'a', 'strong', 'em',
      'ul', 'ol', 'li'
    ]);

    return text.replace(tagRegex, (match) => {
      const tagNameMatch = match.match(/^<\/?([a-zA-Z0-9]+)/);
      if (tagNameMatch) {
        const tagName = tagNameMatch[1]?.toLowerCase();
        if (tagName && allowedTags.has(tagName)) {
          return match;
        }
      }
      return h(match);
    });
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

  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const safeUrl = sanitizeUrl(href);
    if (!safeUrl) return "";
    return `<img src="${h(safeUrl)}" alt="${h(text)}" ${title ? `title="${h(title)}"` : ""} class="max-w-full my-4 rounded-lg border border-foreground/10 bg-foreground/5 shadow-sm inline-block" />`;
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
        [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
        [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-tight
        [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-tight
        [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight
        [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:leading-tight
        [&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-xs [&_h5]:font-semibold [&_h5]:leading-tight [&_h5]:uppercase [&_h5]:tracking-wider
        [&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:leading-tight [&_h6]:text-foreground/60
        [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal
        [&_li]:my-0.5 [&_li]:pl-0 [&_li]:leading-7 [&_li>p]:my-0 [&_li>p]:inline
        [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_li>ul]:pl-5 [&_li>ol]:pl-5
        [&_input[type='checkbox']]:mr-2 [&_input[type='checkbox']]:align-text-bottom
        [&_hr]:my-3 [&_hr]:border-foreground/20
        [&_strong]:font-semibold [&_em]:italic [&_a]:underline [&_a]:underline-offset-2 [&_code]:break-words
        [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:text-xs [&_kbd]:font-semibold [&_kbd]:bg-foreground/5 [&_kbd]:border [&_kbd]:border-foreground/15 [&_kbd]:rounded-md [&_kbd]:shadow-sm
        [&_table]:w-full [&_table]:my-4 [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs sm:[&_table]:text-sm
        [&_thead]:bg-foreground/5 [&_thead]:font-semibold [&_thead]:text-foreground
        [&_th]:px-4 [&_th]:py-2.5 [&_th]:border [&_th]:border-foreground/10 [&_th]:font-semibold [&_th]:align-bottom
        [&_td]:px-4 [&_td]:py-2.5 [&_td]:border [&_td]:border-foreground/10 [&_td]:align-middle
        [&_tr]:even:bg-foreground/[0.015] [&_tr]:hover:bg-foreground/[0.03]
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
