/**
 * Drivers Data Access Layer: list, read, edit and delete.
 *
 * Creation stays in `quick-add.ts`. A driver is operational metadata on a
 * delivery and never reaches a calculation, so every field is always editable.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { isPgForeignKeyViolation } from "@/db/errors";
import { drivers, type Driver } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { formatFleetDeleteBlocker } from "@/lib/fleet/messages";
import { countDriverUsage } from "./fleet-usage";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const DRIVER_CONFLICT_ENTITY = "driver";
const DRIVER_NOT_FOUND = "Driver not found";
const DRIVER_FK_CONSTRAINT = "deliveries_driver_id_drivers_id_fk";
const DRIVER_IN_USE =
  "Driver was not deleted because deliveries still use it. Choose another driver on those records, or keep this one.";

export interface UpdateDriverData {
  name: string;
  licenseNumber?: string | null;
  contactPhone?: string | null;
}

export async function listDrivers(ctx: OrgContext): Promise<Driver[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(drivers)
    .where(eq(drivers.organizationId, ctx.organizationId))
    .orderBy(asc(drivers.name), asc(drivers.id));
}

export async function getDriver(ctx: OrgContext, driverId: string): Promise<Driver | null> {
  requireOrgScope(ctx);
  const [driver] = await db
    .select()
    .from(drivers)
    .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, ctx.organizationId)));
  return driver ?? null;
}

export async function updateDriver(
  ctx: OrgContext,
  driverId: string,
  data: UpdateDriverData,
  expectedVersion: number,
): Promise<Driver> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: drivers.version })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, ctx.organizationId)))
      .for("update");
    if (!locked) throw new DomainError("not_found", DRIVER_NOT_FOUND);
    assertRowVersion({ entity: DRIVER_CONFLICT_ENTITY, id: driverId, expectedVersion, actualVersion: locked.version });

    const [updated] = await tx
      .update(drivers)
      .set({
        name: data.name,
        licenseNumber: data.licenseNumber ?? null,
        contactPhone: data.contactPhone ?? null,
        version: nextVersion(drivers.version),
        updatedAt: new Date(),
      })
      .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, ctx.organizationId)))
      .returning();
    return updated;
  });
}

export async function deleteDriver(
  ctx: OrgContext,
  driverId: string,
  expectedVersion: number,
): Promise<void> {
  requireOrgScope(ctx);
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ code: drivers.code, version: drivers.version })
        .from(drivers)
        .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, ctx.organizationId)))
        .for("update");
      if (!locked) throw new DomainError("not_found", DRIVER_NOT_FOUND);
      assertRowVersion({ entity: DRIVER_CONFLICT_ENTITY, id: driverId, expectedVersion, actualVersion: locked.version });

      const blocker = formatFleetDeleteBlocker("driver", locked.code, await countDriverUsage(ctx, tx, driverId));
      if (blocker) throw new DomainError("conflict", blocker);

      await tx
        .delete(drivers)
        .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, ctx.organizationId)));
    });
  } catch (error) {
    if (isPgForeignKeyViolation(error, DRIVER_FK_CONSTRAINT)) {
      throw new DomainError("conflict", DRIVER_IN_USE);
    }
    throw error;
  }
}
