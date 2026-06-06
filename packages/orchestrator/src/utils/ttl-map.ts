/**
 * Drop entries whose stored timestamp is older than `maxAgeMs`.
 * Callers that don't naturally compute `now` should pass `Date.now()`.
 */
export function evictStaleTimestamps<K>(
  map: Map<K, number>,
  now: number,
  maxAgeMs: number,
): void {
  for (const [key, ts] of map) {
    if (now - ts > maxAgeMs) map.delete(key);
  }
}
