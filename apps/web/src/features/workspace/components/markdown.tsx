import { useMemo } from "react";
import { marked } from "marked";

const SAFE_URL_PROTOCOLS = /^(https?:|mailto:)/i;
const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function h(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPE[ch]);
}

function sanitizeUrl(href: unknown): string {
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
    const language = lang ? `text-[10px] text-zinc-400 px-3 pt-2 pb-0 block` : "hidden";
    return (
      `<div class="my-2 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800 dark:bg-black">` +
      `<span class="${language}">${h(lang ?? "")}</span>` +
      `<pre class="overflow-x-auto p-3 pt-1.5 text-xs leading-relaxed"><code class="text-zinc-100 dark:text-zinc-100">${h(text)}</code></pre>` +
      `</div>`
    );
  };

  renderer.codespan = function ({ text }: { text: string }) {
    return `<code class="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-zinc-800 dark:text-violet-300">${h(text)}</code>`;
  };

  renderer.blockquote = function ({ tokens }: { tokens: unknown[] }) {
    return `<blockquote class="my-1 border-l-2 border-zinc-300 pl-3 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">${this.parser.parse(tokens as never)}</blockquote>`;
  };

  renderer.link = function ({ href, tokens }: { href: string; tokens: unknown[] }) {
    return `<a href="${h(sanitizeUrl(href))}" class="text-violet-600 underline underline-offset-2 dark:text-violet-400" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens as never)}</a>`;
  };

  renderer.image = function () {
    return "";
  };

  renderer.text = function ({ text }: { text: string }) {
    return highlightMentions(text, mentionNames);
  };

  return renderer;
}

function highlightMentions(text: string, mentionNames: string[]): string {
  let result = h(text);
  if (!mentionNames.length) return result;
  for (const name of mentionNames) {
    result = result.replace(
      new RegExp(`(?<!\\w)@(${escapeRegex(name)})(?=\\s|[^\\w]|$)`, 'g'),
      `<span class="font-semibold text-zinc-900 dark:text-white">@$1</span>`,
    );
  }
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const html = useMemo(() => {
    return marked.parse(content, { gfm: true, breaks: true, renderer: createRenderer(mentionNames) }) as string;
  }, [content, mentionNames]);

  return (
    <div
      className={`break-words text-xs leading-relaxed ${className}`}
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
    return marked.parseInline(content, {
      gfm: true,
      renderer: createRenderer(mentionNames),
    }) as string;
  }, [content, mentionNames]);

  return (
    <span
      className={`break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
