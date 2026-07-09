/**
 * Friendly duplicate-name guards for the human-identifier uniqueness indexes
 * (issue #252): reactor identifier, storage-bin name, supplier name, customer
 * name. Each constraint is a case- and whitespace-insensitive expression index
 * (`lower(trim(...))`); the four bound guards below own the constraint name and
 * user-facing message so every create/update path shares one source of truth.
 */

import { isPgUniqueViolation } from "@/db/errors";
import { SafeError } from "@/lib/errors";

/**
 * Run `fn`; if it fails with the named unique-index violation (23505), rethrow
 * a friendly SafeError built from the trimmed name. Every other error — notably
 * the `_code_unique` 23505 that `withAutoCode` retries on — propagates
 * unchanged, so matching the *specific* constraint is essential.
 */
async function withUniqueNameGuard<T>(
  constraint: string,
  name: string,
  message: (trimmedName: string) => string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgUniqueViolation(err, constraint)) {
      throw new SafeError(message(name.trim()));
    }
    throw err;
  }
}

/** Reactor identifier — unique per facility. */
export const guardReactorIdentifier = <T>(
  identifier: string,
  fn: () => Promise<T>
) =>
  withUniqueNameGuard(
    "reactors_facility_identifier_unique",
    identifier,
    (n) =>
      `A reactor named "${n}" already exists in this facility. Rename the existing reactor to reuse this name.`,
    fn
  );

/** Storage-bin name — unique per facility. */
export const guardStorageLocationName = <T>(name: string, fn: () => Promise<T>) =>
  withUniqueNameGuard(
    "storage_locations_facility_name_unique",
    name,
    (n) =>
      `A storage location named "${n}" already exists in this facility. Rename the existing one to reuse this name.`,
    fn
  );

/** Supplier name — globally unique. */
export const guardSupplierName = <T>(name: string, fn: () => Promise<T>) =>
  withUniqueNameGuard(
    "suppliers_name_unique",
    name,
    (n) =>
      `A supplier named "${n}" already exists. Rename the existing supplier to reuse this name.`,
    fn
  );

/** Customer name — globally unique. */
export const guardCustomerName = <T>(name: string, fn: () => Promise<T>) =>
  withUniqueNameGuard(
    "customers_name_unique",
    name,
    (n) =>
      `A customer named "${n}" already exists. Rename the existing customer to reuse this name.`,
    fn
  );
