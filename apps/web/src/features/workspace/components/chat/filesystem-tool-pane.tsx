import {
  TERMINAL_CWD,
  TERMINAL_PANEL,
  TERMINAL_SECTION,
} from "./terminal-chrome";
import { looksLikeUnifiedDiff, UnifiedDiffView } from "./unified-diff-view";
import { ExpandableOutput } from "./expandable-output";

const MAX_BODY_CHARS = 24_384;

function unwrapResultRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.content === "string" ||
    typeof record.body === "string" ||
    typeof record.text === "string" ||
    typeof record.output === "string" ||
    typeof record.diff === "string"
  ) {
    return record;
  }
  const nested = record.result ?? record.data;
  return unwrapResultRecord(nested) ?? record;
}

function extractText(record: Record<string, unknown>): string | undefined {
  const value = record.content ?? record.body ?? record.text ?? record.output ?? record.diff;
  return typeof value === "string" && value.trim() ? value.trimEnd() : undefined;
}

function extractStringField(text: string, field: string): string | undefined {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

function extractTruncatedStringField(text: string, field: string): string | undefined {
  const marker = `"${field}"`;
  const keyIndex = text.indexOf(marker);
  if (keyIndex === -1) return undefined;
  const colonIndex = text.indexOf(":", keyIndex + marker.length);
  if (colonIndex === -1) return undefined;
  const quoteIndex = text.indexOf('"', colonIndex + 1);
  if (quoteIndex === -1) return undefined;
  const raw = text.slice(quoteIndex + 1).replace(/"\s*[},]?\s*$/, "");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(`"${raw.replace(/\\$/, "")}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function looksLikeWrappedResult(text: string): boolean {
  return /"(content|body|text|output|result|data|matches|stdout|stderr|diff)"\s*:/.test(text);
}

function extractFileContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  if (!looksLikeWrappedResult(trimmed)) return text;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = unwrapResultRecord(parsed);
    const content = record ? extractText(record) : undefined;
    return content ?? text;
  } catch {
    return (
      extractStringField(trimmed, "content") ??
      extractStringField(trimmed, "body") ??
      extractStringField(trimmed, "text") ??
      extractStringField(trimmed, "output") ??
      extractStringField(trimmed, "diff") ??
      extractTruncatedStringField(trimmed, "content") ??
      extractTruncatedStringField(trimmed, "body") ??
      extractTruncatedStringField(trimmed, "text") ??
      extractTruncatedStringField(trimmed, "output") ??
      extractTruncatedStringField(trimmed, "diff") ??
      text
    );
  }
}

function truncateBody(text: string): string {
  const t = extractFileContent(text).trimEnd();
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
  const showBody = action !== "read" && trimmed.length > 0;
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
        <ExpandableOutput>
          <div className={`${useDiffUi ? "" : "px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"} ${bodyTone === "error" ? "text-red-700 dark:text-red-300/90" : "text-foreground/85"}`}>
            {useDiffUi ? (
              <div className="px-3 pb-2 pt-2">
                <UnifiedDiffView text={trimmed} />
              </div>
            ) : (
              truncateBody(trimmed)
            )}
          </div>
        </ExpandableOutput>
      ) : null}
    </div>
  );
}
