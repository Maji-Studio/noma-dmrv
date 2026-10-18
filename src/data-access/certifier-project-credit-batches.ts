import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { validateBatchPeriod } from "@/lib/certifier-policy";
import { SafeError } from "@/lib/errors";
import { recordActivity } from "./activity-events";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

/** Adopt active batches in the mapping transaction, under its advisory locks. */
export async function adoptCreditBatchesForIsometric(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  // Batch writers take facility SHARE before writing. UPDATE prevents a batch
  // from appearing or changing between this check and the mapping commit.
  const [facility] = await tx.select({ code: facilities.code, archivedAt: facilities.archivedAt }).from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .for("update");
  if (facility?.archivedAt) {
    throw new SafeError(`Facility ${facility.code} is archived. Restore it before linking it to Isometric.`);
  }
  const activeScope = and(
    eq(creditBatches.facilityId, facilityId),
    isNull(creditBatches.archivedAt),
  );
  const batches = await tx.select({
    code: creditBatches.code,
    startDate: creditBatches.startDate,
    endDate: creditBatches.endDate,
  }).from(creditBatches)
    .where(and(activeScope, eq(creditBatches.organizationId, ctx.organizationId)))
    .orderBy(creditBatches.code);
  const overlong = batches.filter(batch => validateBatchPeriod({ ...batch, certifier: "isometric" }));
  if (overlong.length > 0) {
    const codes = overlong.map(batch => batch.code).join(", ");
    const problem = overlong.length === 1
      ? `Credit batch ${codes} spans one calendar month or more.`
      : `Credit batches ${codes} span one calendar month or more.`;
    throw new SafeError(`${problem} Shorten or archive ${overlong.length === 1 ? "it" : "them"} before linking this facility to Isometric.`);
  }

  // Archived batches can exceed the cap, so leave their historical data alone.
  // Active batches need the stored provider for the DB's conditional backstop.
  const adopted = await tx.update(creditBatches).set({
    certifier: "isometric",
    version: nextVersion(creditBatches.version),
    updatedAt: new Date(),
  }).where(and(activeScope, isNull(creditBatches.certifier), eq(creditBatches.organizationId, ctx.organizationId)))
    .returning({ id: creditBatches.id });
  for (const batch of adopted) await recordActivity(ctx, tx, {
    entityType: "credit_batch", entityId: batch.id, creditBatchId: batch.id,
    facilityId, action: "updated", changedFields: ["certifier"], source: "form",
  });
}
