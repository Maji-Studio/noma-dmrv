import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, facilities, type Facility } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { hasBlockingFacilitySubmission } from "./certification";
import {
  CODE_CONFLICT_MESSAGES,
  withUniqueCodeGuard,
} from "./code-generator";
import { acquireFacilityDurabilityLock } from "./facility-durability-lock";
import { guardFacilityName } from "./unique-name-guards";
import { requireOrgScope } from "./utils";

const TIER_LOCKING_BATCH_STATUSES = ["verified", "issued"] as const;

interface FacilityUpdateData {
  code?: string;
  name?: string;
  country?: string;
  location?: string | null;
  address?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  timezone?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  durabilityOption?: "200_year" | "1000_year";
}

export async function createFacility(
  ctx: OrgContext,
  data: {
    code: string;
    name: string;
    country: string;
    location?: string | null;
    address?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
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
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
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
          .set({ ...data, updatedAt: new Date() })
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
  data: FacilityUpdateData,
): Promise<Facility> {
  requireOrgScope(ctx);
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
    // real tier edit. It intentionally takes no lock and runs no ledger probe.
    const nonTierData = { ...data };
    delete nonTierData.durabilityOption;
    return updateFacilityRow(ctx, db, facilityId, nonTierData);
  }

  return db.transaction(async (tx) => {
    await acquireFacilityDurabilityLock(ctx, tx, facilityId);
    const [lockedExisting] = await tx
      .select({ durabilityOption: facilities.durabilityOption })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, facilityId),
          eq(facilities.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!lockedExisting) throw new SafeError("Facility not found");

    if (data.durabilityOption === lockedExisting.durabilityOption) {
      const nonTierData = { ...data };
      delete nonTierData.durabilityOption;
      return updateFacilityRow(ctx, tx, facilityId, nonTierData);
    }

    const [blockingBatch] = await tx
      .select({ id: creditBatches.id })
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.facilityId, facilityId),
          eq(creditBatches.organizationId, ctx.organizationId),
          isNull(creditBatches.archivedAt),
          inArray(creditBatches.status, TIER_LOCKING_BATCH_STATUSES),
        ),
      )
      .limit(1);
    const tierIsLocked =
      blockingBatch !== undefined ||
      (await hasBlockingFacilitySubmission(ctx, tx, facilityId, "isometric"));
    if (tierIsLocked) {
      throw new SafeError(
        "Cannot change this facility's durability tier: it has verified or issued credit batches, or registry submissions, built under the current tier. Archive or reassign those before changing the tier.",
      );
    }

    return updateFacilityRow(ctx, tx, facilityId, data);
  });
}
