/**
 * FeedstockStats component
 * Stat cards showing feedstock metrics
 */
"use client";

import { PackageIcon, ScalesIcon, DropIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { StatCard } from "@/components/ui/stat-card";
import { formatMass } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFeedstockStats } from "@/hooks/use-feedstocks";
import {
  useFeedstockTypeFilter,
  useFeedstockTypeFilterOptions,
} from "./feedstock-type-filter";

// ============================================
// Component
// ============================================

interface FeedstockStatsProps {
  facilityId?: string;
}

export function FeedstockStats({ facilityId }: FeedstockStatsProps) {
  const { facilityId: contextFacilityId } = useFacilityContext();
  const effectiveFacilityId = facilityId ?? contextFacilityId ?? undefined;
  const { feedstockTypeId } = useFeedstockTypeFilter();
  const { data: stats, isLoading } = useFeedstockStats(
    {
      ...(effectiveFacilityId ? { facilityId: effectiveFacilityId } : {}),
      ...(feedstockTypeId ? { feedstockTypeId } : {}),
    },
    { enabled: !!effectiveFacilityId },
  );

  // Shares the cached option list with the toolbar's filter select, so naming
  // the active scope costs no extra request.
  const feedstockTypeOptions = useFeedstockTypeFilterOptions();
  const activeTypeName = feedstockTypeId
    ? feedstockTypeOptions.find((option) => option.id === feedstockTypeId)?.name
    : undefined;
  const scopeCaption = feedstockTypeId
    ? `Totals cover ${activeTypeName ?? "the selected feedstock type"} only.`
    : "Totals cover all feedstock types.";

  // Only surface the warning treatment when there is a real positive
  // missing-data count. When stats are undefined (no facility selected) or
  // zero, use the neutral/complete styling instead of a misleading warning.
  const missingDataCount = stats?.missingDataFeedstocks ?? 0;
  const hasMissingData = missingDataCount > 0;

  return (
    <div className="flex flex-col gap-12">
      {/* Bare <p> would lose the caption type class to the unlayered global
          `p` rule in globals.css, so the scope line is a div. */}
      <div
        className="body-caption text-[var(--color-text-tertiary)]"
        data-testid="feedstock-stats-scope"
      >
        {scopeCaption}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16">
        <StatCard
          title="Total Feedstocks"
          value={stats?.totalFeedstocks ?? 0}
          icon={<PackageIcon size={20} />}
          isLoading={isLoading}
          description="All time feedstocks"
        />

        {/* No `?? 0` on either quantity: the shared formatters render the
            missing-value token themselves, so a facility whose deliveries carry
            no moisture reading never claims it received zero dry mass. */}
        <StatCard
          title="Total Dry Mass"
          value={formatMass(stats?.totalDryMassKg)}
          icon={<ScalesIcon size={20} />}
          isLoading={isLoading}
          description="Total dry mass received"
        />

        {/* Weighted by wet mass, not a mean of the per delivery readings: one
            200 kg drop must not move the figure as far as a 20 t one. */}
        <StatCard
          title="Weighted Avg. Moisture"
          value={formatMoisturePercent(stats?.avgMoisturePercent)}
          icon={<DropIcon size={20} />}
          isLoading={isLoading}
          description="Moisture weighted by wet mass"
        />

        <StatCard
          title="Data Status"
          value={`${stats?.completeFeedstocks ?? 0} / ${stats?.totalFeedstocks ?? 0}`}
          icon={
            hasMissingData ? (
              <WarningIcon size={20} className="text-[var(--clr-orange)]" />
            ) : (
              <CheckCircleIcon size={20} className="text-[var(--color-status-success)]" />
            )
          }
          isLoading={isLoading}
          description={hasMissingData ? `${missingDataCount} need data` : "All feedstocks complete"}
        />
      </div>
    </div>
  );
}
