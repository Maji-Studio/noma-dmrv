import { and, eq, ne } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { customerLocations, supplierLocations } from "@/db/schema";
import type { CaptureActivity } from "@/lib/activity-changes";
import type { OrgContext } from "@/lib/auth/server";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

interface DefaultPartyLocationOptions {
  kind: "customer" | "supplier";
  parentId: string;
  exceptLocationId?: string;
  captureLocation?: CaptureActivity;
}

/** Demote before promotion, after the caller has taken its parent/child locks. */
export async function demoteDefaultPartyLocation(
  ctx: OrgContext,
  tx: DbTransaction,
  { kind, parentId, exceptLocationId, captureLocation }: DefaultPartyLocationOptions,
): Promise<void> {
  requireOrgScope(ctx);
  const table = kind === "customer" ? customerLocations : supplierLocations;
  const parentColumn = kind === "customer" ? customerLocations.customerId : supplierLocations.supplierId;
  const scope = and(
    eq(table.organizationId, ctx.organizationId),
    eq(parentColumn, parentId),
    eq(table.isDefault, true),
    exceptLocationId === undefined ? undefined : ne(table.id, exceptLocationId),
  );
  const siblings = await tx.select().from(table).where(scope);
  const demoted = await tx.update(table)
    .set({ version: nextVersion(table.version), isDefault: false, updatedAt: new Date() })
    .where(scope).returning();
  for (const sibling of demoted) {
    captureLocation?.(sibling.id, siblings.find(row => row.id === sibling.id)!, sibling);
  }
}
