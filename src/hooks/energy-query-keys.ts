import type { EnergyBreakdownInput } from "@/schemas/energy";

export const energyKeys = {
  all: ["energy"] as const,
  breakdowns: () => [...energyKeys.all, "breakdown"] as const,
  breakdown: (input: EnergyBreakdownInput) =>
    [...energyKeys.breakdowns(), input.facilityId, input.from, input.to] as const,
};
