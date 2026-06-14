export function normalizeMentionHandle(value: string): string {
  return value.trim().toLowerCase();
}

export interface MentionHandleRegistry {
  /** Longest-handle-first sort order for matching. */
  sortedHandles: readonly string[];
  resolveHandle(handle: string): string | undefined;
}

export interface ScanMentionsOptions {
  /** When true and body contains a standalone @all, invoke `onAll` instead of per-handle matching. */
  allowAll?: boolean;
  onAll?: () => void;
  /** When set, @all matches are skipped (e.g. DM threads). */
  skipAllInDm?: boolean;
}

/**
 * Walks @-mentions in message content using longest-handle-first matching.
 * Shared by server id resolution and display-name resolution.
 */
export function scanMentionsInContent(
  content: string,
  registry: MentionHandleRegistry,
  options: ScanMentionsOptions = {},
): void {
  const mentionStartRegex = /(?:^|[^@\w])@/g;

  for (const match of content.matchAll(mentionStartRegex)) {
    const startIndex = (match.index ?? 0) + match[0].length;
    const remaining = content.slice(startIndex).toLowerCase();

    if (options.allowAll && options.onAll && remaining.startsWith('all')) {
      const nextChar = remaining[3];
      if (!nextChar || !/\w/.test(nextChar)) {
        if (!options.skipAllInDm) {
          options.onAll();
        }
        continue;
      }
    }

    for (const handle of registry.sortedHandles) {
      if (!remaining.startsWith(handle)) continue;
      const nextChar = remaining[handle.length];
      if (!nextChar || !/\w/.test(nextChar)) {
        registry.resolveHandle(handle);
        break;
      }
    }
  }
}

export const ASSET_REF_PATTERN = /@(file|folder|mcp|skill|task|culture):([^\s)}\]">]+)/g;

export function decodeAssetReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function scanAssetReferences(
  content: string,
): { kind: string; path: string }[] {
  const refs: { kind: string; path: string }[] = [];
  let match: RegExpExecArray | null;
  ASSET_REF_PATTERN.lastIndex = 0;
  while ((match = ASSET_REF_PATTERN.exec(content))) {
    const kind = match[1];
    const path = match[2];
    if (!kind || !path) continue;
    refs.push({ kind, path: decodeAssetReference(path) });
  }
  return refs;
}

export function buildMentionHandleRegistry(
  entries: Iterable<{ handle: string; value: string }>,
): MentionHandleRegistry & { values: Set<string> } {
  const byHandle = new Map<string, string>();
  for (const { handle, value } of entries) {
    byHandle.set(normalizeMentionHandle(handle), value);
  }
  const sortedHandles = [...byHandle.keys()].sort((a, b) => b.length - a.length);
  const values = new Set<string>();

  return {
    sortedHandles,
    values,
    resolveHandle(handle: string): string | undefined {
      const value = byHandle.get(handle);
      if (value !== undefined) {
        values.add(value);
      }
      return value;
    },
  };
}
