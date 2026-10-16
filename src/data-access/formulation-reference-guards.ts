import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { DomainIssue } from "@/lib/domain-errors";
import { formulationArchived, formulationNotFound } from "@/lib/formulation-domain-errors";
import { requireOrgScope } from "./utils";

/** Hold a reference stable through commit. Kept references defer the archive check. */
export async function lockFormulationReference(ctx: OrgContext, tx: DbTransaction, formulationId: string, options: {
  pointer?: DomainIssue["path"];
  allowArchived?: boolean;
} = {}) {
  requireOrgScope(ctx);
  const pointer = options.pointer ?? ["formulationId"];
  const [row] = await tx.select().from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("share");
  if (!row) throw formulationNotFound(pointer);
  if (row.archivedAt && !options.allowArchived) throw formulationArchived(row.code, pointer);
  return row;
}
