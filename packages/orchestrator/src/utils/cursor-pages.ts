export interface CursorPage<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
}

export function collectCursorPages<T>(
  load: (cursor?: string) => CursorPage<T>,
): T[] {
  const data: T[] = [];
  let cursor: string | undefined;
  do {
    const page = load(cursor);
    data.push(...page.data);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  return data;
}
