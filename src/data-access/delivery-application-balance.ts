import { sql } from "drizzle-orm";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { requireOrgScope } from "./utils";

const GRAM_SCALE = 3;

/** Exact numeric arithmetic shared by the balance, discovery filter and writer outcomes. */
export function deliveryApplicationBalanceFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  const wet = sql`(select coalesce(sum(applied.biochar_applied_tons), 0) * ${KG_PER_TONNE}
    from applications applied where applied.organization_id = ${ctx.organizationId} and applied.delivery_id = ${deliveries.id})`;
  const dry = sql`(select coalesce(sum(applied.biochar_applied_dry_tons), 0) * ${KG_PER_TONNE}
    from applications applied where applied.organization_id = ${ctx.organizationId} and applied.delivery_id = ${deliveries.id})`;
  return {
    appliedWetMassKg: sql<number>`${wet}`.mapWith(Number),
    appliedDryBiocharKg: sql<number>`${dry}`.mapWith(Number),
    remainingWetMassKg: sql<number>`trunc(greatest(0::numeric, ${deliveries.deliveredWetMassKg}::numeric - ${wet}), ${GRAM_SCALE})`.mapWith(Number),
  };
}
