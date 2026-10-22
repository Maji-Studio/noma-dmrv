import { SECONDS_PER_HOUR } from "@/config/auth";

/** "1 hour", "24 hours" for a token lifetime. */
export function formatDuration(seconds: number): string {
  const hours = Math.round(seconds / SECONDS_PER_HOUR);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** "Oct 29, 2026", the calendar date (UTC) a lifetime ends. */
export function formatExpiryDate(seconds: number, now: Date = new Date()): string {
  const MS_PER_SECOND = 1000;
  return new Date(now.getTime() + seconds * MS_PER_SECOND).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
