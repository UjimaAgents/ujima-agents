export interface BrowserStateSnapshot {
  url?: string;
  title?: string;
  screenshotRef?: string;
  observedAt: string;
  mcpId?: string;
}

interface ContentPart {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
}

function parseUrlTitleFromText(text: string): { url?: string; title?: string } {
  const out: { url?: string; title?: string } = {};
  const urlLine = text.match(/^\s*[-*]?\s*URL:\s*(\S+)/im);
  if (urlLine?.[1]) out.url = urlLine[1].trim();
  const titleLine = text.match(/^\s*[-*]?\s*Title:\s*(.+)$/im);
  if (titleLine?.[1]) out.title = titleLine[1].trim();
  return out;
}

/** Try to extract a title from common browser snapshot formats like
 * "Current page is https://example.com - Example Bar". */
function extractTitleAfterUrl(text: string): string | undefined {
  const m = text.match(/(?:current page|navigated to|page).*?https?:\/\/\S+\s*[-\u2013\u2014]\s*(.+)$/im);
  if (m?.[1]) {
    const t = m[1].trim();
    if (t.length > 0 && t.length < 200) return t;
  }
  return undefined;
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
  if (!next.title) {
    const fallbackTitle = extractTitleAfterUrl(text);
    if (fallbackTitle) next.title = fallbackTitle;
  }
}

function applyStructuredContent(
  value: unknown,
  next: BrowserStateSnapshot,
  seen = new Set<object>(),
): void {
  if (typeof value === 'string') {
    applyTextHeuristics(value, next);
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      applyStructuredContent(item, next, seen);
    }
    return;
  }

  const part = value as ContentPart & Record<string, unknown>;

  if (typeof part.url === 'string') next.url = part.url;
  if (typeof part.title === 'string') next.title = part.title;
  if (typeof part.screenshotRef === 'string') next.screenshotRef = part.screenshotRef;
  if (typeof part.text === 'string') applyTextHeuristics(part.text, next);

  if (part.type === 'image' && typeof part.mimeType === 'string' && typeof part.data === 'string') {
    // Use a reference instead of bloating the state with raw base64 data.
    // The full data is preserved in the tool audit logs.
    const refId = Math.random().toString(36).slice(2, 10);
    next.screenshotRef = `screenshot-ref:${part.mimeType}:${refId}`;
  }

  for (const [key, child] of Object.entries(part)) {
    if (key === 'url' || key === 'title' || key === 'screenshotRef' || key === 'text' || key === 'mimeType' || key === 'data' || key === 'type') {
      continue;
    }
    applyStructuredContent(child, next, seen);
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

  applyStructuredContent(content, next);

  if (typeof args.url === 'string') next.url = args.url;

  return next;
}
