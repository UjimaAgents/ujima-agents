/**
 * Pulls provider reasoning / "thinking" text from AI SDK results or step objects
 * so we can persist it on {@link Message} and echo it on the next model call.
 */
export function extractReasoningChunk(source: unknown): string | undefined {
  if (source == null || typeof source !== "object") return undefined;
  const s = source as Record<string, unknown>;

  const reasoningText = s.reasoningText;
  if (typeof reasoningText === "string" && reasoningText.trim()) {
    return reasoningText.trim();
  }

  const r = s.reasoning;
  if (typeof r === "string" && r.trim()) {
    return r.trim();
  }
  if (Array.isArray(r)) {
    const parts: string[] = [];
    for (const item of r) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
        continue;
      }
      if (item && typeof item === "object" && "text" in item) {
        const t = (item as { text?: unknown }).text;
        if (typeof t === "string" && t.trim()) parts.push(t.trim());
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }

  // `generateText` may only attach reasoning on each `steps[i]` entry.
  const steps = s.steps;
  if (Array.isArray(steps)) {
    const parts: string[] = [];
    for (const step of steps) {
      const chunk = extractReasoningChunk(step);
      if (chunk) parts.push(chunk);
    }
    if (parts.length > 0) return parts.join("\n\n");
  }

  return undefined;
}
