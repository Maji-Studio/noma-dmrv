import { and, eq, sum } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, deliveries, type Application } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { GRAMS_PER_KG } from "@/lib/output-stock/exact";
import { MIX_BIN_CREDIT_HOLD_NOTICE, FACILITY_REFERENCE_TEMPERATURE_NOTICE } from "@/lib/application-guidance";
import { getApplicationAllocationShares } from "./delivery-allocation-provenance";
import { getMixBinHeldApplicationIds } from "./mix-bin-credit-hold";
import { getApplicationSiteDefaults } from "./application-site-defaults";
import { requireOrgScope } from "./utils";

/** Call only while holding the application's delivery write lock. */
export async function getApplicationRemainingWetMassKg(ctx: OrgContext, tx: DbTransaction, deliveryId: string) {
  requireOrgScope(ctx);
  const [delivery] = await tx.select({ wet: deliveries.deliveredWetMassKg }).from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, deliveryId)));
  const [applied] = await tx.select({ wet: sum(applications.biocharAppliedTons) }).from(applications)
    .where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.deliveryId, deliveryId)));
  return Math.max(0, Math.round((delivery.wet - tonnesToKg(Number(applied.wet ?? 0))) * Number(GRAMS_PER_KG)) / Number(GRAMS_PER_KG));
}

export async function getApplicationOperationOutput(ctx: OrgContext, tx: DbTransaction, application: Application, remainingWetMassKgBefore: number) {
  requireOrgScope(ctx);
  const shares = await getApplicationAllocationShares(ctx, [application.id], tx);
  const held = await getMixBinHeldApplicationIds(ctx, tx, [application.id]);
  const site = await getApplicationSiteDefaults(ctx, tx, application.deliveryId);
  const warnings: string[] = [];
  if (held.has(application.id)) warnings.push(MIX_BIN_CREDIT_HOLD_NOTICE);
  if (site?.durabilityOption === "200_year" && application.soilTemperatureC === null) warnings.push(FACILITY_REFERENCE_TEMPERATURE_NOTICE);
  return {
    application,
    allocations: shares.map(({ biocharProductId, productCode, productionRunId, productionRunCode, wetMassKg, dryMassKg }) => ({
      biocharProductId, productCode, productionRunId, productionRunCode, wetMassKg, dryBiocharKg: dryMassKg,
    })).sort((a, b) => a.biocharProductId.localeCompare(b.biocharProductId) || a.productionRunId.localeCompare(b.productionRunId)),
    deliveryBalance: { remainingWetMassKgBefore, remainingWetMassKgAfter: await getApplicationRemainingWetMassKg(ctx, tx, application.deliveryId) },
    warnings,
  };
}
export type ApplicationOperationOutput = Awaited<ReturnType<typeof getApplicationOperationOutput>>;
