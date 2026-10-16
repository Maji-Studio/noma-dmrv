/**
 * Friendly duplicate-name guards for the human-identifier uniqueness indexes
 * (issue #252): reactor identifier, storage-bin name, supplier name, customer
 * name, facility name. Each constraint is a case- and whitespace-insensitive
 * expression index (`lower(trim(...))`); the bound guards below own the
 * constraint name and user-facing message so every create/update path shares
 * one source of truth.
 */

import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { suppliers, customers } from "@/db/schema";
import { isPgUniqueViolation } from "@/db/errors";
import type { OrgContext } from "@/lib/auth/server";
import { partyNameConflict } from "@/lib/party-domain-errors";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

/**
 * Run `fn`; if it fails with the named unique-index violation (23505), rethrow
 * a friendly error built from the trimmed name. Every other error — notably
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
      const detail = message(name.trim());
      throw new SafeError(detail);
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

/** Roll back the failed write before looking up the reserved name through tx. */
async function withPartyNameGuard<T>(
  ctx: OrgContext,
  tx: DbTransaction,
  kind: "supplier" | "customer",
  name: string,
  fn: (savepoint: DbTransaction) => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  try {
    return await tx.transaction(fn);
  } catch (error) {
    if (!isPgUniqueViolation(error, `${kind}s_organization_id_name_unique`)) throw error;
    const table = kind === "supplier" ? suppliers : customers;
    const [clash] = await tx.select({ id: table.id, archivedAt: table.archivedAt }).from(table)
      .where(and(eq(table.organizationId, ctx.organizationId), sql`lower(trim(${table.name})) = lower(trim(${name}))`));
    const trimmedName = name.trim();
    if (clash?.archivedAt) {
      throw partyNameConflict(`A ${kind} named "${trimmedName}" is archived. Restore it, or choose another name.`, { [`${kind}Id`]: clash.id, archived: true });
    }
    throw partyNameConflict(`A ${kind} named "${trimmedName}" already exists. Rename the existing ${kind} to reuse this name.`);
  }
}

/** Supplier name is reserved within the organization, including archived rows. */
export const guardSupplierName = <T>(ctx: OrgContext, tx: DbTransaction, name: string, fn: (savepoint: DbTransaction) => Promise<T>) =>
  withPartyNameGuard(ctx, tx, "supplier", name, fn);

/** Customer name is reserved within the organization, including archived rows. */
export const guardCustomerName = <T>(ctx: OrgContext, tx: DbTransaction, name: string, fn: (savepoint: DbTransaction) => Promise<T>) =>
  withPartyNameGuard(ctx, tx, "customer", name, fn);
