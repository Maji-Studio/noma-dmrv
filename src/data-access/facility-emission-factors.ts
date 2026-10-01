/**
 * Facility emission factors (ADR 0031) — read and upsert.
 *
 * Any member reads them, because the energy page every member opens needs
 * them. Only Owners and Admins write; the role floor lives here, next to the
 * write it guards. No row reads as null, which the page shows as "no factors
 * set" and answers with activity units only.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilityEmissionFactors } from "@/db/schema";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import type { EnergyFactors } from "@/lib/energy/types";
import { SafeError } from "@/lib/errors";
import type { SaveFacilityEmissionFactorsData } from "@/schemas/emission-factors";
import { requireOrgFacility, requireOrgScope } from "./utils";

export interface FacilityEmissionFactors extends EnergyFactors {
  sourceNote: string | null;
  updatedAt: Date;
}

const factorColumns = {
  dieselKgCo2ePerLitre: facilityEmissionFactors.dieselKgCo2ePerLitre,
  gridKgCo2ePerKwh: facilityEmissionFactors.gridKgCo2ePerKwh,
  roadFreightKgCo2ePerTonneKm: facilityEmissionFactors.roadFreightKgCo2ePerTonneKm,
  sourceNote: facilityEmissionFactors.sourceNote,
  updatedAt: facilityEmissionFactors.updatedAt,
};

export async function getFacilityEmissionFactors(
  ctx: OrgContext,
  facilityId: string,
): Promise<FacilityEmissionFactors | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select(factorColumns)
    .from(facilityEmissionFactors)
    .where(
      and(
        eq(facilityEmissionFactors.facilityId, facilityId),
        eq(facilityEmissionFactors.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertFacilityEmissionFactors(
  ctx: OrgContext,
  input: SaveFacilityEmissionFactorsData,
): Promise<FacilityEmissionFactors> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  await requireOrgFacility(ctx, input.facilityId);

  const values = {
    dieselKgCo2ePerLitre: input.dieselKgCo2ePerLitre,
    gridKgCo2ePerKwh: input.gridKgCo2ePerKwh,
    roadFreightKgCo2ePerTonneKm: input.roadFreightKgCo2ePerTonneKm,
    sourceNote: input.sourceNote,
  };
  const [row] = await db
    .insert(facilityEmissionFactors)
    .values({ organizationId: ctx.organizationId, facilityId: input.facilityId, ...values })
    .onConflictDoUpdate({
      target: facilityEmissionFactors.facilityId,
      // The unique key is the facility alone; the org predicate keeps an
      // upsert from ever touching another organization's row.
      setWhere: eq(facilityEmissionFactors.organizationId, ctx.organizationId),
      set: { ...values, updatedAt: new Date() },
    })
    .returning(factorColumns);

  if (!row) {
    throw new SafeError("Emission factors were not saved.");
  }
  return row;
}
