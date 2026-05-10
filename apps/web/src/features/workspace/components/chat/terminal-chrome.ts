/**
 * Shared Tailwind class strings for terminal-style panes.
 * Uses `background` / `foreground` from `@theme` (see `globals.css`) so panes track
 * app theme instead of fixed zinc / hex fills.
 */
export const TERMINAL_PANEL =
  "overflow-hidden rounded-lg border border-foreground/12 bg-foreground/[0.035] text-left text-foreground shadow-sm dark:border-foreground/14 dark:bg-foreground/[0.06] dark:shadow-none";

export const TERMINAL_SECTION =
  "shrink-0 border-b border-foreground/10";

export const TERMINAL_CWD =
  "px-3 py-1.5 font-mono text-[10px] leading-snug text-foreground/55";

export const TERMINAL_COMMAND_ROW =
  "px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground";

export const TERMINAL_PROMPT = "select-none text-foreground/45";

/** Scroll + size only (no text color); use inside structured views like unified diffs. */
export const TERMINAL_OUTPUT_SCROLL_FRAME =
  "max-h-[min(36vh,280px)] min-h-[2.5rem] overflow-y-auto overflow-x-auto overscroll-contain border-t border-foreground/10 [-webkit-overflow-scrolling:touch]";

export function terminalOutputAreaClass(tone: "default" | "error"): string {
  const base = `${TERMINAL_OUTPUT_SCROLL_FRAME} px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap`;
  return tone === "error"
    ? `${base} text-red-700 dark:text-red-300/90`
    : `${base} text-foreground/85`;
}

/** Fenced code blocks that mirror relay / trace terminal snippets. */
export const TERMINAL_MARKDOWN_PRE =
  "overflow-x-auto p-3 pt-1.5 font-mono text-xs leading-relaxed text-foreground";

export const TERMINAL_MARKDOWN_LANG_VISIBLE =
  "text-[10px] text-foreground/45 px-3 pt-2 pb-0 block";

export const TERMINAL_MARKDOWN_LANG_HIDDEN = "hidden";

/** Marked `code` renderer: escaped inner HTML only (caller must escape `text` / `lang`). */
export function markdownTerminalCodeBlockHtml(
  escapedCode: string,
  escapedLangLabel: string,
  showLang: boolean,
): string {
  const langClass = showLang ? TERMINAL_MARKDOWN_LANG_VISIBLE : TERMINAL_MARKDOWN_LANG_HIDDEN;
  return (
    `<div class="my-2 rounded-xl ${TERMINAL_PANEL}">` +
    `<span class="${langClass}">${escapedLangLabel}</span>` +
    `<pre class="${TERMINAL_MARKDOWN_PRE}"><code class="text-inherit">${escapedCode}</code></pre>` +
    `</div>`
  );
}
