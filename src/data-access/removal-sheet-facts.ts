import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { projectRemovalSheetFacts, type RemovalSheetFacts } from "@/lib/certification/removal-sheet-facts";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { loadCreditBatchAccounting } from "./credit-batch-accounting";
import { requireOrgScope } from "./utils";

/** The batch links, dry mass, estimate, durability and sampling of one Removal. */
export async function loadRemovalSheetFacts(ctx: OrgContext, removalId: string): Promise<RemovalSheetFacts> {
  requireOrgScope(ctx);
  const batches = await getCreditBatchesByRemovalId(ctx, removalId);
  const accounting = await loadCreditBatchAccounting(ctx, batches.map((batch) => batch.id), { removalId });
  const facilityId = batches[0]?.facilityId;
  const [facility] = facilityId
    ? await db
        .select({ name: facilities.name })
        .from(facilities)
        .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
        .limit(1)
    : [];
  return projectRemovalSheetFacts(
    batches.map((batch) => ({
      id: batch.id,
      code: batch.code,
      durabilityOption: batch.durabilityOption,
      sampling: batch.sampling,
      appliedWeightTons: accounting[batch.id]?.appliedWeightTons ?? 0,
      co2eStoredTonnes: accounting[batch.id]?.co2ePreview.co2eStoredTonnes ?? null,
    })),
    facility?.name ?? null,
  );
}
