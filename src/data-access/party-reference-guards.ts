import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { suppliers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { partyRefusal } from "@/lib/party-domain-errors";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { requireOrgScope } from "./utils";

export async function lockSupplierReference(ctx: OrgContext, tx: DbTransaction, supplierId: string): Promise<void> {
  requireOrgScope(ctx);
  const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).for("key share");
  if (!supplier) throw partyRefusal("not_found", "Supplier was not found in this Organization.", ["supplierId"]);
}

/** Acquire the complete facility set before inserting the parent or any child. */
export async function lockPartyFacilities(ctx: OrgContext, tx: DbTransaction, locations: { facilityDistances?: FacilityDistanceInput[] }[]): Promise<void> {
  requireOrgScope(ctx);
  const references = locations.flatMap((location, i) => (location.facilityDistances ?? []).map((pair, j) => ({ id: pair.facilityId, path: ["locations", i, "facilityDistances", j, "facilityId"] })));
  references.sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.id)) continue;
    try { await lockActiveFacilityReference(ctx, tx, reference.id); }
    catch (error) {
      if (error instanceof SafeError) throw partyRefusal("not_found", error.message, reference.path);
      throw error;
    }
    seen.add(reference.id);
  }
}
