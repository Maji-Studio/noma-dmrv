import { z } from "zod";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import { loadDraftRemovalReadiness } from "./draft-removal-readiness";
import { draftRemovalAttentionItems } from "@/lib/certification/removal-attention";
import type { OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import { facilityIdSchema } from "./facility-id";

/** Row ids of interrupted submissions, single or grouped (`data-access/dashboard-overview.ts`). */
const INTERRUPTED_ROW_PREFIX = "removal-interrupted";

const dashboardOverviewInputSchema = z.object({
  facilityId: facilityIdSchema,
  range: z.enum(["week", "month", "all"]).default("month"),
});

/** Operator copy when the database schema lags the deployed dashboard. */
export const DASHBOARD_SCHEMA_MISMATCH_MESSAGE =
  "The dashboard and the database may be out of sync. Ask an administrator to apply the latest database update. Then reload this page.";

export type DashboardOverviewInput = z.input<typeof dashboardOverviewInputSchema>;

/**
 * One aggregate read per range selection: KPI band, traceability stations,
 * mass flow, attention queue and certification summary for one facility.
 */
export async function readDashboardOverview(ctx: OrgContext, input: unknown) {
  const { facilityId, range } = dashboardOverviewInputSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  // Draft Removals need the operator too; their readiness comes from the Removals list's read path.
  // They do not depend on the range and are best effort: a failure must never fail the dashboard.
  const [overview, draftReadiness] = await Promise.all([
    getDashboardOverview(ctx, facilityId, range),
    loadDraftRemovalReadiness(ctx, facilityId).catch(() => {
      logger.warn({ facilityId }, "Draft Removal rows skipped: readiness failed to load");
      return [];
    }),
  ]);
  const drafts = draftRemovalAttentionItems(draftReadiness, facilityId);
  return {
    ...overview,
    attention: withDraftRows(overview.attention, drafts),
    attentionTotal: overview.attentionTotal + drafts.length,
  };
}

/** Interrupted submissions lead the queue, so the draft rows go right after them. */
function withDraftRows<T extends { id: string }>(attention: readonly T[], drafts: readonly T[]): T[] {
  const lastInterrupted = attention.findLastIndex((item) => item.id.startsWith(INTERRUPTED_ROW_PREFIX));
  return [...attention.slice(0, lastInterrupted + 1), ...drafts, ...attention.slice(lastInterrupted + 1)];
}
