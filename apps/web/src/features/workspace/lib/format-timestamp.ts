const DAY = 24 * 60 * 60 * 1000;

export function formatTimestamp(iso: string, reference = new Date()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "now";

  const date = new Date(parsed);
  const days = differenceInCalendarDays(reference, date);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (days <= 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago, ${time}`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago, ${time}`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago, ${time}`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago, ${time}`;
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const start = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime();
  const end = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime();
  return Math.round((start - end) / DAY);
}
