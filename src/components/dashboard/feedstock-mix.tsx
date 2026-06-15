/**
 * FeedstockMix — dry-mass share per feedstock type in the period (visual
 * design plan, Phase 5): the inspiration mock's mix bars — mono label,
 * accent-filled track, tabular percent.
 */
"use client";

import { Leaf } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import type { DashboardFeedstockMixSlice } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

/** Accent ramp for the slices, biggest share first; the tail stays muted. */
const MIX_ACCENTS = [
  "var(--clr-rose)",
  "var(--clr-orange)",
  "var(--clr-red)",
  "var(--clr-pink)",
  "var(--clr-purple)",
];
const MIX_TAIL_ACCENT = "var(--clr-dark-purple-20)";

function formatTonnes(massDryKg: number): string {
  return `${(massDryKg / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} t`;
}

interface FeedstockMixProps {
  slices: DashboardFeedstockMixSlice[];
}

export function FeedstockMix({ slices }: FeedstockMixProps) {
  const totalKg = slices.reduce((sum, slice) => sum + slice.massDryKg, 0);

  return (
    <DashboardPanel
      title="Feedstock mix"
      meta={
        totalKg > 0 ? (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            {formatTonnes(totalKg)} dry
          </span>
        ) : undefined
      }
    >
      {totalKg <= 0 ? (
        <EmptyState
          padding="md"
          icon={<Leaf size={32} />}
          title="No feedstock in period"
          description="Feedstock intake recorded in this range will break down here by type."
        />
      ) : (
        <div className="flex flex-col px-20 py-12" data-testid="feedstock-mix">
          <p className="pb-8 label-micro text-[var(--color-text-tertiary)]">
            Dry mass processed by feedstock type
          </p>
          {slices.map((slice, index) => (
            <div
              key={slice.feedstockTypeId ?? "other"}
              className="grid grid-cols-[minmax(96px,120px)_minmax(0,1fr)_48px] items-center gap-14 py-10"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span
                  className="label-micro truncate text-[var(--color-text-secondary)]"
                  title={slice.name}
                >
                  {slice.name}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                  {formatTonnes(slice.massDryKg)}
                </span>
              </span>
              <div className="relative h-14 bg-[var(--clr-dark-purple-10)]">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width:
                      slice.percent > 0 ? `${Math.max(slice.percent, 1)}%` : 0,
                    background:
                      slice.feedstockTypeId == null
                        ? MIX_TAIL_ACCENT
                        : MIX_ACCENTS[index % MIX_ACCENTS.length],
                  }}
                />
              </div>
              <span className="label-micro text-right tabular-nums text-[var(--color-text-primary)]">
                {Math.round(slice.percent)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}
