/**
 * Shared utility functions for session search.
 */

/** Format an ISO timestamp as a relative time string (e.g. "2h ago", "3d ago"). */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 14) return "last week";

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return months <= 1 ? "last month" : `${months}mo ago`;
}

/** Truncate a string to max chars. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
