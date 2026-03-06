/**
 * FeedstockDeliveryStats component
 * Stat cards showing delivery metrics
 */
"use client";

import { Package, Scales, Drop, CheckCircle, Warning } from "@phosphor-icons/react";
import { StatCard } from "@/components/dashboard/stat-card";
import { useFeedstockDeliveryStats } from "@/hooks/use-feedstock-deliveries";

// ============================================
// Helper Functions
// ============================================

function formatWetMass(wetMassKg: number): string {
  if (wetMassKg >= 1000000) {
    return `${(wetMassKg / 1000000).toFixed(1)}k t`;
  }
  if (wetMassKg >= 1000) {
    return `${(wetMassKg / 1000).toFixed(1)} t`;
  }
  return `${wetMassKg.toFixed(0)} kg`;
}

function formatMoisture(moisturePercent: number | null): string {
  if (moisturePercent === null) return "—";
  return `${moisturePercent.toFixed(1)}%`;
}

// ============================================
// Component
// ============================================

interface FeedstockDeliveryStatsProps {
  facilityId?: string;
}

export function FeedstockDeliveryStats({ facilityId }: FeedstockDeliveryStatsProps) {
  const { data: stats, isLoading } = useFeedstockDeliveryStats(facilityId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16">
      <StatCard
        title="Total Deliveries"
        value={stats?.totalDeliveries ?? 0}
        icon={<Package size={20} />}
        isLoading={isLoading}
        description="All time feedstock deliveries"
      />

      <StatCard
        title="Total Wet Mass"
        value={formatWetMass(stats?.totalWetMassKg ?? 0)}
        icon={<Scales size={20} />}
        isLoading={isLoading}
        description="Total feedstock received"
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
        value={`${stats?.completeDeliveries ?? 0} / ${stats?.totalDeliveries ?? 0}`}
        icon={
          stats?.missingDataDeliveries === 0 ? (
            <CheckCircle size={20} className="text-[var(--color-status-success)]" />
          ) : (
            <Warning size={20} className="text-[var(--clr-orange)]" />
          )
        }
        isLoading={isLoading}
        description={
          stats?.missingDataDeliveries === 0
            ? "All deliveries complete"
            : `${stats?.missingDataDeliveries} need data`
        }
      />
    </div>
  );
}
