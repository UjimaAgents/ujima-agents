import {
  TERMINAL_CWD,
  TERMINAL_OUTPUT_SCROLL_FRAME,
  TERMINAL_PANEL,
  TERMINAL_SECTION,
  terminalOutputAreaClass,
} from "./terminal-chrome";
import { looksLikeUnifiedDiff, UnifiedDiffView } from "./unified-diff-view";

const MAX_BODY_CHARS = 24_384;

function truncateBody(text: string): string {
  const t = text.trimEnd();
  if (t.length <= MAX_BODY_CHARS) return t;
  return `${t.slice(0, MAX_BODY_CHARS)}\n\n… (truncated)`;
}

export function FilesystemToolPane({
  className = "",
  action,
  resourcePath,
  meta,
  body,
  bodyTone = "default",
}: {
  className?: string;
  action: "read" | "write";
  resourcePath: string;
  meta?: string;
  body?: string;
  bodyTone?: "default" | "error";
}) {
  const trimmed = body?.trimEnd() ?? "";
  const showBody = trimmed.length > 0;
  const isPatchWrite = action === "write";
  const useDiffUi = isPatchWrite && looksLikeUnifiedDiff(trimmed);
  const label = action === "read" ? "Read" : "Patch";
  const badgeRead =
    "bg-sky-500/[0.08] text-sky-900/90 dark:bg-sky-400/[0.1] dark:text-sky-200/85";
  const badgeWrite =
    "bg-foreground/[0.06] text-foreground/75 dark:bg-foreground/[0.08] dark:text-foreground/80";

  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={TERMINAL_SECTION}>
        <div className={`${TERMINAL_CWD} break-all`}>{resourcePath}</div>
        {meta ? <div className="px-3 pb-0.5 font-mono text-[10px] text-foreground/45">{meta}</div> : null}
        <div className="px-3 py-2">
          <span
            className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide ${action === "read" ? badgeRead : badgeWrite}`}
          >
            {label}
          </span>
        </div>
      </div>
      {showBody ? (
        <div
          className={`${
            useDiffUi
              ? `${TERMINAL_OUTPUT_SCROLL_FRAME} ${bodyTone === "error" ? "bg-red-500/[0.04]" : ""}`
              : terminalOutputAreaClass(bodyTone)
          } animate-in`}
        >
          {useDiffUi ? (
            <div className="px-3 pb-2 pt-2">
              <UnifiedDiffView text={trimmed} />
            </div>
          ) : (
            truncateBody(trimmed)
          )}
        </div>
      ) : null}
    </div>
  );
}
