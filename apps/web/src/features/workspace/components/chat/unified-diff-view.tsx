import { useMemo } from "react";

const MAX_CHARS = 24_384;

type PatchLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

function classifyPatchLine(line: string): PatchLineKind {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("Index: ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("Binary files ") ||
    line.startsWith("\\")
  ) {
    return "meta";
  }
  if (line.startsWith("---") || line.startsWith("+++")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

function rowClasses(kind: PatchLineKind): string {
  switch (kind) {
    case "add":
      return "border-l-2 border-emerald-600/25 bg-emerald-500/[0.03] text-foreground/90 dark:border-emerald-400/20 dark:bg-emerald-400/[0.05]";
    case "del":
      return "border-l-2 border-red-600/25 bg-red-500/[0.03] text-foreground/90 dark:border-red-400/20 dark:bg-red-400/[0.05]";
    case "hunk":
      return "border-l-2 border-foreground/12 bg-foreground/[0.04] text-foreground/70";
    case "meta":
      return "border-l-2 border-transparent text-foreground/45";
    default:
      return "border-l-2 border-transparent text-foreground/[0.82]";
  }
}

function prepareLines(text: string): string[] {
  const t = text.trimEnd();
  if (t.length <= MAX_CHARS) return t.split("\n");
  const head = t.slice(0, MAX_CHARS);
  const lastNl = head.lastIndexOf("\n");
  const cut = lastNl > 0 ? head.slice(0, lastNl) : head;
  return [...cut.split("\n"), "… (truncated)"];
}

/** Heuristic: show structured diff only when body looks like a unified patch. */
export function looksLikeUnifiedDiff(text: string): boolean {
  if (/(^|\n)@@/.test(text)) return true;
  if (/---[^\n]*\n\+\+\+/.test(text)) return true;
  return false;
}

export function UnifiedDiffView({ text }: { text: string }) {
  const lines = useMemo(() => prepareLines(text), [text]);

  return (
    <div className="min-w-0 font-mono text-[11px] leading-[1.45]">
      {lines.map((line, i) => {
        const kind = line === "… (truncated)" ? "meta" : classifyPatchLine(line);
        const display = line.length === 0 ? " " : line;
        const n = i + 1;
        return (
          <div
            key={i}
            className={`grid grid-cols-[2rem_1fr] gap-x-0 border-b border-foreground/[0.04] last:border-b-0 sm:grid-cols-[2.25rem_1fr] ${rowClasses(kind)}`}
          >
            <span className="shrink-0 border-r border-foreground/[0.06] py-0.5 pr-1.5 pl-1 text-right tabular-nums text-foreground/35">
              {n}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-all py-0.5 pr-3 pl-1.5">{display}</span>
          </div>
        );
      })}
    </div>
  );
}
