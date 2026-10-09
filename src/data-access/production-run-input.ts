import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities, productionRuns, operators } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { runReferenceNotFound } from "@/lib/production-run-domain-errors";
import { requireOrgScope } from "./utils";

export async function readRunFacilityTimeZone(ctx: OrgContext, tx: DbTransaction, input: { facilityId?: string; productionRunId?: string }) {
  requireOrgScope(ctx);
  let facilityId = input.facilityId;
  if (!facilityId && input.productionRunId) {
    const [run] = await tx.select({ facilityId: productionRuns.facilityId }).from(productionRuns)
      .where(and(eq(productionRuns.id, input.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));
    if (!run) throw runReferenceNotFound("Production run not found");
    facilityId = run.facilityId;
  }
  const [facility] = await tx.select({ timeZone: facilities.timezone }).from(facilities)
    .where(and(eq(facilities.id, facilityId!), eq(facilities.organizationId, ctx.organizationId)));
  if (!facility) throw runReferenceNotFound("Facility not found or archived", ["facilityId"]);
  return facility.timeZone;
}

export async function assertRunOperator(ctx: OrgContext, tx: DbTransaction, id: string) {
  requireOrgScope(ctx);
  const [row] = await tx.select({ id: operators.id }).from(operators)
    .where(and(eq(operators.id, id), eq(operators.organizationId, ctx.organizationId)));
  if (!row) throw runReferenceNotFound("Operator not found in this organization", ["operatorId"]);
}
