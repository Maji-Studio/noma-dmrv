"use server";

/**
 * Energy page action (ADR 0031): the period breakdown of recorded activity.
 * Nothing here feeds a registry submission, and no CO2e is computed.
 */
import { getEnergyInputs } from "@/data-access/energy";
import { buildEnergyBreakdown } from "@/lib/energy/attribution";
import type { EnergyBreakdown } from "@/lib/energy/types";
import { energyBreakdownInputSchema } from "@/schemas/energy";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export async function getEnergyBreakdown(input: unknown): Promise<ActionResult<EnergyBreakdown>> {
  return withAction(
    async (ctx) => {
      const { facilityId, from, to } = energyBreakdownInputSchema.parse(input);
      const { inputs } = await getEnergyInputs(ctx, facilityId);
      return buildEnergyBreakdown(inputs, { from, to });
    },
    {
      fallbackMessage: "The energy figures could not be loaded. Refresh the page and try again.",
      log: { message: "energy breakdown failed", context: { op: "getEnergyBreakdown" } },
    },
  );
}
