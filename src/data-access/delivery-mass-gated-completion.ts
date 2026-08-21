import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { deliveries } from "@/db/schema/logistics";
import type { OrgContext } from "@/lib/auth/server";
import { MISSING_TRUCK_MASSES_GATE_REASON } from "@/lib/certification/biochar-application-gates";
import { requireOrgScope } from "./utils";

interface TruckMassCompletionInput {
  currentArrivalKg: number | null;
  currentDepartureKg: number | null;
  arrivalKg: number;
  departureKg: number;
}

/**
 * Completes only the missing truck observations behind payload-less mass gates.
 * All normal delivery edits continue through the certified-lineage lock.
 */
export async function completeMassGatedDeliveryTruckMasses(
  ctx: OrgContext,
  deliveryId: string,
  input: TruckMassCompletionInput,
): Promise<boolean> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const registrations = await tx
      .select({
        lifecycleStatus: certifierBiocharApplications.lifecycleStatus,
        submittedPayload: certifierBiocharApplications.submittedPayload,
        payloadHash: certifierBiocharApplications.payloadHash,
        gateReason: certifierBiocharApplications.gateReason,
      })
      .from(certifierBiocharApplications)
      .innerJoin(
        applications,
        and(
          eq(applications.id, certifierBiocharApplications.applicationId),
          eq(applications.organizationId, ctx.organizationId),
        ),
      )
      .where(and(
        eq(applications.deliveryId, deliveryId),
        eq(certifierBiocharApplications.organizationId, ctx.organizationId),
      ));
    if (
      registrations.length === 0 ||
      registrations.some(
        (registration) =>
          registration.lifecycleStatus !== "gated" ||
          registration.submittedPayload !== null ||
          registration.payloadHash !== null ||
          registration.gateReason !== MISSING_TRUCK_MASSES_GATE_REASON,
      )
    ) {
      return false;
    }

    const arrivalPredicate = input.currentArrivalKg == null
      ? isNull(deliveries.truckMassOnArrivalKg)
      : eq(deliveries.truckMassOnArrivalKg, input.currentArrivalKg);
    const departurePredicate = input.currentDepartureKg == null
      ? isNull(deliveries.truckMassOnDepartureKg)
      : eq(deliveries.truckMassOnDepartureKg, input.currentDepartureKg);
    const [updated] = await tx
      .update(deliveries)
      .set({
        truckMassOnArrivalKg: input.arrivalKg,
        truckMassOnDepartureKg: input.departureKg,
        updatedAt: new Date(),
      })
      .where(and(
        eq(deliveries.id, deliveryId),
        eq(deliveries.organizationId, ctx.organizationId),
        arrivalPredicate,
        departurePredicate,
      ))
      .returning({ id: deliveries.id });
    return updated !== undefined;
  });
}
