/**
 * The per-record lock read the evidence panels use. It must agree with the
 * document writers' `certification_locked` refusal for the same owner, so the
 * panel never offers a change the server refuses (or hides one it accepts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { incidentReports, productionSamples, transportLegs, users } from "@/db/schema";
import { requestDocumentUploadInTransaction } from "@/data-access/document-writes";
import { getRecordCertificationLock } from "@/data-access/record-certification-lock";
import type { DocumentEntityType } from "@/schemas/documents";
import { cleanupLineageFixture, createLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const SUBMITTABLE_OWNERS = ["feedstock", "delivery", "sample", "application", "production_run", "transport_leg", "production_sample", "production_incident"] as const;
const UNLINEAGED_OWNERS = ["facility", "reactor"] as const;

interface ChildIds { legId: string; measurementId: string; incidentId: string }
function ownerId(fixture: LineageFixture, children: ChildIds, entityType: DocumentEntityType): string {
  const ids: Partial<Record<DocumentEntityType, string>> = {
    feedstock: fixture.feedstockId, delivery: fixture.deliveryId, sample: fixture.sampleId,
    application: fixture.applicationId, production_run: fixture.productionRunId, transport_leg: children.legId,
    production_sample: children.measurementId, production_incident: children.incidentId,
    facility: fixture.facilityId, reactor: fixture.reactorId,
  };
  return ids[entityType]!;
}

/** Whether commit 1's writer refuses a new upload on this owner, recording any row it creates. */
async function writerRefuses(entityType: DocumentEntityType, entityId: string, created: string[]): Promise<boolean> {
  const input = { entityType, entityId, documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "local-fs" };
  try {
    const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input));
    created.push(row.id);
    return false;
  } catch (error) {
    expect(error).toMatchObject({ code: "certification_locked" });
    return true;
  }
}

describe("getRecordCertificationLock", () => {
  beforeAll(() => ensureTestOrg());

  it.each([
    ["before submission", "none", false],
    ["after a Removal submission", "removal", true],
    ["after a GHG statement submission", "ghgStatement", true],
  ] as const)("answers %s for every submittable owner, agreeing with the writer", async (_label, blockingVia, expected) => {
    const fixture = await createLineageFixture(blockingVia);
    const created: string[] = [];
    let measurementId: string | undefined;
    let incidentId: string | undefined;
    await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
    try {
      const [leg] = await db.insert(transportLegs).values({ organizationId: ctx.organizationId, entityType: "feedstock", entityId: fixture.feedstockId, transportMethodType: "road", distanceKm: 1, loadMassKg: 1 }).returning();
      const [measurement] = await db.insert(productionSamples).values({ organizationId: ctx.organizationId, productionRunId: fixture.productionRunId, timestamp: new Date() }).returning(); measurementId = measurement.id;
      const [incident] = await db.insert(incidentReports).values({ organizationId: ctx.organizationId, productionRunId: fixture.productionRunId, incidentTime: new Date(), description: "Test incident", severity: "low" }).returning(); incidentId = incident.id;
      const children = { legId: leg.id, measurementId, incidentId };
      for (const entityType of SUBMITTABLE_OWNERS) {
        const entityId = ownerId(fixture, children, entityType);
        const locked = await getRecordCertificationLock(ctx, { entityType, entityId });
        expect({ entityType, locked }).toEqual({ entityType, locked: expected });
        expect({ entityType, refused: await writerRefuses(entityType, entityId, created) }).toEqual({ entityType, refused: locked });
      }
      for (const entityType of UNLINEAGED_OWNERS) {
        expect(await getRecordCertificationLock(ctx, { entityType, entityId: ownerId(fixture, children, entityType) })).toBe(false);
      }
    } finally {
      await cleanupDocumentUploads(ctx, created);
      if (measurementId) await db.delete(productionSamples).where(eq(productionSamples.id, measurementId));
      if (incidentId) await db.delete(incidentReports).where(eq(incidentReports.id, incidentId));
      await cleanupLineageFixture(fixture);
    }
  });

  it("refuses a record from another organization", async () => {
    const fixture = await createLineageFixture("removal");
    const foreign = { ...ctx, organizationId: "foreign-org" };
    try {
      const ownTypes = ["feedstock", "delivery", "sample", "application", "production_run"] as const;
      for (const entityType of ownTypes) {
        await expect(getRecordCertificationLock(foreign, { entityType, entityId: ownerId(fixture, { legId: "", measurementId: "", incidentId: "" }, entityType) })).rejects.toMatchObject({ code: "not_found" });
      }
    } finally {
      await cleanupLineageFixture(fixture);
    }
  });
});
