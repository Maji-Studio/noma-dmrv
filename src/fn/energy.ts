"use server";

/**
 * Energy page actions (ADR 0031): the period breakdown and the facility's
 * emission factors. The breakdown is an operator-facing estimate; nothing
 * here feeds a registry submission.
 */
import { z } from "zod";
import { getEnergyInputs } from "@/data-access/energy";
import {
  getFacilityEmissionFactors,
  upsertFacilityEmissionFactors,
  type FacilityEmissionFactors,
} from "@/data-access/facility-emission-factors";
import type { OrgContext } from "@/lib/auth/server";
import { buildEnergyBreakdown } from "@/lib/energy/attribution";
import type { EnergyBreakdown, EnergyFactors } from "@/lib/energy/types";
import { saveFacilityEmissionFactorsSchema } from "@/schemas/emission-factors";
import { energyBreakdownInputSchema } from "@/schemas/energy";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const facilityIdSchema = z.uuid();

export interface EnergyBreakdownPayload extends EnergyBreakdown {
  /** Server-computed. The save action re-checks the role. */
  viewerCanManage: boolean;
}

export interface FacilityEmissionFactorsPayload {
  factors: FacilityEmissionFactors | null;
  /** Server-computed. The save action re-checks the role. */
  viewerCanManage: boolean;
}

function canManage(ctx: OrgContext): boolean {
  return ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

function toEnergyFactors(factors: FacilityEmissionFactors | null): EnergyFactors | null {
  if (!factors) return null;
  return {
    dieselKgCo2ePerLitre: factors.dieselKgCo2ePerLitre,
    gridKgCo2ePerKwh: factors.gridKgCo2ePerKwh,
    roadFreightKgCo2ePerTonneKm: factors.roadFreightKgCo2ePerTonneKm,
  };
}

export async function getEnergyBreakdown(
  input: unknown,
): Promise<ActionResult<EnergyBreakdownPayload>> {
  return withAction(
    async (ctx) => {
      const { facilityId, from, to } = energyBreakdownInputSchema.parse(input);
      const [{ inputs }, factors] = await Promise.all([
        getEnergyInputs(ctx, facilityId),
        getFacilityEmissionFactors(ctx, facilityId),
      ]);
      return {
        ...buildEnergyBreakdown(inputs, toEnergyFactors(factors), { from, to }),
        viewerCanManage: canManage(ctx),
      };
    },
    {
      fallbackMessage: "The energy figures could not be loaded. Refresh the page and try again.",
      log: { message: "energy breakdown failed", context: { op: "getEnergyBreakdown" } },
    },
  );
}

export async function loadFacilityEmissionFactors(
  facilityId: string,
): Promise<ActionResult<FacilityEmissionFactorsPayload>> {
  return withAction(async (ctx) => ({
    factors: await getFacilityEmissionFactors(ctx, facilityIdSchema.parse(facilityId)),
    viewerCanManage: canManage(ctx),
  }));
}

export async function saveFacilityEmissionFactors(
  input: unknown,
): Promise<ActionResult<FacilityEmissionFactors>> {
  return withAction(
    async (ctx) => upsertFacilityEmissionFactors(ctx, saveFacilityEmissionFactorsSchema.parse(input)),
    { fallbackMessage: "The emission factors were not saved. Try again." },
  );
}
