import { db, type DbTransaction } from "@/db";
import { certifierRemovals } from "@/db/schema/certification";

const FIXTURE_TAG_LENGTH = 8;

type RemovalFixture = Omit<typeof certifierRemovals.$inferInsert, "code">;

/** Fixture-only codes stay outside the production RM-YY-NNN sequence. */
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
  const tag = crypto.randomUUID().slice(0, FIXTURE_TAG_LENGTH);
  return executor.insert(certifierRemovals)
    .values(rows.map((row, index) => ({ ...row, code: `RM-FX-${tag}-${index}` })))
    .returning();
}
