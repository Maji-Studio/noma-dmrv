/**
 * CertificationStatusBadge
 * The status badge of a Removal or GHG Statement, as a button that opens its
 * status history. Every certification surface that shows a record's status
 * (Removals list, removal detail sheet, GHG Statements list, statement detail
 * sheet) renders this, so the history opens the same way everywhere.
 *
 * The caller still derives the status: list and sheet surfaces fold in
 * readiness and live registry state the history does not.
 */
"use client";

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Popover } from "@/components/ui/popover";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import type { StatusHistoryEntityType } from "@/lib/certification/status-history";
import { cn } from "@/lib/utils";
import { SubmissionStatusHistory } from "./submission-status-history";

const HISTORY_ICON_SIZE = 12;

interface CertificationStatusBadgeProps {
  entityType: StatusHistoryEntityType;
  entityId: string;
  status: StatusValue;
  label: string;
  className?: string;
}

export function CertificationStatusBadge({
  entityType,
  entityId,
  status,
  label,
  className,
}: CertificationStatusBadgeProps) {
  return (
    <Popover
      title="Status history"
      trigger={
        <button
          type="button"
          // The visible label leads the name (WCAG 2.5.3).
          aria-label={`${label}, status history`}
          className={cn(
            "relative inline-flex items-center self-start cursor-pointer",
            // 44px touch target without growing the row: an absolutely
            // positioned hit area centred on the compact badge. Controls
            // stacked right under a badge sit above it (`relative`), so the
            // area never takes a press meant for them.
            "before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2",
            "before:h-44 before:w-full before:min-w-44 before:content-['']",
            "hover:opacity-80 transition-opacity",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-offset-1",
            className
          )}
        >
          <StatusBadge
            status={status}
            label={label}
            icon={<ClockCounterClockwiseIcon size={HISTORY_ICON_SIZE} weight="bold" />}
          />
        </button>
      }
    >
      <SubmissionStatusHistory entityType={entityType} entityId={entityId} />
    </Popover>
  );
}
