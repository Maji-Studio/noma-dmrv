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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Oct 22, 2026" in UTC. */
export function formatDateUtc(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "Oct 22, 2026 at 14:32 UTC". */
export function formatDateTimeUtc(date: Date): string {
  return `${formatDateUtc(date)} at ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}
