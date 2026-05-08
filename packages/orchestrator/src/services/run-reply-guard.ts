/**
 * Tools that already persist a user-visible reply in the conversation thread.
 * When the model uses one of these, RunService must not also publish the final
 * assistant `text` as a separate message (avoids double replies / ping-pong).
 */
const THREAD_PUBLISHING_TOOL_NAMES = new Set([
  'message',
  'channel.dm',
  'channel.reply',
  'channel.post',
]);

function collectToolNamesFromList(list: unknown, out: Set<string>): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as { toolName?: unknown }).toolName;
    if (typeof name === 'string' && name.length > 0) {
      out.add(name);
    }
  }
}

/**
 * Returns true when the generateText result already delivered content via a
 * channel/message tool that writes to the thread.
 */
export function runUsedThreadPublishingTool(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  const root = result as Record<string, unknown>;
  const names = new Set<string>();
  collectToolNamesFromList(root.toolResults, names);
  const steps = root.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const s = step as Record<string, unknown>;
      collectToolNamesFromList(s.toolResults, names);
      collectToolNamesFromList(s.toolCalls, names);
    }
  }
  for (const name of names) {
    if (THREAD_PUBLISHING_TOOL_NAMES.has(name)) {
      return true;
    }
  }
  return false;
}
