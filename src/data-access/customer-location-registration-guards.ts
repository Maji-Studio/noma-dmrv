import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { CustomerLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { certifierStorageSiteLockKey } from "@/lib/certification/certifier-storage-site-lock";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { customerLocationCertificationLocked, storageSiteRegistrationBusy } from "@/lib/party-domain-errors";
import type { UpdateCustomerLocationInput } from "@/schemas/customer-location-input";
import { findCustomerLocationRegistrations } from "./certifier-storage-locations";
import { requireOrgScope } from "./utils";

/**
 * Never wait while holding a pooled connection needed by registration. Writers
 * take the fence shared, so they conflict only with registration's exclusive
 * session lock, not with each other (row locks already serialize writers).
 */
export async function tryLockStorageSiteRegistration(ctx: OrgContext, tx: DbTransaction, locationId: string): Promise<void> {
  requireOrgScope(ctx);
  const key = certifierStorageSiteLockKey(ctx.organizationId, locationId);
  const result = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${key}, 0)) as acquired`);
  if (!result.rows[0].acquired) throw storageSiteRegistrationBusy();
}

/**
 * Caller holds the site fence and location row. A change passes only when the
 * rebuilt registry body hashes to every mapping's stored hash, the same exact
 * comparison local drift uses, so a passing save never leaves a site drifted.
 */
export async function assertRegisteredStorageSiteUnchanged(
  ctx: OrgContext, tx: DbTransaction, locked: Pick<CustomerLocation, "id" | "name" | "gpsLatitude" | "gpsLongitude">, data: Pick<UpdateCustomerLocationInput, "name" | "gpsLatitude" | "gpsLongitude">,
): Promise<void> {
  requireOrgScope(ctx);
  const fields = ["name", "gpsLatitude", "gpsLongitude"] as const;
  const changed = fields.find(field => data[field] !== undefined && data[field] !== locked[field]);
  if (!changed) return;
  const mappings = await findCustomerLocationRegistrations(ctx, tx, locked.id);
  const name = data.name ?? locked.name;
  const latitude = data.gpsLatitude ?? locked.gpsLatitude;
  const longitude = data.gpsLongitude ?? locked.gpsLongitude;
  const matchesEveryRegistration = mappings.every(({ submittedPayload: payload, payloadHash: registeredHash }) =>
    typeof payload.supplier_reference_id === "string" &&
    payloadHash(buildCreateStorageLocationRequest({
      externalProjectId: payload.project_id, name, latitude, longitude, supplierReferenceId: payload.supplier_reference_id,
    })) === registeredHash,
  );
  if (!matchesEveryRegistration) throw customerLocationCertificationLocked(changed);
}
