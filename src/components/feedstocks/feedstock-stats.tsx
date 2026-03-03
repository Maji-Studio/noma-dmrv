/**
 * FeedstockStats component
 * Stat cards showing feedstock metrics
 */
"use client";

import { Package, Scales, Drop, CheckCircle, Warning } from "@phosphor-icons/react";
import { StatCard } from "@/components/dashboard/stat-card";
import { useFeedstockStats } from "@/hooks/use-feedstocks";

// ============================================
// Helper Functions
// ============================================

function formatMass(massKg: number): string {
  if (massKg >= 1000000) {
    return `${(massKg / 1000000).toFixed(1)}k t`;
  }
  if (massKg >= 1000) {
    return `${(massKg / 1000).toFixed(1)} t`;
  }
  return `${massKg.toFixed(0)} kg`;
}

function formatMoisture(moisturePercent: number | null): string {
  if (moisturePercent === null) return "—";
  return `${moisturePercent.toFixed(1)}%`;
}

// ============================================
// Component
// ============================================

interface FeedstockStatsProps {
  facilityId?: string;
}

export function FeedstockStats({ facilityId }: FeedstockStatsProps) {
  const { data: stats, isLoading } = useFeedstockStats(facilityId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16">
      <StatCard
        title="Total Feedstocks"
        value={stats?.totalFeedstocks ?? 0}
        icon={<Package size={20} />}
        isLoading={isLoading}
        description="All time feedstock batches"
      />

      <StatCard
        title="Total Dry Mass"
        value={formatMass(stats?.totalDryMassKg ?? 0)}
        icon={<Scales size={20} />}
        isLoading={isLoading}
        description="Total dry mass recorded"
      />

      <StatCard
        title="Avg. Moisture"
        value={formatMoisture(stats?.avgMoisturePercent ?? null)}
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
