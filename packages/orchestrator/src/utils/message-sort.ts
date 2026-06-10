export type MessageSortDirection = 'asc' | 'desc';

export interface SortableByTime {
  createdAt: string;
  id: string;
}

export function compareByCreatedAt(
  left: SortableByTime,
  right: SortableByTime,
  direction: MessageSortDirection = 'asc',
): number {
  const byTime = left.createdAt.localeCompare(right.createdAt);
  const tiebreak = byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  return direction === 'asc' ? tiebreak : -tiebreak;
}

export function sortByCreatedAt<T extends SortableByTime>(
  items: readonly T[],
  direction: MessageSortDirection = 'asc',
): T[] {
  return [...items].sort((left, right) => compareByCreatedAt(left, right, direction));
}
