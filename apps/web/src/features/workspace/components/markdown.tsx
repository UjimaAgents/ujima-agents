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

renderer.blockquote = function ({ text }: { text: string }) {
  return `<blockquote class="my-1 border-l-2 border-zinc-300 pl-3 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">${h(text)}</blockquote>`;
};

renderer.link = function ({ href, text }: { href: string; text: string }) {
  return `<a href="${h(sanitizeUrl(href))}" class="text-violet-600 underline underline-offset-2 dark:text-violet-400" target="_blank" rel="noopener noreferrer">${h(text)}</a>`;
};

renderer.image = function () {
  return "";
};

marked.use({ gfm: true, breaks: true, renderer });

function buildMentionReplacements(text: string, mentionNames: string[]): string {
  if (!mentionNames.length) return text;
  let result = text;
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
    const parsed = marked.parse(content) as string;
    return buildMentionReplacements(parsed, mentionNames);
  }, [content, mentionNames]);

  return (
    <div
      className={`break-words text-xs leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
