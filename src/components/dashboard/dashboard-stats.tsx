"use client";

import {
  Package,
  Factory,
  ClipboardText,
  Certificate,
} from "@phosphor-icons/react";
import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import {
  useDashboardStats,
  formatMetricWithTrend,
} from "@/hooks/use-dashboard-stats";

interface DashboardStatsProps {
  facilityId?: string;
}

export function DashboardStats({ facilityId }: DashboardStatsProps) {
  const { data: stats, isLoading, error } = useDashboardStats({ facilityId });

  if (error) {
    return (
      <div className="p-16 bg-[var(--clr-red-10)] border border-[var(--clr-red-40)]">
        <p className="body-small text-[var(--clr-red)]">
          Failed to load dashboard statistics. Please try again later.
        </p>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  const deliveriesMetric = formatMetricWithTrend(stats.totalDeliveries);
  const productionMetric = formatMetricWithTrend(stats.activeProductionRuns);
  const applicationsMetric = formatMetricWithTrend(stats.pendingApplications);
  const creditsMetric = formatMetricWithTrend(stats.issuedCredits);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
      <StatCard
        title="Total Deliveries"
        value={deliveriesMetric.value}
        icon={<Package size={24} />}
        trend={deliveriesMetric.trend}
        trendValue={deliveriesMetric.trendValue}
        trendLabel="vs last period"
        href="/deliveries"
      />

      <StatCard
        title="Active Production Runs"
        value={productionMetric.value}
        icon={<Factory size={24} />}
        trend={productionMetric.trend}
        trendValue={productionMetric.trendValue}
        trendLabel="vs last period"
        href="/production-runs"
      />

      <StatCard
        title="Pending Applications"
        value={applicationsMetric.value}
        icon={<ClipboardText size={24} />}
        trend={applicationsMetric.trend}
        trendValue={applicationsMetric.trendValue}
        trendLabel="vs last period"
        href="/applications"
      />

      <StatCard
        title="Issued Credits"
        value={creditsMetric.value}
        icon={<Certificate size={24} />}
        trend={creditsMetric.trend}
        trendValue={creditsMetric.trendValue}
        trendLabel="vs last period"
        href="/credit-batches"
      />
    </div>
  );
}
