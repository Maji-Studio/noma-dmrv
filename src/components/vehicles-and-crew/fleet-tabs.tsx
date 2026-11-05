/**
 * The Drivers | Operators tab row of the Crew page, styled like the credit batch
 * page tabs. Tablist/tab roles here; the one tab stop (roving tabindex) and
 * Left/Right/Home/End keys come from `useTablistKeys`, shared with the credit
 * batch page tabs.
 */
"use client";

import { useTablistKeys } from "@/components/ui/tablist-keys";
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

export function FleetTabs({ tab, counts, onChange }: FleetTabsProps) {
  const tabProps = useTablistKeys({ keys: CREW_KINDS, selected: tab, onSelect: onChange, tabId: fleetTabId });

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
            onClick={() => onChange(kind)}
            {...tabProps(kind)}
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
