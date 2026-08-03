/**
 * FeedstockStats component
 * Stat cards showing feedstock metrics
 */
"use client";

import { PackageIcon, ScalesIcon, DropIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { StatCard } from "@/components/ui/stat-card";
import { formatMass } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFeedstockStats } from "@/hooks/use-feedstocks";

// ============================================
// Component
// ============================================

interface FeedstockStatsProps {
  facilityId?: string;
}

export function FeedstockStats({ facilityId }: FeedstockStatsProps) {
  const { facilityId: contextFacilityId } = useFacilityContext();
  const effectiveFacilityId = facilityId ?? contextFacilityId ?? undefined;
  const { data: stats, isLoading } = useFeedstockStats(effectiveFacilityId, {
    enabled: !!effectiveFacilityId,
  });

  // Only surface the warning treatment when there is a real positive
  // missing-data count. When stats are undefined (no facility selected) or
  // zero, use the neutral/complete styling instead of a misleading warning.
  const missingDataCount = stats?.missingDataFeedstocks ?? 0;
  const hasMissingData = missingDataCount > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16">
      <StatCard
        title="Total Feedstocks"
        value={stats?.totalFeedstocks ?? 0}
        icon={<PackageIcon size={20} />}
        isLoading={isLoading}
        description="All time feedstocks"
      />

      <StatCard
        title="Total Dry Mass"
        value={formatMass(stats?.totalDryMassKg ?? 0)}
        icon={<ScalesIcon size={20} />}
        isLoading={isLoading}
        description="Total dry mass received"
      />

      <StatCard
        title="Avg. Moisture"
        value={stats?.avgMoisturePercent != null ? `${stats.avgMoisturePercent.toFixed(1)}%` : "Not available"}
        icon={<DropIcon size={20} />}
        isLoading={isLoading}
        description="Average moisture content"
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
  );
}
