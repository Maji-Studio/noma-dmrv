import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { DomainIssue } from "@/lib/domain-errors";
import { formulationNotFound } from "@/lib/formulation-domain-errors";
import { requireOrgScope } from "./utils";

/** Hold a bin claim's formulation stable until its transaction commits. */
export async function lockFormulationReference(ctx: OrgContext, tx: DbTransaction, formulationId: string, pointer: DomainIssue["path"] = ["formulationId"]): Promise<void> {
  requireOrgScope(ctx);
  const [row] = await tx.select({ id: formulations.id }).from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("share");
  if (!row) throw formulationNotFound(pointer);
}
