"use client";

import { useQuery } from "@tanstack/react-query";
import { getStockAvailabilityFn } from "@/fn/stock-availability";
import type { StockAvailabilityRequest } from "@/schemas/stock-availability";
import { unwrap } from "./types";

const STOCK_AVAILABILITY_STALE_TIME_MS = 0;

export const stockAvailabilityKeys = {
  all: ["stock-availability"] as const,
  detail: (request: StockAvailabilityRequest | null) =>
    [...stockAvailabilityKeys.all, request] as const,
};

export function useStockAvailability(
  request: StockAvailabilityRequest | null,
) {
  return useQuery({
    queryKey: stockAvailabilityKeys.detail(request),
    queryFn: async () => {
      if (!request) return null;
      return unwrap(await getStockAvailabilityFn(request));
    },
    enabled: request !== null,
    staleTime: STOCK_AVAILABILITY_STALE_TIME_MS,
  });
}
