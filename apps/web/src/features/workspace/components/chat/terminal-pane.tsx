import {
  TERMINAL_COMMAND_ROW,
  TERMINAL_CWD,
  TERMINAL_PANEL,
  TERMINAL_PROMPT,
  TERMINAL_SECTION,
  terminalOutputAreaClass,
} from "./terminal-chrome";

export function TerminalPane({
  className = "",
  cwd,
  commandLine,
  output,
  outputPlaceholder,
  outputTone = "default",
}: {
  className?: string;
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
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={TERMINAL_SECTION}>
        <div className={TERMINAL_CWD}>{cwd}</div>
        <div className={TERMINAL_COMMAND_ROW}>
          <span className={TERMINAL_PROMPT}>$ </span>
          <span>{commandLine}</span>
        </div>
      </div>
      {showOutputRegion ? (
        <div className={terminalOutputAreaClass(outputTone)}>
          {showBody ? trimmed : null}
          {showPlaceholder ? (
            <span className="text-foreground/45">{outputPlaceholder}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
