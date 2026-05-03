import type { UjimaEvent } from '@ujima/shared';

export interface BrowserStateSnapshot {
  url?: string;
  title?: string;
  screenshotRef?: string;
  observedAt: string;
  mcpId?: string;
}

type ContentPart = { type?: string; text?: string; mimeType?: string; data?: string };

function isContentPartArray(value: unknown): value is ContentPart[] {
  return Array.isArray(value) && value.every((p) => p !== null && typeof p === 'object');
}

function parseUrlTitleFromText(text: string): { url?: string; title?: string } {
  const out: { url?: string; title?: string } = {};
  const urlLine = text.match(/^\s*[-*]?\s*URL:\s*(\S+)/im);
  if (urlLine?.[1]) out.url = urlLine[1].trim();
  const titleLine = text.match(/^\s*[-*]?\s*Title:\s*(.+)$/im);
  if (titleLine?.[1]) out.title = titleLine[1].trim();
  return out;
}

/** Bare https URL with trailing punctuation stripped (e.g. closing paren). */
function extractBareUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)>\]]+/);
  if (!m?.[0]) return undefined;
  return m[0].replace(/[.,;:!?)]+$/, '');
}

function applyTextHeuristics(text: string, next: BrowserStateSnapshot): void {
  const fromLines = parseUrlTitleFromText(text);
  if (fromLines.url) next.url = fromLines.url;
  if (fromLines.title) next.title = fromLines.title;
  if (!fromLines.url) {
    const bare = extractBareUrl(text);
    if (bare) next.url = bare;
  }
}

function applyContentParts(parts: ContentPart[], next: BrowserStateSnapshot): void {
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      applyTextHeuristics(part.text, next);
    }
    if (part.type === 'image' && typeof part.mimeType === 'string' && typeof part.data === 'string') {
      next.screenshotRef = `inline-image:${part.mimeType}:${part.data}`;
    }
  }
}

/**
 * Extract browser-related metadata from tool results to keep the orchestrator
 * aware of what's happening inside the agent's viewport.
 */
export function captureBrowserState(
  toolName: string,
  args: Record<string, unknown>,
  content: unknown,
  current: BrowserStateSnapshot | undefined,
  mcpId: string,
): BrowserStateSnapshot | undefined {
  const name = toolName.toLowerCase();
  const isBrowserTool =
    name.includes('browser') ||
    name.includes('page') ||
    name.includes('click') ||
    name.includes('type') ||
    name.includes('navigate') ||
    name.includes('screenshot') ||
    name.includes('wait');

  if (!isBrowserTool) return current;

  const next: BrowserStateSnapshot = {
    ...(current ?? {}),
    observedAt: new Date().toISOString(),
    mcpId,
  };

  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.url === 'string') next.url = c.url;
    if (typeof c.title === 'string') next.title = c.title;
    if (typeof c.screenshotRef === 'string') next.screenshotRef = c.screenshotRef;
  }

  if (typeof args.url === 'string') next.url = args.url;

  if (isContentPartArray(content)) {
    applyContentParts(content, next);
  }

  return next;
}
