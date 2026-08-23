import { Terminal } from "lucide-react";
import {
  TERMINAL_COMMAND_ROW,
  TERMINAL_CWD,
  TERMINAL_PROMPT,
} from "./terminal-chrome";
import { ExpandableOutput } from "./expandable-output";
import { ToolPane } from "./primitives";

export function TerminalPane({
  className = "",
  cwd,
  commandLine,
  output,
  outputPlaceholder,
  outputTone = "default",
  storageKey,
}: {
  className?: string;
  /** Stable identity — keeps expand/collapse state across virtualized unmounts. */
  storageKey?: string;
  cwd: string;
  /** Command without leading `$`; the pane renders the prompt. */
  commandLine: string;
  /** Captured stdout/stderr (or error text). */
  output?: string;
  /** Shown when `output` is empty (e.g. pending approval or in-flight tool). */
  outputPlaceholder?: string;
  outputTone?: "default" | "error";
}) {
  const trimmed = output?.trim() ?? "";
  const showBody = trimmed.length > 0;
  const showPlaceholder = !showBody && (outputPlaceholder?.length ?? 0) > 0;
  const showOutputRegion = showBody || showPlaceholder;

  return (
    <ToolPane
      header={
        <>
          <div className={`${TERMINAL_CWD} flex items-center gap-1.5`}>
            <Terminal className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
            <span>{cwd}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(commandLine);
            }}
            className={`${TERMINAL_COMMAND_ROW} group/cmd flex items-start gap-1.5 text-left transition-colors hover:text-violet-600 dark:hover:text-violet-400`}
            title="Click to copy command"
          >
            <span className={TERMINAL_PROMPT}>$ </span>
            <span className="break-all">{commandLine}</span>
          </button>
        </>
      }
    >
      {showOutputRegion ? (
        <ExpandableOutput storageKey={storageKey}>
          <div
            className={`px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
              outputTone === "error"
                ? "text-red-700 dark:text-red-300/90"
                : "text-foreground/85"
            }`}
          >
            {showBody ? trimmed : null}
            {showPlaceholder ? (
              <span className="text-foreground/45">{outputPlaceholder}</span>
            ) : null}
          </div>
        </ExpandableOutput>
      ) : null}
    </ToolPane>
  );
}
