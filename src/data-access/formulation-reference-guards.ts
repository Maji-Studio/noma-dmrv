import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formulationArchived, formulationNotFound } from "@/lib/formulation-domain-errors";
import { requireOrgScope } from "./utils";

/** Hold a reference stable through commit. Kept references defer the archive check. */
export async function lockFormulationReference(ctx: OrgContext, tx: DbTransaction, formulationId: string, options: {
  allowArchived?: boolean;
} = {}) {
  requireOrgScope(ctx);
  const [row] = await tx.select().from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("share");
  if (!row) throw formulationNotFound(["formulationId"]);
  if (row.archivedAt && !options.allowArchived) throw formulationArchived(row.code, ["formulationId"]);
  return row;
}
