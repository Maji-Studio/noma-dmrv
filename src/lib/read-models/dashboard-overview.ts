import { z } from "zod";
import { pgErrorCode } from "@/db/errors";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import { loadRemovalAttentionSources } from "./removal-attention-sources";
import { NO_REMOVAL_ATTENTION, removalAttentionRows } from "@/lib/certification/removal-attention";
import type { OrgContext } from "@/lib/auth/server";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { facilityIdSchema } from "./facility-id";

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
  // Removals the operator has to act on (drafts, rejected, returned) join the attention queue. They do not
  // depend on the range. A list failure drops these rows; readiness failures keep drafts with an
  // unavailable title. The data-access aggregate owns their order, caps and totals.
  const removalAttention = loadRemovalAttentionSources(ctx, facilityId)
    .then((sources) => removalAttentionRows(sources, facilityId))
    .catch((error: unknown) => {
      const cause = error instanceof Error && typeof error.cause === "object" && error.cause !== null
        ? error.cause : undefined;
      logger.warn({
        facilityId,
        errorType: error instanceof Error ? sanitizeErrorMessage(error.name) : typeof error,
        errorCode: pgErrorCode(error),
        errorMessage: sanitizeErrorMessage(error),
        errorCauseMessage: cause && "message" in cause && typeof cause.message === "string"
          ? sanitizeErrorMessage(cause.message) : undefined,
      }, "Removal attention rows skipped: list failed to load");
      return NO_REMOVAL_ATTENTION;
    });
  return getDashboardOverview(ctx, facilityId, range, removalAttention);
}
