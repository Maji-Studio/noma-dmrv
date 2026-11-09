/**
 * A stage cell's words: the stage name (with its icon), the counted figure
 * ("3 runs") and, when the stage has open items, a count bubble whose popover
 * lists them as links.
 *
 * The stage link stretches over its whole column with an `::after`, so the
 * column stays one click target, while the bubble and any action links sit
 * above it as sibling controls: nothing interactive inside the link.
 */
"use client";

import Link from "next/link";
import type { DashboardStation } from "@/data-access/dashboard-overview";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { CENTRED_HIT_AREA } from "@/components/ui/touch-target";
import { plural } from "@/lib/dashboard-links";
import { STATUS_STATE_COLOR_TOKENS } from "@/lib/status-state";
import { cn } from "@/lib/utils";
import { deriveWorstDashboardState } from "./dashboard-status-state";
import { FOCUS_RING, STAGE_ICON, STAGE_LIST_LABEL } from "./shared";

/** Lifts a sibling control above the stretched stage link. */
export const ABOVE_STAGE_LINK = "relative z-[2]";

export function StageText({ station, align }: { station: DashboardStation; align: "center" | "start" }) {
  const StageIcon = STAGE_ICON[station.key];
  return (
    <span className={cn("flex flex-col gap-4", align === "center" ? "items-center text-center" : "items-start")}>
      <Link
        href={station.href}
        aria-label={`${station.name}, ${station.totalLabel}. Open ${STAGE_LIST_LABEL[station.key]}`}
        className={cn(
          "flex items-center gap-8 body-small font-medium text-[var(--color-text-primary)]",
          // The stretched hit area: the whole column opens the stage's list.
          "after:absolute after:inset-0 after:content-['']",
          "focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--ink)]",
        )}
      >
        <StageIcon size={16} weight="bold" className="flex-none text-[var(--color-text-tertiary)]" aria-hidden />
        {station.name}
      </Link>
      <span className="flex items-center gap-8">
        <span className="body-large font-medium tabular-nums text-[var(--ink)]" aria-hidden>
          {station.totalLabel}
        </span>
        {station.attention > 0 && <AttentionChip station={station} />}
      </span>
    </span>
  );
}

/** The open-items count; tap, hover or focus lists what is wrong, each a link. */
function AttentionChip({ station }: { station: DashboardStation }) {
  const state = deriveWorstDashboardState(station.reasons.map((reason) => reason.state));
  return (
    <span className={ABOVE_STAGE_LINK}>
      <Popover
        title={station.name}
        openOnHover
        align="center"
        trigger={
          <Button
            variant="noOutline"
            size="icon"
            aria-label={plural(station.attention, "open item")}
            // The count-badge look (credit batch page) on the system Button.
            className={cn(
              "relative h-20 w-auto min-w-20 rounded-full px-6 tabular-nums text-[var(--paper)] hover:opacity-90",
              CENTRED_HIT_AREA,
            )}
            style={{ background: STATUS_STATE_COLOR_TOKENS[state] }}
          >
            {station.attention}
          </Button>
        }
      >
        <ul className="flex flex-col py-4">
          {station.reasons.map((reason) => (
            <li key={reason.text}>
              <Link
                href={reason.href ?? station.href}
                className={cn(
                  "flex min-h-44 items-center gap-8 px-12 body-small text-[var(--color-text-primary)] hover:bg-[var(--color-background-medium)]",
                  FOCUS_RING,
                )}
              >
                <span
                  className="h-8 w-8 flex-none rounded-full"
                  style={{ background: STATUS_STATE_COLOR_TOKENS[reason.state] }}
                  aria-hidden
                />
                {reason.text}
              </Link>
            </li>
          ))}
        </ul>
      </Popover>
    </span>
  );
}
