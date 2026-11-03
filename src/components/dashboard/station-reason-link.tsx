/**
 * A station reason fixed somewhere other than the station's own list (a GPS
 * gap's form, the credit batch list), as a link. Shared by the desktop
 * reasons strip and the phone station cards so both read and hit the same.
 * The 44px hit area is the shared inline recipe; each link sits in its own
 * 44px row, so stacked links never overlap. `StationReasonRow` gives a plain
 * reason the same row, so every line in a stack has one rhythm.
 */
import Link from "next/link";
import type { DashboardStationReason } from "@/data-access/dashboard-overview";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { STATUS_STATE_COLOR_TOKENS } from "@/lib/status-state";
import { cn } from "@/lib/utils";

export function StationReasonLink({
  reason,
  className,
}: {
  reason: DashboardStationReason & { href: string };
  className?: string;
}) {
  return (
    <span className={cn("flex min-h-44 items-center", className)}>
      <Link
        href={reason.href}
        className={cn("underline underline-offset-2", INLINE_HIT_AREA)}
        style={{ color: STATUS_STATE_COLOR_TOKENS[reason.state] }}
      >
        {reason.text}
      </Link>
    </span>
  );
}

/**
 * One reason in a 44px row: a link when it is fixed off the station's list,
 * else caption text in its state colour. Plain text repeats what the station
 * link or badge already announces, so it is hidden from assistive tech.
 */
export function StationReasonRow({
  reason,
  className,
}: {
  reason: DashboardStationReason;
  className?: string;
}) {
  if (hasHref(reason)) return <StationReasonLink reason={reason} className={className} />;
  return (
    <span
      className={cn("flex min-h-44 items-center", className)}
      style={{ color: STATUS_STATE_COLOR_TOKENS[reason.state] }}
      aria-hidden
    >
      {reason.text}
    </span>
  );
}

export function hasHref(reason: DashboardStationReason): reason is DashboardStationReason & { href: string } {
  return reason.href != null;
}
