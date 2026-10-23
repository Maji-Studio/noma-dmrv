import { SECONDS_PER_HOUR } from "@/config/auth";

const HOURS_PER_DAY = 24;

/** "1 hour", "24 hours" for a token lifetime. */
export function formatDuration(seconds: number): string {
  const hours = Math.round(seconds / SECONDS_PER_HOUR);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** "1 day", "7 days" for a lifetime counted in whole days. */
export function formatDays(seconds: number): string {
  const days = Math.round(seconds / SECONDS_PER_HOUR / HOURS_PER_DAY);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
