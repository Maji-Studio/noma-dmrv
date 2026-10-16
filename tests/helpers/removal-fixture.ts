import { db, type DbTransaction } from "@/db";
import { certifierRemovals } from "@/db/schema/certification";
import { withAutoCodes } from "@/data-access/code-generator";
import { makeTestOrgContext } from "./test-org";

type RemovalFixture = Omit<typeof certifierRemovals.$inferInsert, "code">;
const REMOVAL_CODE_PREFIX = "RM";

/** Fixture-only insert: the same org-scoped generator and savepoint retries as real creates. */
export async function insertRemovalFixture(
  executor: typeof db | DbTransaction,
  input: RemovalFixture | RemovalFixture[],
) {
  const rows = Array.isArray(input) ? input : [input];
  if (rows.length === 0) return [];
  const organizationId = rows[0].organizationId;
  if (rows.some(row => row.organizationId !== organizationId)) {
    throw new Error("Removal fixtures must belong to one organization.");
  }
  const ctx = { ...makeTestOrgContext(), organizationId };
  return executor.transaction(tx => withAutoCodes(
    ctx, tx, REMOVAL_CODE_PREFIX, certifierRemovals, certifierRemovals.code, rows.length,
    (codes, savepoint) => savepoint.insert(certifierRemovals)
      .values(rows.map((row, index) => ({ ...row, code: codes[index] })))
      .returning(),
  ));
}
