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
  body,
  bodyTone = "default",
}: {
  className?: string;
  action: "read" | "write";
  resourcePath: string;
  body?: string;
  bodyTone?: "default" | "error";
}) {
  const trimmed = body?.trimEnd() ?? "";
  const showBody = trimmed.length > 0;
  const isPatchWrite = action === "write";
  const useDiffUi = isPatchWrite && looksLikeUnifiedDiff(trimmed);
  const label = action === "read" ? "Read" : "Patch";
  const badgeRead =
    "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200/95";
  const badgeWrite =
    "bg-amber-100 text-amber-900 dark:bg-amber-500/12 dark:text-amber-100/90";

  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={TERMINAL_SECTION}>
        {!(useDiffUi && showBody) ? (
          <div className={`${TERMINAL_CWD} break-all`}>{resourcePath}</div>
        ) : null}
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
          className={
            useDiffUi
              ? `${TERMINAL_OUTPUT_SCROLL_FRAME} ${bodyTone === "error" ? "ring-1 ring-inset ring-red-500/35" : ""}`
              : terminalOutputAreaClass(bodyTone)
          }
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
