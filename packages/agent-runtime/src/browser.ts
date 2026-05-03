import type { UjimaEvent } from '@ujima/shared';

export interface BrowserStateSnapshot {
  url?: string;
  title?: string;
  screenshotRef?: string;
  observedAt: string;
  mcpId?: string;
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
  // If the tool looks like a navigation or observation tool, update the state.
  // This is a heuristic until we have a formal MCP 'browser' capability.
  const name = toolName.toLowerCase();
  const isBrowserTool =
    name.includes('browser') ||
    name.includes('page') ||
    name.includes('click') ||
    name.includes('type') ||
    name.includes('navigate') ||
    name.includes('screenshot');

  if (!isBrowserTool) return current;

  const next: BrowserStateSnapshot = {
    ...(current ?? {}),
    observedAt: new Date().toISOString(),
    mcpId,
  };

  // Heuristic extraction from common tool result shapes
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.url === 'string') next.url = c.url;
    if (typeof c.title === 'string') next.title = c.title;
    if (typeof c.screenshotRef === 'string') next.screenshotRef = c.screenshotRef;
  }

  // Heuristic extraction from args (e.g. goto({ url: '...' }))
  if (typeof args.url === 'string') next.url = args.url;

  return next;
}
