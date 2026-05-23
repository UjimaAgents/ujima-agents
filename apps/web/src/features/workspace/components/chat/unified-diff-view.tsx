import { useMemo } from "react";

const MAX_CHARS = 24_384;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)?\s+@@/;

type PatchLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

export type UnifiedDiffRow = {
  text: string;
  kind: PatchLineKind;
  /** File line number for this row, or null for headers / meta lines. */
  gutter: number | null;
};

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

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = HUNK_HEADER_RE.exec(line);
  if (!match) return null;
  return { oldStart: Number(match[1]), newStart: Number(match[2]) };
}

function prepareLines(text: string): string[] {
  const t = text.trimEnd();
  if (t.length <= MAX_CHARS) return t.split("\n");
  const head = t.slice(0, MAX_CHARS);
  const lastNl = head.lastIndexOf("\n");
  const cut = lastNl > 0 ? head.slice(0, lastNl) : head;
  return [...cut.split("\n"), "… (truncated)"];
}

/** Map unified diff text to display rows with file-accurate gutter numbers. */
export function buildUnifiedDiffRows(text: string): UnifiedDiffRow[] {
  const rawLines = prepareLines(text);
  let oldLine = 0;
  let newLine = 0;
  let sequentialLine = 0;
  let hasHunkOffsets = false;
  const rows: UnifiedDiffRow[] = [];

  for (const line of rawLines) {
    if (line === "… (truncated)") {
      rows.push({ text: line, kind: "meta", gutter: null });
      continue;
    }

    const kind = classifyPatchLine(line);

    if (kind === "hunk") {
      const header = parseHunkHeader(line);
      if (header) {
        oldLine = header.oldStart;
        newLine = header.newStart;
        hasHunkOffsets = true;
        sequentialLine = 0;
      }
      rows.push({ text: line, kind, gutter: null });
      continue;
    }

    if (kind === "meta") {
      rows.push({ text: line, kind, gutter: null });
      continue;
    }

    let gutter: number;
    if (!hasHunkOffsets) {
      sequentialLine += 1;
      gutter = sequentialLine;
    } else if (line.startsWith("+")) {
      gutter = newLine;
      newLine += 1;
    } else if (line.startsWith("-")) {
      gutter = oldLine;
      oldLine += 1;
    } else {
      gutter = newLine;
      oldLine += 1;
      newLine += 1;
    }

    rows.push({ text: line, kind, gutter });
  }

  return rows;
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

/** Heuristic: show structured diff only when body looks like a unified patch. */
export function looksLikeUnifiedDiff(text: string): boolean {
  if (/(^|\n)@@/.test(text)) return true;
  if (/---[^\n]*\n\+\+\+/.test(text)) return true;
  return false;
}

export function UnifiedDiffView({ text }: { text: string }) {
  const rows = useMemo(() => buildUnifiedDiffRows(text), [text]);

  return (
    <div className="min-w-0 font-mono text-[11px] leading-[1.45]">
      {rows.map((row, i) => {
        const display = row.text.length === 0 ? " " : row.text;
        return (
          <div
            key={i}
            className={`grid grid-cols-[2rem_1fr] gap-x-0 border-b border-foreground/[0.04] last:border-b-0 sm:grid-cols-[2.25rem_1fr] ${rowClasses(row.kind)}`}
          >
            <span className="shrink-0 border-r border-foreground/[0.06] py-0.5 pr-1.5 pl-1 text-right tabular-nums text-foreground/35">
              {row.gutter ?? ""}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-all py-0.5 pr-3 pl-1.5">{display}</span>
          </div>
        );
      })}
    </div>
  );
}
