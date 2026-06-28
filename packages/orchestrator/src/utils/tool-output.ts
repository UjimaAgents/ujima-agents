import { extractTruncatedJsonString } from "@ujima/shared";

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function formatMatches(matches: unknown): string | undefined {
  if (!Array.isArray(matches)) return undefined;
  if (matches.every((entry) => typeof entry === "string")) {
    const lines = matches.map((entry) => String(entry)).filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : undefined;
  }
  const lines = matches
    .map((entry) => {
      const item = toObject(entry);
      const path = typeof item?.path === "string" ? item.path : "";
      const lineNumber = typeof item?.lineNumber === "number" ? item.lineNumber : 0;
      const line = typeof item?.line === "string" ? item.line : "";
      if (!path || !lineNumber) return "";
      return `${path}:${lineNumber}${line ? `: ${line}` : ""}`;
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatStringArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.map((entry) => (typeof entry === "string" ? entry : "")).filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
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

function formatRecord(value: unknown): string | undefined {
  const record = toObject(value);
  if (!record) return undefined;

  const content = record.content ?? record.body ?? record.text ?? record.output;
  if (typeof content === "string" && content.trim()) return content.trimEnd();

  const diff = record.diff;
  if (typeof diff === "string" && diff.trim()) return diff.trimEnd();

  const matches = formatMatches(record.matches);
  if (matches) return matches;

  const entries = formatStringArray(record.entries);
  if (entries) return entries;

  const results = formatStringArray(record.results);
  if (results) return results;

  const stdout = typeof record.stdout === "string" ? record.stdout.trimEnd() : "";
  const stderr = typeof record.stderr === "string" ? record.stderr.trimEnd() : "";
  if (stdout || stderr) {
    return [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }

  const nested = toObject(record.result) ?? toObject(record.data);
  return nested ? formatRecord(nested) : undefined;
}

export function formatReadableToolOutput(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (!text.startsWith("{") && !text.startsWith("[")) return value;
    try {
      return formatReadableToolOutput(JSON.parse(text) as unknown);
    } catch {
      return (
        extractStringField(text, "content") ??
        extractStringField(text, "body") ??
        extractStringField(text, "text") ??
        extractStringField(text, "output") ??
        extractStringField(text, "diff") ??
        extractTruncatedJsonString(text, "content") ??
        extractTruncatedJsonString(text, "body") ??
        extractTruncatedJsonString(text, "text") ??
        extractTruncatedJsonString(text, "output") ??
        extractTruncatedJsonString(text, "diff") ??
        value
      );
    }
  }

  return formatRecord(value);
}

export function wrapAttachmentCapture(
  output: unknown,
  attachmentRefs: string[],
): Record<string, unknown> {
  const wrapped: Record<string, unknown> =
    output && typeof output === 'object' && !Array.isArray(output)
      ? { ...(output as Record<string, unknown>) }
      : { value: output };
  wrapped.attachment_refs = attachmentRefs;
  wrapped._attachment_capture_note =
    `${attachmentRefs.length} attachment(s) from this tool result ` +
    `have been captured and are ready to attach to a chat message. ` +
    `Use the refs in \`attachment_refs\` with channel.reply / channel.post / ` +
    `channel.dm via { refType: "tool_call", value: "<ref>" }. ` +
    `Do NOT save these bytes to disk first.`;
  return wrapped;
}
