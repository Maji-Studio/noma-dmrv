/**
 * The Drivers | Operators tab row of the Crew page, styled like the credit batch
 * page tabs. There is no shared tab primitive in the repo, so this follows the
 * WAI-ARIA tabs pattern itself: tablist/tab roles, one tab stop (roving
 * tabindex), Left/Right/Home/End move and select.
 */
"use client";

import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { CREW_KINDS, FLEET_KIND_COPY, type CrewKind } from "./fleet-kinds";

export const FLEET_TAB_PANEL_ID = "crew-tab-panel";
export const fleetTabId = (kind: CrewKind) => `crew-tab-${kind}`;

const FOCUS_RING = "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

interface FleetTabsProps {
  tab: CrewKind;
  /** Record count per kind; undefined while that list loads or failed. */
  counts: Record<CrewKind, number | undefined>;
  onChange: (kind: CrewKind) => void;
}

function nextTab(current: CrewKind, key: string): CrewKind | null {
  const index = CREW_KINDS.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return CREW_KINDS[(index + 1) % CREW_KINDS.length]!;
    case "ArrowLeft":
      return CREW_KINDS[(index - 1 + CREW_KINDS.length) % CREW_KINDS.length]!;
    case "Home":
      return CREW_KINDS[0]!;
    case "End":
      return CREW_KINDS[CREW_KINDS.length - 1]!;
    default:
      return null;
  }
}

export function FleetTabs({ tab, counts, onChange }: FleetTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, kind: CrewKind) => {
    const target = nextTab(kind, event.key);
    if (!target) return;
    event.preventDefault();
    onChange(target);
    document.getElementById(fleetTabId(target))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Crew"
      className="flex overflow-x-auto border-b border-[var(--color-border-secondary)]"
    >
      {CREW_KINDS.map((kind) => {
        const selected = tab === kind;
        const count = counts[kind];
        return (
          <button
            key={kind}
            id={fleetTabId(kind)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={FLEET_TAB_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(kind)}
            onKeyDown={(event) => onKeyDown(event, kind)}
            className={cn(
              "-mb-px inline-flex h-44 shrink-0 items-center gap-8 border-b-2 px-16 body-medium first:pl-0",
              FOCUS_RING,
              selected
                ? "border-[var(--ink)] font-medium"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            {FLEET_KIND_COPY[kind].title}
            {count !== undefined && (
              <span className="body-small tabular-nums text-[var(--color-text-tertiary)]">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
