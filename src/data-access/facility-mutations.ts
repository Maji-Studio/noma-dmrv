import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { facilities, type Facility } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { hasBlockingFacilitySubmission } from "./certification";
import {
  CODE_CONFLICT_MESSAGES,
  withUniqueCodeGuard,
} from "./code-generator";
import { assertRowVersion, nextVersion } from "./row-version";
import { acquireFacilityDurabilityLock } from "./facility-durability-lock";
import { guardFacilityName } from "./unique-name-guards";
import { requireOrgScope } from "./utils";

/** Entity key on a facility's expected-version conflict. */
export const FACILITY_CONFLICT_ENTITY = "facility";

interface FacilityUpdateData {
  code?: string;
  name?: string;
  country?: string;
  location?: string | null;
  address?: string | null;
  gpsLatitude?: number;
  gpsLongitude?: number;
  timezone?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  durabilityOption?: "200_year" | "1000_year";
}

/** Read the facility row under a write lock so a version check cannot race. */
async function lockFacilityRow(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
): Promise<{ durabilityOption: string; version: number; updatedAt: Date }> {
  const [locked] = await tx
    .select({
      durabilityOption: facilities.durabilityOption,
      version: facilities.version,
      updatedAt: facilities.updatedAt,
    })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .for("update");
  if (!locked) throw new SafeError("Facility not found");
  return locked;
}

export async function createFacility(
  ctx: OrgContext,
  data: {
    code: string;
    name: string;
    country: string;
    location?: string | null;
    address?: string | null;
    gpsLatitude: number;
    gpsLongitude: number;
    timezone: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    durabilityOption?: "200_year" | "1000_year";
  },
): Promise<Facility> {
  requireOrgScope(ctx);

  const [facility] = await guardFacilityName(ctx, data.name, () =>
    db
      .insert(facilities)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        country: data.country,
        location: data.location ?? null,
        address: data.address ?? null,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        timezone: data.timezone,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        durabilityOption: data.durabilityOption ?? "1000_year",
      })
      .returning(),
  );

  return facility;
}

async function updateFacilityRow(
  ctx: OrgContext,
  executor: typeof db | DbTransaction,
  facilityId: string,
  data: FacilityUpdateData,
): Promise<Facility> {
  requireOrgScope(ctx);
  // A rename can collide with another facility's name in the same org; the name
  // guard translates that unique-index violation, nested inside the code guard
  // so each constraint maps to its own friendly message. `data.name` is absent
  // when the update does not touch the name, in which case no name violation is
  // possible and the guard is a passthrough.
  const [updated] = await guardFacilityName(ctx, data.name ?? "", () =>
    withUniqueCodeGuard(
      ctx,
      facilities,
      facilities.code,
      CODE_CONFLICT_MESSAGES.facility,
      () =>
        executor
          .update(facilities)
          .set({ ...data, version: nextVersion(facilities.version), updatedAt: new Date() })
          .where(
            and(
              eq(facilities.id, facilityId),
              eq(facilities.organizationId, ctx.organizationId),
            ),
          )
          .returning(),
    ),
  );
  if (!updated) throw new SafeError("Facility not found");
  return updated;
}

/** Update a facility, serializing only real durability-tier changes. */
export async function updateFacility(
  ctx: OrgContext,
  facilityId: string,
  input: FacilityUpdateData & { expectedVersion: number },
): Promise<Facility> {
  requireOrgScope(ctx);
  const { expectedVersion, ...data } = input;
  const [existing] = await db
    .select({ durabilityOption: facilities.durabilityOption })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    );
  if (!existing) throw new SafeError("Facility not found");

  const tierChangeRequested =
    data.durabilityOption !== undefined &&
    data.durabilityOption !== existing.durabilityOption;
  if (!tierChangeRequested) {
    // Strip a stale echoed tier so this cheap path cannot revert a concurrent
    // real tier edit. It still takes no durability lock and runs no ledger
    // probe; the transaction exists only so the facility's own row lock spans
    // the version check and the write it guards (issue #768).
    const nonTierData = { ...data };
    delete nonTierData.durabilityOption;
    return db.transaction(async (tx) => {
      const locked = await lockFacilityRow(ctx, tx, facilityId);
      assertRowVersion({
        entity: FACILITY_CONFLICT_ENTITY,
        id: facilityId,
        expectedVersion,
        actualVersion: locked.version,
      });
      return updateFacilityRow(ctx, tx, facilityId, nonTierData);
    });
  }

  return db.transaction(async (tx) => {
    await acquireFacilityDurabilityLock(ctx, tx, facilityId);
    const lockedExisting = await lockFacilityRow(ctx, tx, facilityId);
    assertRowVersion({
      entity: FACILITY_CONFLICT_ENTITY,
      id: facilityId,
      expectedVersion,
      actualVersion: lockedExisting.version,
    });

    if (data.durabilityOption === lockedExisting.durabilityOption) {
      const nonTierData = { ...data };
      delete nonTierData.durabilityOption;
      return updateFacilityRow(ctx, tx, facilityId, nonTierData);
    }

    const tierIsLocked = await hasBlockingFacilitySubmission(ctx, tx, facilityId, "isometric");
    if (tierIsLocked) {
      throw new DomainError(
        "certification_locked",
        "Cannot change this facility's durability tier because registry submissions use it. Delete interrupted Removals and their registry records first. Completed submissions keep this tier fixed.",
      );
    }

    return updateFacilityRow(ctx, tx, facilityId, data);
  });
}
