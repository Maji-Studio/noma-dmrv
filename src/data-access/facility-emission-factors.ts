/**
 * Facility emission factors (ADR 0031) — read and upsert.
 *
 * Any member reads them, because the energy page every member opens needs
 * them. Only Owners and Admins write; the role floor lives here, next to the
 * write it guards. No row reads as null, which the page shows as "no factors
 * set" and answers with activity units only.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { facilities, facilityEmissionFactors } from "@/db/schema";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import type { EnergyFactors } from "@/lib/energy/types";
import { SafeError } from "@/lib/errors";
import type { SaveFacilityEmissionFactorsData } from "@/schemas/emission-factors";
import { assertExpectedVersion, staleVersionConflict } from "./expected-version";
import { requireOrgScope } from "./utils";

const EMISSION_FACTORS_CONFLICT_ENTITY = "facilityEmissionFactors";

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
  const { facilityId, expectedUpdatedAt } = input;

  const values = {
    dieselKgCo2ePerLitre: input.dieselKgCo2ePerLitre,
    gridKgCo2ePerKwh: input.gridKgCo2ePerKwh,
    roadFreightKgCo2ePerTonneKm: input.roadFreightKgCo2ePerTonneKm,
    sourceNote: input.sourceNote,
  };

  return db.transaction(async (tx) => {
    // The facility row lock serializes saves for the facility, including two
    // first saves when no factors row exists yet to lock (issue #768 pattern),
    // and refuses an archived facility (docs/database.md, Soft Delete).
    const [facility] = await tx
      .select({ id: facilities.id })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, facilityId),
          eq(facilities.organizationId, ctx.organizationId),
          isNull(facilities.archivedAt),
        ),
      )
      .for("no key update");
    if (!facility) throw new SafeError("Facility not found or archived");

    const [existing] = await tx
      .select({ updatedAt: facilityEmissionFactors.updatedAt })
      .from(facilityEmissionFactors)
      .where(
        and(
          eq(facilityEmissionFactors.facilityId, facilityId),
          eq(facilityEmissionFactors.organizationId, ctx.organizationId),
        ),
      )
      .for("update");

    if (existing) {
      if (expectedUpdatedAt === null) {
        throw staleVersionConflict(EMISSION_FACTORS_CONFLICT_ENTITY, facilityId);
      }
      assertExpectedVersion({
        entity: EMISSION_FACTORS_CONFLICT_ENTITY,
        id: facilityId,
        expectedUpdatedAt,
        actualUpdatedAt: existing.updatedAt,
      });
      const [row] = await tx
        .update(facilityEmissionFactors)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(facilityEmissionFactors.facilityId, facilityId),
            eq(facilityEmissionFactors.organizationId, ctx.organizationId),
          ),
        )
        .returning(factorColumns);
      if (!row) throw new SafeError("Emission factors were not saved.");
      return row;
    }

    if (expectedUpdatedAt) {
      throw staleVersionConflict(EMISSION_FACTORS_CONFLICT_ENTITY, facilityId);
    }
    const [row] = await tx
      .insert(facilityEmissionFactors)
      .values({ organizationId: ctx.organizationId, facilityId, ...values })
      .returning(factorColumns);
    if (!row) throw new SafeError("Emission factors were not saved.");
    return row;
  });
}
