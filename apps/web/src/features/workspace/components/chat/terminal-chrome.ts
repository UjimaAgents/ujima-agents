/**
 * Shared Tailwind class strings for terminal-style panes.
 *
 * **Light mode:** faint violet wash (`violet-500` at low alpha) so blocks feel distinct
 * from zinc chrome without matching the heavy `border-zinc-200` cards.
 *
 * **Dark mode:** `foreground` at low alpha (same semantic as `@theme` in `globals.css`),
 * not `violet-300` on the border — that color is very light, so at ~8% opacity on
 * near-black it still reads like a white/zinc hairline while the fill disappears.
 *
 * The workspace still has a broader **zinc + white “product chrome”** pattern (sidebar,
 * headers, inputs). Terminal panes + fenced markdown use this file so trace/tool/code
 * surfaces share one look; unifying *all* chrome here would be a larger pass.
 */
export const TERMINAL_PANEL =
  "overflow-hidden rounded-lg border border-violet-500/[0.06] bg-violet-500/[0.025] text-left text-foreground dark:border-white/10 dark:bg-white/5";

export const TERMINAL_SECTION = "shrink-0";

export const TERMINAL_CWD =
  "px-3 py-1.5 font-mono text-[10px] leading-snug text-foreground/55";

export const TERMINAL_COMMAND_ROW =
  "px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground";

export const TERMINAL_PROMPT = "select-none text-foreground/45";

/** Scroll + size only (no text color); use inside structured views like unified diffs. */
export const TERMINAL_OUTPUT_SCROLL_FRAME =
  "max-h-[min(36vh,280px)] min-h-[2.5rem] overflow-y-auto overflow-x-auto overscroll-contain [-webkit-overflow-scrolling:touch]";

export function terminalOutputAreaClass(tone: "default" | "error"): string {
  const base = `${TERMINAL_OUTPUT_SCROLL_FRAME} px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap`;
  return tone === "error"
    ? `${base} text-red-700 dark:text-red-300/90`
    : `${base} text-foreground/85`;
}

/** Fenced code blocks in chat markdown: match terminal pane radius (no duplicate rounded-*). */
export const TERMINAL_MARKDOWN_PRE =
  "overflow-x-auto p-3 pt-1.5 font-mono text-sm leading-relaxed text-foreground";

export const TERMINAL_MARKDOWN_LANG_VISIBLE =
  "text-[10px] text-foreground/45 px-3 pt-2 pb-0 block";

export const TERMINAL_MARKDOWN_LANG_HIDDEN = "hidden";

/** Marked `code` renderer: escaped inner HTML only (caller must escape `text` / `lang`). */
export function markdownTerminalCodeBlockHtml(
  escapedCode: string,
  escapedLangLabel: string,
  showLang: boolean
): string {
  const langClass = showLang
    ? TERMINAL_MARKDOWN_LANG_VISIBLE
    : TERMINAL_MARKDOWN_LANG_HIDDEN;
  return (
    `<div class="my-2 ${TERMINAL_PANEL}">` +
    `<span class="${langClass}">${escapedLangLabel}</span>` +
    `<pre class="${TERMINAL_MARKDOWN_PRE}"><code class="text-inherit">${escapedCode}</code></pre>` +
    `</div>`
  );
}
