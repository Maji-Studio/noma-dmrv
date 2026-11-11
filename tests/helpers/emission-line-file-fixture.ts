import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierRemovals, creditBatchApplications,
  creditBatches, emissionEntries, emissionEntryValues, removalTemplateObservations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SOURCE_IDS } from "@/lib/isometric/template-observations/catalog-sources";
import { createActivityWriteFixture, cleanupActivityWriteFixture } from "./activity-write-fixture";
import { insertOutputApplicationFixture } from "./output-contract-fixtures";
import { insertRemovalFixture } from "./removal-fixture";

export const COMPONENT_ID = "electricity";
export const INPUT_SHAPE = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
export const FILE_UPLOAD = { documentType: "pdf" as const, fileName: "proof.pdf", contentType: "application/pdf", sizeBytes: 10 };
export const FILE_STORAGE = { storageProvider: "local-fs", storageBucket: "test" };
export const REMOVAL_SENT_AT = new Date("2026-02-01T00:00:00Z");
export const STATEMENT_SENT_AT = "2026-02-02T00:00:00Z";

export async function createEmissionLineFileFixture() {
  const ctx: OrgContext = { organizationId: `component-file-${crypto.randomUUID()}`, userId: crypto.randomUUID(), orgRole: "admin", isPlatformAdmin: false };
  const records = await createActivityWriteFixture(ctx);
  const [observation] = await db.insert(removalTemplateObservations).values({
    organizationId: ctx.organizationId, provider: "isometric", externalProjectId: "project", externalTemplateId: crypto.randomUUID(),
    semanticFingerprint: "component-proof", fullFingerprint: "component-proof",
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Pyrolysis", description: "", components: [
      { id: COMPONENT_ID, displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use", inputs: INPUT_SHAPE },
      { id: "manual", displayName: "Manual", description: null, blueprintKey: "grid_electricity_use", inputs: INPUT_SHAPE },
    ] }] },
    enrichment: { [COMPONENT_ID]: { electricity_use: { unit: "kWh" } }, manual: { electricity_use: { unit: "kWh" } } },
    lineSources: {
      [COMPONENT_ID]: { scope: "operating", automaticSource: SOURCE_IDS.totalElectricityKwh, entryPolicy: "additive", origin: "reviewed", filePolicy: "lineFile" },
      manual: { scope: "operating", entryPolicy: "additive", origin: "reviewed", filePolicy: "entryFiles" },
    },
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: observation.externalTemplateId }).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, records.batch.id),
  ));
  const [removal] = await insertRemovalFixture(db, { organizationId: ctx.organizationId, facilityId: records.facility.id });
  const [application] = await insertOutputApplicationFixture(db, {
    organizationId: ctx.organizationId, code: "PROOF-AP", deliveryId: records.delivery.id,
    applicationDate: new Date("2026-01-16T00:00:00Z"), biocharAppliedTons: 0.1, biocharAppliedDryTons: 0.08,
    fieldSizeHa: 1, gpsLatitude: -8.3, gpsLongitude: 35.3,
  }, row => row);
  await db.insert(creditBatchApplications).values({ organizationId: ctx.organizationId,
    creditBatchId: records.batch.id, applicationId: application.id, allocatedWetMassKg: 100, allocatedDryMassKg: 80, removalId: removal.id,
  });
  return { ctx, ...records, observation, removal };
}
export type EmissionLineFileFixture = Awaited<ReturnType<typeof createEmissionLineFileFixture>>;

export async function cleanupEmissionLineFileFixture(fixture: EmissionLineFileFixture) {
  const { ctx } = fixture;
  await db.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: null, productionEmissionsClaimReservedBySubmissionId: null })
    .where(eq(creditBatches.organizationId, ctx.organizationId));
  for (const table of [emissionEntryValues, emissionEntries, removalTemplateObservations, creditBatchApplications,
    certificationSubmissions, certifierRemovals, certifierGhgStatements]) {
    await db.delete(table).where(eq(table.organizationId, ctx.organizationId));
  }
  await cleanupActivityWriteFixture(ctx);
}

/** The snapshot freezes once the submission leaves draft, so set it at insert. */
export async function claimEmissionLineFileFixture(fixture: EmissionLineFileFixture, kind: "claimed" | "reserved" | "returned",
  payloadSnapshot: Record<string, unknown> = {}) {
  const { ctx, batch, removal, facility } = fixture;
  const externalId = `remote-${removal.id}`;
  const [submission] = await db.insert(certificationSubmissions).values({
    organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal",
    localEntityId: removal.id, version: 1, status: kind === "reserved" ? "draft" : "submitted",
    lockedAt: kind === "reserved" ? new Date() : null, externalId: kind === "reserved" ? null : externalId,
    submittedAt: kind === "reserved" ? null : REMOVAL_SENT_AT, payloadHash: crypto.randomUUID(), payloadSnapshot,
  }).returning();
  await db.update(creditBatches).set(kind === "reserved"
    ? { productionEmissionsClaimReservedBySubmissionId: submission.id }
    : { productionEmissionsClaimedByRemovalId: removal.id }).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id),
  ));
  if (kind === "returned") {
    const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: ctx.organizationId,
      facilityId: facility.id, reportingPeriodEndOn: "2026-01-31",
    }).returning();
    await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, removal.id),
    ));
    await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric",
      submissionType: "ghg_statement", localEntityType: "ghgStatement", localEntityId: statement.id, version: 1,
      status: "submitted", externalId: `remote-${statement.id}`, submittedAt: new Date(STATEMENT_SENT_AT),
      payloadHash: crypto.randomUUID(), payloadSnapshot: {},
      metadata: { remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: STATEMENT_SENT_AT, removalIds: [externalId] },
    });
  }
  return { submission, externalId };
}
