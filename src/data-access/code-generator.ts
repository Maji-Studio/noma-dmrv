/**
 * Auto-generate entity codes when not provided
 * Format: {PREFIX}-{YY}-{NNN} (e.g., BP-26-001)
 */

import { db } from "@/db";
import { and, eq, getTableName, sql } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { isPgUniqueViolation } from "@/db/errors";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 50;

export const CODE_CONFLICT_MESSAGES = {
  biocharProduct: "A biochar product with this code already exists",
  customer: "A customer with this code already exists",
  delivery: "A delivery with this code already exists",
  driver: "A driver with this code already exists",
  facility: "A facility with this code already exists",
  feedstockType: "A feedstock type with this code already exists",
  formulation: "A formulation with this code already exists",
  order: "An order with this code already exists",
  productionRun: "A production run with this code already exists",
  reactor: "A reactor with this code already exists",
  storageLocation: "A storage bin with this code already exists",
  supplier: "A supplier with this code already exists",
  vehicle: "A vehicle with this code already exists",
} as const;

type OrgScopedCodeTable = PgTable & {
  organizationId: PgColumn;
};

/** Two-digit current year for code generation (e.g. 2026 -> "26"). */
function currentYearShort(): string {
  return String(new Date().getFullYear() % 100).padStart(2, "0");
}

/**
 * Generate the next sequential code for an entity.
 *
 * Queries the DB for the highest existing code matching the prefix + current year,
 * then returns the next sequential code.
 *
 * @param prefix - Entity prefix (e.g., "BP", "FAC")
 * @param table - Drizzle table reference
 * @param codeColumn - The code column on the table
 * @returns Next sequential code like "BP-26-001"
 */
export async function generateNextCode(
  ctx: OrgContext,
  prefix: string,
  table: OrgScopedCodeTable,
  codeColumn: PgColumn
): Promise<string> {
  requireOrgScope(ctx);
  const year = currentYearShort();
  const pattern = `${prefix}-${year}-%`;

  // Find the highest existing suffix for this prefix + year. We MAX on the
  // integer suffix, not the raw code string — a lexicographic max picks
  // "ABC-26-999" over "ABC-26-1000" once the sequence exceeds 3 digits.
  const result = await db
    .select({
      maxSuffix: sql<
        number | null
      >`max(cast(substring(${codeColumn} from '[0-9]+$') as integer))`.as(
        "max_suffix",
      ),
    })
    .from(table)
    .where(
      and(
        eq(table.organizationId, ctx.organizationId),
        sql`${codeColumn} like ${pattern}`,
      ),
    );

  const maxSuffix = result[0]?.maxSuffix ?? null;
  const nextNumber = (maxSuffix ?? 0) + 1;

  const paddedNumber = String(nextNumber).padStart(3, "0");
  return `${prefix}-${year}-${paddedNumber}`;
}

/**
 * Generate multiple sequential codes in one call.
 * Avoids the duplicate code bug when generating codes before a batch insert.
 */
export async function generateNextCodes(
  ctx: OrgContext,
  prefix: string,
  table: OrgScopedCodeTable,
  codeColumn: PgColumn,
  count: number
): Promise<string[]> {
  requireOrgScope(ctx);
  const year = currentYearShort();
  const pattern = `${prefix}-${year}-%`;

  // MAX on the integer suffix (see generateNextCode for why the raw-string max
  // is wrong once the sequence passes 3 digits).
  const result = await db
    .select({
      maxSuffix: sql<
        number | null
      >`max(cast(substring(${codeColumn} from '[0-9]+$') as integer))`.as(
        "max_suffix",
      ),
    })
    .from(table)
    .where(
      and(
        eq(table.organizationId, ctx.organizationId),
        sql`${codeColumn} like ${pattern}`,
      ),
    );

  const maxSuffix = result[0]?.maxSuffix ?? null;
  const nextNumber = (maxSuffix ?? 0) + 1;

  return Array.from({ length: count }, (_, i) => {
    const paddedNumber = String(nextNumber + i).padStart(3, "0");
    return `${prefix}-${year}-${paddedNumber}`;
  });
}

/**
 * The constraint name Drizzle's `.unique()` on a code column emits:
 * `{table}_{column}_unique` (verified against drizzle/*.sql — e.g.
 * `facilities_code_unique`, `samples_sample_code_unique`).
 */
function codeUniqueConstraintName(table: PgTable, codeColumn: PgColumn): string {
  return `${getTableName(table)}_organization_id_${codeColumn.name}_unique`;
}

/**
 * Check if an error is a Postgres unique-constraint violation on THIS table's
 * code column. Reuses the shared `isPgUniqueViolation` (issue #395 / PR #408),
 * which unwraps Drizzle's error-cause chain and matches the driver's
 * `.code`/`.constraint` — matching the *specific* constraint so an unrelated
 * 23505 on the same table isn't mistaken for a code collision.
 */
function isCodeUniqueViolation(
  error: unknown,
  table: PgTable,
  codeColumn: PgColumn,
): boolean {
  return isPgUniqueViolation(error, codeUniqueConstraintName(table, codeColumn));
}

function duplicateCodeError(code: string, message?: string): SafeError {
  return new SafeError(
    message ?? `Code "${code}" already exists. Use a different code.`,
  );
}

/**
 * Translate this table's org-scoped code constraint on direct write paths.
 * Auto-code creates use `withAutoCode` instead so generated-code races retry.
 */
export async function withUniqueCodeGuard<T>(
  ctx: OrgContext,
  table: OrgScopedCodeTable,
  codeColumn: PgColumn,
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  try {
    return await fn();
  } catch (error) {
    if (isCodeUniqueViolation(error, table, codeColumn)) {
      throw new SafeError(message);
    }
    throw error;
  }
}

/**
 * Execute an insert operation with auto-generated code, retrying on
 * duplicate code collisions. This handles the race condition where
 * concurrent requests generate the same sequential code.
 *
 * @param prefix - Entity prefix (e.g., "OR", "FAC")
 * @param table - Drizzle table reference
 * @param codeColumn - The code column on the table
 * @param userCode - User-provided code (empty/undefined = auto-generate)
 * @param insertFn - Callback that performs the insert with the given code
 * @param duplicateMessage - Existing entity-specific duplicate-code copy
 * @returns The result from insertFn
 */
export async function withAutoCode<T>(
  ctx: OrgContext,
  prefix: string,
  table: OrgScopedCodeTable,
  codeColumn: PgColumn,
  userCode: string | undefined | null,
  insertFn: (code: string) => Promise<T>,
  duplicateMessage?: string,
): Promise<T> {
  requireOrgScope(ctx);
  // If user provided a code, use it directly with a friendly error on duplicates
  if (userCode) {
    try {
      return await insertFn(userCode);
    } catch (error) {
      if (isCodeUniqueViolation(error, table, codeColumn)) {
        throw duplicateCodeError(userCode, duplicateMessage);
      }
      throw error;
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = await generateNextCode(ctx, prefix, table, codeColumn);
    try {
      return await insertFn(code);
    } catch (error) {
      if (isCodeUniqueViolation(error, table, codeColumn)) {
        if (attempt < MAX_RETRIES - 1) {
          // Brief pause before retry to let the other transaction commit
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BACKOFF_BASE_MS * (attempt + 1)),
          );
          continue;
        }
        throw duplicateCodeError(code, duplicateMessage);
      }
      throw error;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new SafeError(
    `A unique code could not be generated after ${MAX_RETRIES} attempts. Enter a code manually.`,
  );
}
