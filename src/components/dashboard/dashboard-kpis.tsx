/**
 * DashboardKpis — the 5-card KPI strip (visual design plan, Phase 5): the
 * canonical StatCard with its sparkline slot finally in use. Values carry a
 * delta badge vs the previous equal period; "—" means no data in range,
 * never a fabricated zero.
 */
"use client";

import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import type { DashboardKpi } from "@/data-access/dashboard-overview";
import { KpiSparkline } from "./kpi-sparkline";

const KPI_GRID_CLASS =
  "grid grid-cols-1 gap-24 sm:grid-cols-2 xl:grid-cols-5";

function formatKpiValue(kpi: DashboardKpi): string {
  if (kpi.value == null) return "—";
  const digits = Math.abs(kpi.value) >= 100 ? 0 : 1;
  return `${kpi.value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${kpi.unit}`;
}

function trendFor(kpi: DashboardKpi): {
  trend: "up" | "down" | "neutral";
  trendValue: string;
} | null {
  if (kpi.deltaPercent == null) return null;
  const rounded = Math.round(kpi.deltaPercent);
  if (rounded === 0) return { trend: "neutral", trendValue: "0%" };
  return rounded > 0
    ? { trend: "up", trendValue: `+${rounded}%` }
    : { trend: "down", trendValue: `${rounded}%` };
}

interface DashboardKpisProps {
  kpis: DashboardKpi[] | undefined;
  isLoading: boolean;
}

export function DashboardKpis({ kpis, isLoading }: DashboardKpisProps) {
  if (isLoading || !kpis) {
    return (
      <div className={KPI_GRID_CLASS}>
        {Array.from({ length: 5 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  return (
    <div className={KPI_GRID_CLASS} data-testid="dashboard-kpis">
      {kpis.map((kpi) => {
        const trend = trendFor(kpi);
        return (
          <StatCard
            key={kpi.key}
            title={kpi.label}
            value={formatKpiValue(kpi)}
            trend={trend?.trend}
            trendValue={trend?.trendValue}
            trendLabel={trend ? "vs prior period" : undefined}
            description={trend ? undefined : kpi.detail}
            sparkline={
              kpi.series.some((v) => v !== 0) ? (
                <KpiSparkline
                  series={kpi.series}
                  label={`${kpi.label} trend`}
                />
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
