/**
 * Auto-generate entity codes when not provided
 * Format: {PREFIX}-{YYYY}-{NNN} (e.g., BP-2026-001)
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

/**
 * Generate the next sequential code for an entity.
 *
 * Queries the DB for the highest existing code matching the prefix + current year,
 * then returns the next sequential code.
 *
 * @param prefix - Entity prefix (e.g., "BP", "FAC")
 * @param table - Drizzle table reference
 * @param codeColumn - The code column on the table
 * @returns Next sequential code like "BP-2026-001"
 */
export async function generateNextCode(
  prefix: string,
  table: PgTable,
  codeColumn: PgColumn
): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;

  // Find the highest existing code number for this prefix + year
  const result = await db
    .select({
      maxCode: sql<string>`max(${codeColumn})`.as("max_code"),
    })
    .from(table)
    .where(sql`${codeColumn} like ${pattern}`);

  const maxCode = result[0]?.maxCode;
  let nextNumber = 1;

  if (maxCode) {
    // Extract the numeric suffix: "BP-2026-042" -> 42
    const parts = maxCode.split("-");
    const lastPart = parts[parts.length - 1];
    const parsed = parseInt(lastPart, 10);
    if (!isNaN(parsed)) {
      nextNumber = parsed + 1;
    }
  }

  const paddedNumber = String(nextNumber).padStart(3, "0");
  return `${prefix}-${year}-${paddedNumber}`;
}
