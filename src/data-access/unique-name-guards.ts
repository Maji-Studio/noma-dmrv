/**
 * Friendly duplicate-name guards for the human-identifier uniqueness indexes
 * (issue #252): reactor identifier, storage-bin name, supplier name, customer
 * name, facility name. Each constraint is a case- and whitespace-insensitive
 * expression index (`lower(trim(...))`); the bound guards below own the
 * constraint name and user-facing message so every create/update path shares
 * one source of truth.
 */

import { isPgUniqueViolation } from "@/db/errors";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

/**
 * Run `fn`; if it fails with the named unique-index violation (23505), rethrow
 * a friendly SafeError built from the trimmed name. Every other error — notably
 * the `_code_unique` 23505 that `withAutoCode` retries on — propagates
 * unchanged, so matching the *specific* constraint is essential.
 */
async function withUniqueNameGuard<T>(
  ctx: OrgContext,
  constraint: string,
  name: string,
  message: (trimmedName: string) => string,
  fn: () => Promise<T>
): Promise<T> {
  requireOrgScope(ctx);
  try {
    return await fn();
  } catch (err) {
    if (isPgUniqueViolation(err, constraint)) {
      throw new SafeError(message(name.trim()));
    }
    throw err;
  }
}

/** Facility name — unique within an organization. */
export const guardFacilityName = <T>(
  ctx: OrgContext,
  name: string,
  fn: () => Promise<T>,
) =>
  withUniqueNameGuard(
    ctx,
    "facilities_organization_id_name_unique",
    name,
    (n) =>
      `A facility named "${n}" already exists. Rename the existing facility to reuse this name.`,
    fn
  );

/** Reactor identifier — unique per facility. */
export const guardReactorIdentifier = <T>(
  ctx: OrgContext,
  identifier: string,
  fn: () => Promise<T>
) =>
  withUniqueNameGuard(
    ctx,
    "reactors_facility_identifier_unique",
    identifier,
    (n) =>
      `A reactor named "${n}" already exists in this facility. Rename the existing reactor to reuse this name.`,
    fn
  );

/** Storage-bin name — unique per facility. */
export const guardStorageLocationName = <T>(
  ctx: OrgContext,
  name: string,
  fn: () => Promise<T>,
) =>
  withUniqueNameGuard(
    ctx,
    "storage_locations_facility_name_unique",
    name,
    (n) =>
      `A storage bin named "${n}" already exists in this facility. Rename the existing one to reuse this name.`,
    fn
  );

/** Supplier name — unique within an organization. */
export const guardSupplierName = <T>(
  ctx: OrgContext,
  name: string,
  fn: () => Promise<T>,
) =>
  withUniqueNameGuard(
    ctx,
    "suppliers_organization_id_name_unique",
    name,
    (n) =>
      `A supplier named "${n}" already exists. Rename the existing supplier to reuse this name.`,
    fn
  );

/** Customer name — unique within an organization. */
export const guardCustomerName = <T>(
  ctx: OrgContext,
  name: string,
  fn: () => Promise<T>,
) =>
  withUniqueNameGuard(
    ctx,
    "customers_organization_id_name_unique",
    name,
    (n) =>
      `A customer named "${n}" already exists. Rename the existing customer to reuse this name.`,
    fn
  );
