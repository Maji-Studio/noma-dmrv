/**
 * The Emissions overview's KPI strip. Each StatCard is a link that applies its
 * state filter, or clears it when it is already applied. The counts run over
 * the search and period filters only, so a tile never counts to zero just
 * because another tile is selected.
 */
"use client";

import Link from "next/link";
import { CheckCircleIcon, FileXIcon, ListChecksIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { StatCard } from "@/components/ui";
import type { FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import { formatCount } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import {
  emissionsOverviewHref,
  matchesStatus,
  type BatchStatusFilter,
  type EmissionsOverviewQuery,
} from "./emissions-overview-query";

const ICON_SIZE = 24;

interface EmissionsOverviewKpisProps {
  /** Batches after search and period, before the state filter. */
  facet: readonly FacilityEmissionsOverviewBatch[];
  query: EmissionsOverviewQuery;
  facilityId: string;
  isLoading: boolean;
}

function inBatches(count: number): string {
  return count ? `In ${formatCount(count, "credit batch", "credit batches")}` : "In no credit batch";
}

export function EmissionsOverviewKpis({ facet, query, facilityId, isLoading }: EmissionsOverviewKpisProps) {
  const sum = (pick: (batch: FacilityEmissionsOverviewBatch) => number) =>
    facet.reduce((total, batch) => total + pick(batch), 0);
  const count = (status: BatchStatusFilter) => facet.filter((batch) => matchesStatus(batch, status)).length;
  const done = count("done");
  const tiles: { status: BatchStatusFilter; title: string; value: number; description: string; icon: React.ReactNode }[] = [
    {
      status: "open",
      title: "Lines open",
      value: sum((batch) => batch.lineCounts.open),
      description: inBatches(count("open")),
      icon: <ListChecksIcon size={ICON_SIZE} weight="bold" />,
    },
    {
      status: "files",
      title: "Files missing",
      value: sum((batch) => batch.lineCounts.fileMissing),
      description: inBatches(count("files")),
      icon: <FileXIcon size={ICON_SIZE} weight="bold" />,
    },
    {
      status: "review",
      title: "Needs review",
      value: sum((batch) => batch.lineCounts.needsReview),
      description: inBatches(count("review")),
      icon: <WarningIcon size={ICON_SIZE} weight="bold" />,
    },
    {
      status: "done",
      title: "Done",
      value: done,
      description: done === 1 ? "Credit batch, all lines recorded" : "Credit batches, all lines recorded",
      icon: <CheckCircleIcon size={ICON_SIZE} weight="bold" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-12 md:gap-24 lg:grid-cols-4">
      {tiles.map((tile) => {
        const selected = query.status === tile.status;
        return (
          <Link
            key={tile.status}
            href={emissionsOverviewHref({ ...query, facility: facilityId, status: selected ? null : tile.status })}
            scroll={false}
            aria-current={selected ? "true" : undefined}
            aria-label={`${tile.title}: ${tile.value}. ${selected ? "Showing only these. Select to show all." : "Select to filter."}`}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          >
            <StatCard
              interactive
              isLoading={isLoading}
              title={tile.title}
              value={tile.value}
              description={tile.description}
              icon={tile.icon}
              className={cn(
                "h-full",
                selected && "[border-color:var(--color-interaction)] [box-shadow:inset_0_-3px_0_var(--color-interaction)]",
              )}
            />
          </Link>
        );
      })}
    </div>
  );
}
