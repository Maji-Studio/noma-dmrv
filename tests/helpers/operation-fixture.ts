/**
 * A dedicated organization with one facility ready for feedstock intake, for
 * the operation-runner suites. Its own organization keeps generated feedstock
 * codes (`FS-YY-NNN`, sequenced per organization) free of other suites' rows.
 */

import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@/db";
import {
  apiIdempotencyRecords,
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  storageLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { DEFAULT_DB_POOL_LOCK_TIMEOUT_MS } from "@/db/pool-config";

export interface IntakeFixture {
  ctx: OrgContext;
  facilityId: string;
  supplierId: string;
  feedstockTypeId: string;
  binId: string;
  /** A valid `log_feedstock_delivery` input. */
  input: (wetMassKg?: number) => Record<string, unknown>;
}

export async function createIntakeFixture(
  label: string, executor: Pick<typeof db, "insert"> = db,
): Promise<IntakeFixture> {
  const tag = crypto.randomUUID().slice(0, 8);
  const organizationId = `org_op_${label}_${tag}`;
  await executor.insert(organizations).values({
    id: organizationId,
    name: `Operation ${label} ${tag}`,
    slug: `operation-${label}-${tag}`.toLowerCase(),
  });
  const [facility] = await executor
    .insert(facilities)
    .values({ organizationId, code: `FAC-${tag}`, name: `Intake Facility ${tag}` })
    .returning({ id: facilities.id });
  const [supplier] = await executor
    .insert(suppliers)
    .values({ organizationId, code: `SUP-${tag}`, name: `Wood Chip Supplier ${tag}` })
    .returning({ id: suppliers.id });
  const [feedstockType] = await executor
    .insert(feedstockTypes)
    .values({
      organizationId,
      code: `FT-${tag}`,
      name: `Wood chips ${tag}`,
      category: "forestry",
      usage: "pyrolysis" as const,
    })
    .returning({ id: feedstockTypes.id });
  const [bin] = await executor
    .insert(storageLocations)
    .values({
      organizationId,
      facilityId: facility.id,
      code: `B2-${tag}`,
      name: `Bin B2 ${tag}`,
      type: "feedstock_bin" as const,
    })
    .returning({ id: storageLocations.id });

  return {
    ctx: {
      userId: `user_op_${label}`,
      organizationId,
      orgRole: "owner",
      isPlatformAdmin: false,
    },
    facilityId: facility.id,
    supplierId: supplier.id,
    feedstockTypeId: feedstockType.id,
    binId: bin.id,
    input: (wetMassKg = 4200) => ({
      facilityId: facility.id,
      deliveryDate: "2026-10-06",
      supplierId: supplier.id,
      feedstockTypeId: feedstockType.id,
      totalWetMassKg: String(wetMassKg),
      moisturePercent: "32.5",
      allocations: [{ storageLocationId: bin.id, allocatedWetMassKg: wetMassKg }],
      transportDistanceKm: 18,
    }),
  };
}

export async function feedstockCount(fixture: IntakeFixture): Promise<number> {
  const rows = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(eq(feedstocks.organizationId, fixture.ctx.organizationId));
  return rows.length;
}

export async function removeIntakeFixture(fixture: IntakeFixture): Promise<void> {
  const organizationId = fixture.ctx.organizationId;
  await db.delete(transportLegs).where(eq(transportLegs.organizationId, organizationId));
  await db.delete(feedstocks).where(eq(feedstocks.organizationId, organizationId));
  await db.delete(storageLocations).where(eq(storageLocations.organizationId, organizationId));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, organizationId));
  await db.delete(suppliers).where(eq(suppliers.organizationId, organizationId));
  await db.delete(facilities).where(eq(facilities.organizationId, organizationId));
  await db
    .delete(apiIdempotencyRecords)
    .where(eq(apiIdempotencyRecords.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

/** A pool of its own, configured like the app's, for multi-connection races. */
export function createTestPool(max: number): Pool {
  return new Pool({
    ...getPgPoolConfig(process.env.DATABASE_URL!),
    max,
    lock_timeout: DEFAULT_DB_POOL_LOCK_TIMEOUT_MS,
  });
}
