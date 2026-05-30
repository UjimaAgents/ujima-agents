/** Stable member id from display name (agents, channels, etc.). */
export function slugifyMemberId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
