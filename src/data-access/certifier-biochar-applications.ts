import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, withDedicatedSessionAdvisoryLock } from "@/db";
import { applications } from "@/db/schema/application";
import { creditBatches } from "@/db/schema/credits";
import {
  certifierBiocharApplications,
  type CertifierBiocharApplication,
} from "@/db/schema/certifier-biochar-applications";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { certifierStorageLocations } from "@/db/schema/certifier-storage-locations";
import { certifierProjects } from "@/db/schema/certification";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations } from "@/db/schema/parties";
import type { OrgContext } from "@/lib/auth/server";
import type { CreateBiocharApplicationRequest } from "@/lib/isometric/biochar-applications";
import { assertSameOrg, requireOrgScope } from "./utils";

type CertifierProvider = CertifierBiocharApplication["provider"];
const DEFAULT_PROVIDER: CertifierProvider = "isometric";

const BIOCHAR_APPLICATION_LOCK_SCOPE =
  "certifier-biochar-application:isometric";

/**
 * Serializes registry create/reconcile for one (application, credit batch)
 * registration so concurrent submissions cannot POST the same Biochar
 * Application twice.
 */
export async function withBiocharApplicationRegistrationLock<T>(
  ctx: OrgContext,
  input: { applicationId: string; creditBatchId: string },
  fn: () => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedSessionAdvisoryLock(
    `${BIOCHAR_APPLICATION_LOCK_SCOPE}:${ctx.organizationId}:${input.applicationId}:${input.creditBatchId}`,
    fn,
  );
}

export interface BiocharApplicationRegistryInput {
  applicationId: string;
  applicationCode: string;
  applicationDate: Date;
  appliedTonnes: number;
  fieldSizeHa: number | null;
  deliveryId: string;
  deliveryCode: string;
  deliveredWetMassKg: number | null;
  truckMassOnArrivalKg: number | null;
  truckMassOnDepartureKg: number | null;
  facilityId: string;
  certifierProjectId: string | null;
  externalProjectId: string | null;
  customerLocationId: string | null;
  customerLocationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Loads exact operator facts without allocating weights across credit batches. */
export async function getBiocharApplicationRegistryInputs(
  ctx: OrgContext,
  applicationIds: string[],
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<BiocharApplicationRegistryInput[]> {
  requireOrgScope(ctx);
  const ids = [...new Set(applicationIds)];
  if (ids.length === 0) return [];
  return db
    .select({
      applicationId: applications.id,
      applicationCode: applications.code,
      applicationDate: applications.applicationDate,
      appliedTonnes: applications.biocharAppliedTons,
      fieldSizeHa: applications.fieldSizeHa,
      deliveryId: deliveries.id,
      deliveryCode: deliveries.code,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      truckMassOnArrivalKg: deliveries.truckMassOnArrivalKg,
      truckMassOnDepartureKg: deliveries.truckMassOnDepartureKg,
      facilityId: deliveries.facilityId,
      certifierProjectId: certifierProjects.id,
      externalProjectId: certifierProjects.externalProjectId,
      customerLocationId: customerLocations.id,
      customerLocationName: customerLocations.name,
      latitude: customerLocations.gpsLatitude,
      longitude: customerLocations.gpsLongitude,
    })
    .from(applications)
    .innerJoin(
      deliveries,
      and(
        eq(applications.deliveryId, deliveries.id),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      certifierProjects,
      and(
        eq(certifierProjects.facilityId, deliveries.facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(applications.id, ids),
        eq(applications.organizationId, ctx.organizationId),
      ),
    );
}

export async function getBiocharApplicationRegistration(
  ctx: OrgContext,
  applicationId: string,
  creditBatchId: string,
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<CertifierBiocharApplication | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierBiocharApplications)
    .where(
      and(
        eq(certifierBiocharApplications.organizationId, ctx.organizationId),
        eq(certifierBiocharApplications.provider, provider),
        eq(certifierBiocharApplications.applicationId, applicationId),
        eq(certifierBiocharApplications.creditBatchId, creditBatchId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ClaimBiocharApplicationInput {
  applicationId: string;
  creditBatchId: string;
  productionBatchRegistrationId: string;
  storageLocationRegistrationId: string;
  externalProductionBatchId: string;
  externalStorageLocationId: string;
  supplierReference: string;
  submittedPayload: CreateBiocharApplicationRequest;
  payloadHash: string;
  observedGhgEntryId: string | null;
  observedRemovalId: string | null;
  provider?: CertifierProvider;
}

async function assertRegistryDependenciesAvailable(
  ctx: OrgContext,
  input: {
    applicationId: string;
    creditBatchId: string;
    productionBatchRegistrationId: string;
    storageLocationRegistrationId: string;
  },
  provider: CertifierProvider,
): Promise<void> {
  await Promise.all([
    assertSameOrg(ctx, applications, input.applicationId),
    assertSameOrg(ctx, creditBatches, input.creditBatchId),
  ]);
  const [productionBatch, storageLocation] = await Promise.all([
    db
      .select({ id: certifierProductionBatches.id })
      .from(certifierProductionBatches)
      .where(
        and(
          eq(certifierProductionBatches.id, input.productionBatchRegistrationId),
          eq(certifierProductionBatches.organizationId, ctx.organizationId),
          eq(certifierProductionBatches.creditBatchId, input.creditBatchId),
          eq(certifierProductionBatches.provider, provider),
        ),
      )
      .limit(1),
    db
      .select({ id: certifierStorageLocations.id })
      .from(certifierStorageLocations)
      .where(
        and(
          eq(certifierStorageLocations.id, input.storageLocationRegistrationId),
          eq(certifierStorageLocations.organizationId, ctx.organizationId),
          eq(certifierStorageLocations.provider, provider),
        ),
      )
      .limit(1),
  ]);
  if (!productionBatch[0] || !storageLocation[0]) {
    throw new Error(
      "Biochar Application registration references an unavailable registry dependency",
    );
  }
}

/** Inserts the durable in-flight claim before a non-idempotent remote POST. */
export async function claimBiocharApplicationRegistration(
  ctx: OrgContext,
  input: ClaimBiocharApplicationInput,
): Promise<CertifierBiocharApplication> {
  requireOrgScope(ctx);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  await assertRegistryDependenciesAvailable(ctx, input, provider);

  const [inserted] = await db
    .insert(certifierBiocharApplications)
    .values({
      organizationId: ctx.organizationId,
      provider,
      applicationId: input.applicationId,
      creditBatchId: input.creditBatchId,
      productionBatchRegistrationId: input.productionBatchRegistrationId,
      storageLocationRegistrationId: input.storageLocationRegistrationId,
      externalProductionBatchId: input.externalProductionBatchId,
      externalStorageLocationId: input.externalStorageLocationId,
      supplierReference: input.supplierReference,
      submittedPayload: input.submittedPayload,
      payloadHash: input.payloadHash,
      observedGhgEntryId: input.observedGhgEntryId,
      observedRemovalId: input.observedRemovalId,
      lifecycleStatus: "gated",
      correctionStatus: "none",
      gateReason: "create_in_flight",
    })
    .onConflictDoNothing({
      target: [
        certifierBiocharApplications.provider,
        certifierBiocharApplications.applicationId,
        certifierBiocharApplications.creditBatchId,
      ],
    })
    .returning();
  if (inserted) return inserted;
  const winner = await getBiocharApplicationRegistration(
    ctx,
    input.applicationId,
    input.creditBatchId,
    provider,
  );
  if (!winner) throw new Error("Biochar Application claim race produced no winner");
  return winner;
}

export interface RecordGatedBiocharApplicationInput {
  applicationId: string;
  creditBatchId: string;
  productionBatchRegistrationId: string;
  storageLocationRegistrationId: string;
  externalProductionBatchId: string;
  externalStorageLocationId: string;
  supplierReference: string;
  gateReason: string;
  provider?: CertifierProvider;
}

/**
 * Journals a Biochar Application whose registry POST is withheld (for example
 * a delivery without observed truck masses). The placeholder carries no
 * payload; a later submission with the masses upgrades it via
 * {@link activateGatedBiocharApplicationRegistration}. An existing row of any
 * lifecycle wins the conflict untouched.
 */
export async function recordGatedBiocharApplicationRegistration(
  ctx: OrgContext,
  input: RecordGatedBiocharApplicationInput,
): Promise<void> {
  requireOrgScope(ctx);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  await assertRegistryDependenciesAvailable(ctx, input, provider);
  await db
    .insert(certifierBiocharApplications)
    .values({
      organizationId: ctx.organizationId,
      provider,
      applicationId: input.applicationId,
      creditBatchId: input.creditBatchId,
      productionBatchRegistrationId: input.productionBatchRegistrationId,
      storageLocationRegistrationId: input.storageLocationRegistrationId,
      externalProductionBatchId: input.externalProductionBatchId,
      externalStorageLocationId: input.externalStorageLocationId,
      supplierReference: input.supplierReference,
      submittedPayload: null,
      payloadHash: null,
      observedGhgEntryId: null,
      observedRemovalId: null,
      lifecycleStatus: "gated",
      correctionStatus: "none",
      gateReason: input.gateReason,
    })
    .onConflictDoNothing({
      target: [
        certifierBiocharApplications.provider,
        certifierBiocharApplications.applicationId,
        certifierBiocharApplications.creditBatchId,
      ],
    });
}

/**
 * Upgrades a payload-less gated placeholder into the in-flight claim once the
 * delivery's truck masses exist. Guarded on the null payload hash so a real
 * in-flight or confirmed registration is never overwritten; returns null when
 * the row no longer matches that placeholder state.
 */
export async function activateGatedBiocharApplicationRegistration(
  ctx: OrgContext,
  input: {
    registrationId: string;
    applicationId: string;
    creditBatchId: string;
    productionBatchRegistrationId: string;
    storageLocationRegistrationId: string;
    externalProductionBatchId: string;
    externalStorageLocationId: string;
    supplierReference: string;
    submittedPayload: CreateBiocharApplicationRequest;
    payloadHash: string;
    provider?: CertifierProvider;
  },
): Promise<CertifierBiocharApplication | null> {
  requireOrgScope(ctx);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  await assertRegistryDependenciesAvailable(ctx, input, provider);
  const [row] = await db
    .update(certifierBiocharApplications)
    .set({
      productionBatchRegistrationId: input.productionBatchRegistrationId,
      storageLocationRegistrationId: input.storageLocationRegistrationId,
      externalProductionBatchId: input.externalProductionBatchId,
      externalStorageLocationId: input.externalStorageLocationId,
      supplierReference: input.supplierReference,
      submittedPayload: input.submittedPayload,
      payloadHash: input.payloadHash,
      gateReason: "create_in_flight",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierBiocharApplications.id, input.registrationId),
        eq(certifierBiocharApplications.organizationId, ctx.organizationId),
        eq(certifierBiocharApplications.provider, provider),
        eq(certifierBiocharApplications.applicationId, input.applicationId),
        eq(certifierBiocharApplications.creditBatchId, input.creditBatchId),
        eq(certifierBiocharApplications.lifecycleStatus, "gated"),
        isNull(certifierBiocharApplications.payloadHash),
      ),
    )
    .returning();
  return row ?? null;
}

export async function confirmBiocharApplicationRegistration(
  ctx: OrgContext,
  input: {
    registrationId: string;
    expectedPayloadHash: string;
    externalApplicationId: string;
    observedGhgEntryId: string | null;
    observedRemovalId: string | null;
  },
): Promise<CertifierBiocharApplication> {
  requireOrgScope(ctx);
  const [row] = await db
    .update(certifierBiocharApplications)
    .set({
      externalApplicationId: input.externalApplicationId,
      observedGhgEntryId: input.observedGhgEntryId,
      observedRemovalId: input.observedRemovalId,
      lifecycleStatus: "confirmed",
      correctionStatus: "none",
      gateReason: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierBiocharApplications.id, input.registrationId),
        eq(certifierBiocharApplications.organizationId, ctx.organizationId),
        eq(certifierBiocharApplications.payloadHash, input.expectedPayloadHash),
      ),
    )
    .returning();
  if (!row) {
    throw new Error("Biochar Application claim changed before confirmation");
  }
  return row;
}

export async function markBiocharApplicationDrift(
  ctx: OrgContext,
  registrationId: string,
  reason: string,
): Promise<void> {
  requireOrgScope(ctx);
  await db
    .update(certifierBiocharApplications)
    .set({
      correctionStatus: "review_required",
      gateReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierBiocharApplications.id, registrationId),
        eq(certifierBiocharApplications.organizationId, ctx.organizationId),
      ),
    );
}
