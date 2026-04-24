/**
 * FeedstockStats component
 * Stat cards showing feedstock metrics
 */
"use client";

import { Package, Scales, Drop, CheckCircle, Warning } from "@phosphor-icons/react";
import { StatCard } from "@/components/dashboard/stat-card";
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16">
      <StatCard
        title="Total Feedstocks"
        value={stats?.totalFeedstocks ?? 0}
        icon={<Package size={20} />}
        isLoading={isLoading}
        description="All time feedstocks"
      />

      <StatCard
        title="Total Dry Mass"
        value={formatMass(stats?.totalDryMassKg ?? 0)}
        icon={<Scales size={20} />}
        isLoading={isLoading}
        description="Total dry mass received"
      />

      <StatCard
        title="Avg. Moisture"
        value={stats?.avgMoisturePercent != null ? `${stats.avgMoisturePercent.toFixed(1)}%` : "—"}
        icon={<Drop size={20} />}
        isLoading={isLoading}
        description="Average moisture content"
      />

      <StatCard
        title="Data Status"
        value={`${stats?.completeFeedstocks ?? 0} / ${stats?.totalFeedstocks ?? 0}`}
        icon={
          stats?.missingDataFeedstocks === 0 ? (
            <CheckCircle size={20} className="text-[var(--color-status-success)]" />
          ) : (
            <Warning size={20} className="text-[var(--clr-orange)]" />
          )
        }
        isLoading={isLoading}
        description={
          stats?.missingDataFeedstocks === 0
            ? "All feedstocks complete"
            : `${stats?.missingDataFeedstocks} need data`
        }
      />
    </div>
  );
}
