import { and, eq } from "drizzle-orm";
import { facilities, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { resolveEventInstant } from "@/lib/operations/event-times";
import type { EventInstant } from "@/schemas/event-instant";
import { requireOrgScope, type Executor } from "./utils";

/** Child events use their saved run's facility clock, including on edit. */
export async function resolveProductionRunEventTime(
  ctx: OrgContext,
  executor: Executor,
  productionRunId: string,
  value: EventInstant,
  field: "incidentTime" | "timestamp",
): Promise<Date> {
  requireOrgScope(ctx);
  const [run] = await executor
    .select({ timeZone: facilities.timezone })
    .from(productionRuns)
    .innerJoin(facilities, and(eq(productionRuns.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));
  if (!run) throw new SafeError("Production run not found");
  return resolveEventInstant(value, run.timeZone, [field]);
}
