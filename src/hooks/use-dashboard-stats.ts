import { useQuery } from "@tanstack/react-query";
import {
  getDashboardStatsFn,
  type GetDashboardStatsInput,
} from "@/fn/dashboard-stats";
import type { DashboardStats } from "@/data-access/dashboard-stats";

/**
 * Hook to fetch dashboard statistics
 */
export function useDashboardStats(input?: GetDashboardStatsInput) {
  return useQuery({
    queryKey: ["dashboard-stats", input?.facilityId, input?.periodDays],
    queryFn: async () => {
      const result = await getDashboardStatsFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    // Refetch every 5 minutes to keep stats fresh
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000, // Consider data stale after 2 minutes
  });
}

/**
 * Calculate trend direction from current and previous values
 */
export function calculateTrend(
  current: number,
  previous: number
): "up" | "down" | "neutral" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "neutral";
}

/**
 * Calculate percentage change between current and previous values
 */
export function calculatePercentageChange(
  current: number,
  previous: number
): string {
  if (previous === 0) {
    if (current === 0) return "0%";
    return "+100%";
  }

  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${Math.round(change)}%`;
}

/**
 * Format a metric stat for display with trend information
 */
export function formatMetricWithTrend(stat: DashboardStats[keyof DashboardStats]) {
  return {
    value: stat.current,
    trend: calculateTrend(stat.current, stat.previous),
    trendValue: calculatePercentageChange(stat.current, stat.previous),
  };
}
