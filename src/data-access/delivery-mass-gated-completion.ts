import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { deliveries } from "@/db/schema/logistics";
import type { OrgContext } from "@/lib/auth/server";
import { MISSING_TRUCK_MASSES_GATE_REASON } from "@/lib/certification/biochar-application-gates";
import {
  getLockedCertifiedLineage,
  type LockedCertifiedLineageRow,
} from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

interface TruckMassCompletionInput {
  currentArrivalKg: number | null;
  currentDepartureKg: number | null;
  arrivalKg: number;
  departureKg: number;
}

interface MassGateRegistration {
  applicationId: string;
  creditBatchId: string;
  lifecycleStatus: "gated" | "confirmed" | "deleted";
  submittedPayload: unknown;
  payloadHash: string | null;
  gateReason: string | null;
}

function registrationKey(
  registration: Pick<MassGateRegistration, "applicationId" | "creditBatchId">,
): string {
  return `${registration.applicationId}:${registration.creditBatchId}`;
}

function canWaiveCompletedRemovalLineageLock(
  lineage: LockedCertifiedLineageRow[],
  registrations: MassGateRegistration[],
): boolean {
  if (lineage.length === 0 || registrations.length === 0) return false;

  const gatedRegistrationKeys = new Set(
    registrations
      .filter(
        (registration) =>
          registration.lifecycleStatus === "gated" &&
          registration.submittedPayload === null &&
          registration.payloadHash === null &&
          registration.gateReason === MISSING_TRUCK_MASSES_GATE_REASON,
      )
      .map(registrationKey),
  );
  if (gatedRegistrationKeys.size !== registrations.length) return false;

  return lineage.every(
    (row) =>
      row.removalStartedOn !== null &&
      row.removalCompletedOn !== null &&
      row.removalSubmissionType === "removal" &&
      row.removalSubmissionStatus === "submitted" &&
      row.ghgStatementSubmissionId === null &&
      row.applicationId !== null &&
      gatedRegistrationKeys.has(
        registrationKey({
          applicationId: row.applicationId,
          creditBatchId: row.creditBatchId,
        }),
      ),
  );
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
    const lineage = await getLockedCertifiedLineage(ctx, tx, {
      entityType: "delivery",
      entityId: deliveryId,
    });
    const registrations = await tx
      .select({
        applicationId: certifierBiocharApplications.applicationId,
        creditBatchId: certifierBiocharApplications.creditBatchId,
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
      ))
      .orderBy(certifierBiocharApplications.id)
      .for("update");
    if (!canWaiveCompletedRemovalLineageLock(lineage, registrations)) {
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
