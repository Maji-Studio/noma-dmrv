import { insertRemovalFixture } from "./helpers/removal-fixture";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  certificationSubmissions,
  creditBatches,
  certifierRemovals,
  facilities,
  documents,
  emissionEntries,
  emissionEntryValues,
  organizations,
  removalTemplateObservations,
  storageObjectDeletions,
  transportLegs,
  users,
} from "@/db/schema";
import {
  createEmissionEntry,
  updateEmissionEntry,
  deleteEmissionEntry,
  confirmEmissionEntry,
  getEmissionEntry,
  listEmissionEntries,
} from "@/data-access/emission-entries";
import { deleteCreditBatch } from "@/data-access/credit-batches";
import { insertDocument, listDocumentsForEntity, listDocumentsForEntityIds } from "@/data-access/documents";
import {
  requestDocumentUploadInTransaction,
  confirmDocumentUploadInTransaction,
  uploadFactsFor,
} from "@/data-access/document-writes";
import { deleteDocumentInTransaction } from "@/data-access/document-mutations";
import { createTransportLeg } from "@/data-access/transport-legs";
import { loadFacilityEmissionsOverview } from "@/lib/read-models/facility-emissions-overview";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import {
  createLineageFixture,
  cleanupLineageFixture,
  type LineageFixture,
} from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return {
    ...original,
    env: {
      ...original.env,
      get EMISSIONS_ENTRIES_ENABLED() {
        return flag.enabled;
      },
    },
  };
});
const userId = `emission-entry-user-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const otherOrg = `emission-entry-org-${crypto.randomUUID()}`;
const templateId = `entry-template-${crypto.randomUUID()}`;
let lineage: LineageFixture;
let observationId: string;
const entryIds: string[] = [];
const submissionIds: string[] = [];
const storageKeys: string[] = [];
const extraRemovalIds: string[] = [];
function definition(): EntryObservation {
  const inputs = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
  return {
    externalTemplateId: templateId,
    definition: {
      groups: [
        {
          id: "group",
          key: "pyrolysis",
          displayName: "Group",
          description: "",
          components: [
            {
              id: "energy",
              displayName: "Lab electricity",
              description: "Recorded electricity",
              blueprintKey: "grid_electricity_use",
              inputs,
            },
            {
              id: "meter",
              displayName: "Meter",
              description: null,
              blueprintKey: "metered_energy_based_ci_emissions",
              inputs: ["initial_readout", "final_readout"].map((key) => ({
                key,
                type: "monitored",
                quantityKind: "energy",
              })),
            },
          ],
        },
      ],
    },
    enrichment: {
      energy: { electricity_use: { unit: "kWh" } },
      meter: { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } },
    },
    lineSources: {
      energy: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      meter: { scope: "operating", entryPolicy: "single", origin: "reviewed" },
    },
  };
}
async function create(componentId = "energy") {
  const values =
    componentId === "meter"
      ? ["initial_readout", "final_readout"].map((inputKey) => ({
          inputKey,
          quantityKind: "energy" as const,
          magnitude: "1",
          unit: "kWh",
        }))
      : [{ inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "0.1", unit: "kWh" }];
  const entry = await createEmissionEntry(ctx, {
    creditBatchId: lineage.batchId,
    componentId,
    occurredOn: "2026-06-13",
    values,
  });
  entryIds.push(entry.id);
  return entry;
}
async function claim(entryId: string, kind: "reserved" | "sent") {
  if (kind === "sent") {
    await db
      .update(emissionEntries)
      .set({ sentByRemovalId: lineage.removalId })
      .where(eq(emissionEntries.id, entryId));
    return;
  }
  const [submission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: lineage.removalId,
      version: submissionIds.length + 1,
      status: "draft",
    })
    .returning();
  submissionIds.push(submission.id);
  await db
    .update(emissionEntries)
    .set({ sendReservedBySubmissionId: submission.id })
    .where(eq(emissionEntries.id, entryId));
}
beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(users)
    .values({ id: userId, name: "Entry fixture", email: `${userId}@example.test`, emailVerified: true });
  await db.insert(organizations).values({ id: otherOrg, name: "Entry foreign fixture", slug: otherOrg });
  lineage = await createLineageFixture("none");
  const source = definition();
  const [observation] = await db
    .insert(removalTemplateObservations)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      externalProjectId: "project",
      ...source,
      semanticFingerprint: "initial",
      fullFingerprint: "initial",
    })
    .returning();
  observationId = observation.id;
  await db
    .update(creditBatches)
    .set({ removalTemplateId: templateId })
    .where(eq(creditBatches.id, lineage.batchId));
});
afterAll(async () => {
  if (entryIds.length) {
    await db
      .delete(documents)
      .where(and(eq(documents.organizationId, TEST_ORG_ID), inArray(documents.entityId, entryIds)));
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entryIds));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, entryIds));
  }
  if (storageKeys.length)
    await db
      .delete(storageObjectDeletions)
      .where(
        and(
          eq(storageObjectDeletions.organizationId, TEST_ORG_ID),
          inArray(storageObjectDeletions.storageKey, storageKeys),
        ),
      );
  if (submissionIds.length)
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds));
  if (extraRemovalIds.length)
    await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, extraRemovalIds));
  if (lineage) await cleanupLineageFixture(lineage);
  await db
    .delete(removalTemplateObservations)
    .where(eq(removalTemplateObservations.externalTemplateId, templateId));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(organizations).where(eq(organizations.id, otherOrg));
});
it("creates, updates, conflicts and tombstones, with value-free batch activity", async () => {
  const entry = await create();
  expect(entry).toMatchObject({ version: 1, contentRevision: 1 });
  const note = await updateEmissionEntry(ctx, {
    id: entry.id,
    expectedVersion: 1,
    note: "Private fixture note",
  });
  expect(note).toMatchObject({ version: 2, contentRevision: 1 });
  await expect(
    updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 1, note: "stale" }),
  ).rejects.toMatchObject({ code: "stale_version" });
  const updated = await updateEmissionEntry(ctx, {
    id: entry.id,
    expectedVersion: 2,
    values: [
      { inputKey: "electricity_use", quantityKind: "energy", magnitude: "0.200000000000000001", unit: "kWh" },
    ],
  });
  expect(updated).toMatchObject({ version: 3, contentRevision: 2 });
  expect(updated.values[0].magnitude).toBe("0.200000000000000001");
  await expect(deleteEmissionEntry(ctx, entry.id, 2)).rejects.toMatchObject({ code: "stale_version" });
  await deleteEmissionEntry(ctx, entry.id, 3);
  const [stored] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  expect(stored.deletedAt).not.toBeNull();
  const events = await db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.entityType, "emission_entry"), eq(activityEvents.entityId, entry.id)));
  expect(events.map((event) => event.action).sort()).toEqual(["created", "deleted", "updated", "updated"]);
  expect(events.every((event) => event.creditBatchId === lineage.batchId)).toBe(true);
  // Activity rows carry a bigint `sequence` column, so serialize bigints explicitly.
  const serialized = JSON.stringify(events, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  expect(serialized).not.toContain("Private fixture note");
  expect(serialized).not.toContain("0.200000000000000001");
});
it("enforces the single index even for raw inserts", async () => {
  const entry = await create("meter");
  await expect(create("meter")).rejects.toThrow("already has");
  const [row] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  await expect(db.insert(emissionEntries).values({ ...row, id: crypto.randomUUID() })).rejects.toThrow();
  await deleteEmissionEntry(ctx, entry.id, entry.version);
});
it("refuses cross-org composite references and scoped reads", async () => {
  const entry = await create();
  await expect(
    db
      .insert(emissionEntryValues)
      .values({
        organizationId: otherOrg,
        entryId: entry.id,
        inputKey: "foreign",
        magnitude: "1",
        unit: "kWh",
      }),
  ).rejects.toThrow();
  const [row] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  await expect(
    db.insert(emissionEntries).values({ ...row, id: crypto.randomUUID(), organizationId: otherOrg }),
  ).rejects.toThrow();
  await expect(getEmissionEntry({ ...ctx, organizationId: otherOrg }, entry.id)).rejects.toThrow("not found");
});
it.each(["reserved", "sent"] as const)(
  "refuses edits, deletion, confirmation and evidence while %s",
  async (kind) => {
    const entry = await create();
    await claim(entry.id, kind);
    await expect(
      updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 1, note: "blocked" }),
    ).rejects.toThrow("reserved or sent");
    await expect(deleteEmissionEntry(ctx, entry.id, 1)).rejects.toThrow("reserved or sent");
    await expect(confirmEmissionEntry(ctx, entry.id, 1)).rejects.toThrow("reserved or sent");
    await expect(
      insertDocument(ctx, {
        entityType: "emission_entry",
        entityId: entry.id,
        documentType: "pdf",
        fileUrl: "https://example.test/evidence",
        fileName: "Evidence",
      }),
    ).rejects.toThrow("reserved or sent");
  },
);
it("attaches and retires evidence with content revisions, without the batch lineage guard", async () => {
  const entry = await create();
  const document = await insertDocument(ctx, {
    entityType: "emission_entry",
    entityId: entry.id,
    documentType: "pdf",
    fileUrl: "https://example.test/evidence",
    fileName: "Evidence",
  });
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
    version: 2,
    contentRevision: 2,
    documentCount: 1,
  });
  await db.transaction((tx) =>
    deleteDocumentInTransaction(ctx, tx, { documentId: document.id, expectedVersion: document.version }),
  );
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
    version: 3,
    contentRevision: 3,
    documentCount: 0,
  });
  const second = await insertDocument(ctx, {
    entityType: "emission_entry",
    entityId: entry.id,
    documentType: "pdf",
    fileUrl: "https://example.test/evidence",
    fileName: "Evidence",
  });
  await claim(entry.id, "reserved");
  await expect(
    db.transaction((tx) =>
      deleteDocumentInTransaction(ctx, tx, { documentId: second.id, expectedVersion: second.version }),
    ),
  ).rejects.toThrow("reserved or sent");
});
it("tombstones unsubmitted draft zeros on value creation", async () => {
  const [zero] = await db
    .insert(emissionEntries)
    .values({
      organizationId: TEST_ORG_ID,
      creditBatchId: lineage.batchId,
      removalTemplateId: templateId,
      componentId: "energy",
      inputShape: [],
      observationId,
      kind: "zero",
      lineRule: "additive",
      confirmedForRemovalId: lineage.removalId,
      occurredOn: "2026-06-13",
    })
    .returning();
  entryIds.push(zero.id);
  await expect(db.insert(emissionEntries).values({ ...zero, id: crypto.randomUUID() })).rejects.toThrow();
  const [otherDraft] = await insertRemovalFixture(db, { organizationId: TEST_ORG_ID, facilityId: lineage.facilityId });
  extraRemovalIds.push(otherDraft.id);
  const [otherZero] = await db
    .insert(emissionEntries)
    .values({ ...zero, id: crypto.randomUUID(), confirmedForRemovalId: otherDraft.id })
    .returning();
  entryIds.push(otherZero.id);
  await create();
  const [otherSaved] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, otherZero.id));
  expect(otherSaved.deletedAt).not.toBeNull();
  const [saved] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, zero.id));
  expect(saved.deletedAt).not.toBeNull();
});
it("loads persisted entries with the flag off while refusing writes", async () => {
  const entry = await create();
  const lines = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  expect(
    lines
      .find((line) => line.componentId === "energy")
      ?.entries.some((candidate) => candidate.id === entry.id && candidate.counts),
  ).toBe(true);
  await expect(loadBatchEmissionLines(ctx, crypto.randomUUID(), lineage.batchId)).rejects.toThrow();
  flag.enabled = false;
  try {
    expect(
      (await listEmissionEntries(ctx, lineage.batchId)).some((candidate) => candidate.id === entry.id),
    ).toBe(true);
    await expect(
      updateEmissionEntry(ctx, { id: entry.id, expectedVersion: entry.version, note: "blocked" }),
    ).rejects.toThrow("not available");
    await expect(create()).rejects.toThrow("not available");
  } finally {
    flag.enabled = true;
  }
});
it("refuses sample legs with the flag on before touching the sample", async () => {
  await expect(
    createTransportLeg(ctx, {
      entityType: "sample",
      entityId: lineage.sampleId,
      distanceKm: 1,
      loadMassKg: 1,
      transportMethodType: "road",
      calculationMethodType: "distance_based",
    }),
  ).rejects.toThrow("sample shipping");
});

it("refuses unit-change confirmation and reads the re-entry state", async () => {
  const entry = await create();
  const source = definition();
  source.enrichment.energy.electricity_use = { unit: "Wh" };
  const [next] = await db
    .insert(removalTemplateObservations)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      externalProjectId: "project",
      ...source,
      semanticFingerprint: "changed",
      fullFingerprint: "changed",
      lastObservedAt: new Date(Date.now() + 1000),
    })
    .returning();
  await expect(confirmEmissionEntry(ctx, entry.id, 99)).rejects.toMatchObject({ code: "stale_version" });
  await expect(confirmEmissionEntry(ctx, entry.id, 1)).rejects.toThrow(
    "This entry no longer matches the template. Enter the values again.",
  );
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ observationId, version: 1 });
  const lines = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  expect(lines.find(line => line.componentId === "energy")).toMatchObject({
    state: "needsReview", total: null,
    blocker: { message: "Enter the values again for the current template line." },
    entries: expect.arrayContaining([expect.objectContaining({
      id: entry.id, counts: false, canConfirm: false,
      reason: "Enter the values again for the current template line.",
    })]),
  });
  await db
    .update(removalTemplateObservations)
    .set({ lastObservedAt: new Date(0) })
    .where(eq(removalTemplateObservations.id, next.id));
});

it("confirms uploaded evidence inside the entry revision transaction", async () => {
  const entry = await create();
  const pending = await db.transaction((tx) =>
    requestDocumentUploadInTransaction(ctx, tx, {
      entityType: "emission_entry",
      entityId: entry.id,
      documentType: "pdf",
      fileName: "entry.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      storageProvider: "s3-compatible",
      storageBucket: "fixture-bucket",
    }),
  );
  storageKeys.push(pending.uploadStorageKey!, `confirmed/${pending.id}`);
  expect((await getEmissionEntry(ctx, entry.id)).documentCount).toBe(0);
  const result = await db.transaction((tx) =>
    confirmDocumentUploadInTransaction(ctx, tx, {
      ...uploadFactsFor(pending),
      finalKey: `confirmed/${pending.id}`,
      inspectedSha256: "a".repeat(64),
      inspectedSizeBytes: 10,
      inspectedContentType: "application/pdf",
    }),
  );
  expect(result.kind).toBe("uploaded");
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
    contentRevision: 2,
    version: 2,
    documentCount: 1,
  });
});
it("retains sample-leg creation when the flag is off", async () => {
  // The shared fixture's batch has submissions from earlier cases, which lock its sample.
  // Use a separate lineage with no submission so only the flag decides the outcome.
  const unlocked = await createLineageFixture("none");
  flag.enabled = false;
  try {
    const leg = await createTransportLeg(ctx, {
      entityType: "sample",
      entityId: unlocked.sampleId,
      distanceKm: 1,
      loadMassKg: 1,
      transportMethodType: "road",
      calculationMethodType: "distance_based",
    });
    expect(leg.entityType).toBe("sample");
    await db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
  } finally {
    flag.enabled = true;
    await cleanupLineageFixture(unlocked);
  }
});

it("enforces organization consistency independently for observation and claim references", async () => {
  const entry = await create();
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: otherOrg,
      code: "FAC-FOREIGN-ENTRY",
      name: "Foreign entry facility",
      country: "Tanzania",
      gpsLatitude: -8.3,
      gpsLongitude: 35.3,
      timezone: "UTC",
    })
    .returning();
  const [removal] = await insertRemovalFixture(db, { organizationId: otherOrg, facilityId: facility.id });
  const [submission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: otherOrg,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
    })
    .returning();
  const [foreignObservation] = await db
    .insert(removalTemplateObservations)
    .values({
      organizationId: otherOrg,
      provider: "isometric",
      externalProjectId: "project",
      ...definition(),
      semanticFingerprint: "foreign",
      fullFingerprint: "foreign",
    })
    .returning();
  try {
    for (const patch of [
      { observationId: foreignObservation.id },
      { sentByRemovalId: removal.id },
      { sendReservedBySubmissionId: submission.id },
      { kind: "zero" as const, confirmedForRemovalId: removal.id },
    ]) {
      await expect(
        db.update(emissionEntries).set(patch).where(eq(emissionEntries.id, entry.id)),
      ).rejects.toThrow();
    }
  } finally {
    await db
      .delete(removalTemplateObservations)
      .where(eq(removalTemplateObservations.id, foreignObservation.id));
    await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id));
    await db.delete(certifierRemovals).where(eq(certifierRemovals.id, removal.id));
    await db.delete(facilities).where(eq(facilities.id, facility.id));
  }
});

it("keeps a new unsent entry editable after the batch's earlier Removal was submitted", async () => {
  const [submitted] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: lineage.removalId,
      version: submissionIds.length + 1,
      status: "submitted",
      submittedAt: new Date(),
      externalId: "fixture-remote-removal",
    })
    .returning();
  submissionIds.push(submitted.id);
  await db
    .update(creditBatches)
    .set({ productionEmissionsClaimedByRemovalId: lineage.removalId })
    .where(eq(creditBatches.id, lineage.batchId));
  const entry = await create();
  const updated = await updateEmissionEntry(ctx, {
    id: entry.id,
    expectedVersion: entry.version,
    note: "Later entry",
  });
  expect(updated.version).toBe(entry.version + 1);
  await expect(
    insertDocument(ctx, {
      entityType: "emission_entry",
      entityId: entry.id,
      documentType: "pdf",
      fileUrl: "https://example.test/later-evidence",
      fileName: "Evidence",
    }),
  ).resolves.toMatchObject({ entityId: entry.id });
});

it("bumps only version for normalized no-op content and revision for a changed date", async () => {
  const entry = await create();
  const saved = await updateEmissionEntry(ctx, {
    id: entry.id,
    expectedVersion: entry.version,
    occurredOn: entry.occurredOn,
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "00.100", unit: "kWh" }],
  });
  expect(saved).toMatchObject({ version: 2, contentRevision: 1 });
  expect(saved.values[0].magnitude).toBe("0.1");
  const changed = await updateEmissionEntry(ctx, {
    id: entry.id,
    expectedVersion: saved.version,
    occurredOn: "2026-06-14",
  });
  expect(changed).toMatchObject({ version: 3, contentRevision: 2 });
});
it.each(["pending", "failed"] as const)(
  "deleting %s evidence leaves entry content unchanged",
  async (uploadStatus) => {
    const entry = await create();
    const pending = await db.transaction((tx) =>
      requestDocumentUploadInTransaction(ctx, tx, {
        entityType: "emission_entry",
        entityId: entry.id,
        documentType: "pdf",
        fileName: "entry.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        storageProvider: "s3-compatible",
        storageBucket: "fixture-bucket",
      }),
    );
    storageKeys.push(pending.uploadStorageKey!);
    if (uploadStatus === "failed")
      await db.update(documents).set({ uploadStatus }).where(eq(documents.id, pending.id));
    await db.transaction((tx) =>
      deleteDocumentInTransaction(ctx, tx, { documentId: pending.id, expectedVersion: pending.version }),
    );
    expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
      version: 1,
      contentRevision: 1,
      documentCount: 0,
    });
  },
);
it.each(["batch", "facility"] as const)(
  "refuses every evidence attachment path on an archived %s",
  async (owner) => {
    const entry = await create();
    const request = {
      entityType: "emission_entry" as const,
      entityId: entry.id,
      documentType: "pdf" as const,
      fileName: "entry.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      storageProvider: "s3-compatible",
      storageBucket: "fixture-bucket",
    };
    const pending = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, request));
    storageKeys.push(pending.uploadStorageKey!, "never-confirmed");
    const table = owner === "batch" ? creditBatches : facilities;
    const id = owner === "batch" ? lineage.batchId : lineage.facilityId;
    await db
      .update(table)
      .set({ archivedAt: new Date() })
      .where(and(eq(table.organizationId, ctx.organizationId), eq(table.id, id)));
    try {
      await expect(
        insertDocument(ctx, {
          entityType: "emission_entry",
          entityId: entry.id,
          documentType: "pdf",
          fileUrl: "https://example.test/evidence",
          fileName: "Evidence",
        }),
      ).rejects.toThrow("not found");
      await expect(
        db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, request)),
      ).rejects.toThrow("not found");
      await expect(
        db.transaction((tx) =>
          confirmDocumentUploadInTransaction(ctx, tx, {
            ...uploadFactsFor(pending),
            finalKey: "never-confirmed",
            inspectedSha256: "a".repeat(64),
            inspectedSizeBytes: 10,
            inspectedContentType: "application/pdf",
          }),
        ),
      ).resolves.toMatchObject({ kind: "gone", pointer: "/emissionEntryId" });
      expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
        version: 1,
        contentRevision: 1,
        documentCount: 0,
      });
    } finally {
      await db
        .update(table)
        .set({ archivedAt: null })
        .where(and(eq(table.organizationId, ctx.organizationId), eq(table.id, id)));
    }
  },
);

it("refuses supported but different entry units at create and update", async () => {
  const values = [
    { inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "1", unit: "Wh" },
  ];
  await expect(
    createEmissionEntry(ctx, {
      creditBatchId: lineage.batchId,
      componentId: "energy",
      occurredOn: "2026-06-13",
      values,
    }),
  ).rejects.toThrow("Choose a supported unit for this input.");
  const entry = await create();
  await expect(
    updateEmissionEntry(ctx, { id: entry.id, expectedVersion: entry.version, values }),
  ).rejects.toThrow("Choose a supported unit for this input.");
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({
    version: 1,
    values: [{ magnitude: "0.1", unit: "kWh" }],
  });
});


it.each(["live", "deleted", "reserved", "sent", "confirmed"] as const)(
  "deletes a batch only with unclaimed tombstones: %s", async (state) => {
  const [original] = await db.select().from(creditBatches).where(eq(creditBatches.id, lineage.batchId));
  const [batch] = await db.insert(creditBatches).values({
    ...original, id: crypto.randomUUID(), code: `CB-ENTRY-${crypto.randomUUID()}`,
    productionEmissionsClaimedByRemovalId: null,
  }).returning();
  const entry = await createEmissionEntry(ctx, {
    creditBatchId: batch.id, componentId: "energy", occurredOn: "2026-06-13",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }],
  });
  entryIds.push(entry.id);
  const document = await insertDocument(ctx, {
    entityType: "emission_entry", entityId: entry.id, documentType: "pdf",
    fileUrl: "https://example.test/evidence", fileName: "Evidence",
  });
  try {
    if (state === "reserved" || state === "sent") {
      await claim(entry.id, state);
      await db.update(emissionEntries).set({ deletedAt: new Date() }).where(eq(emissionEntries.id, entry.id));
    }
    if (state === "confirmed") {
      await db.update(emissionEntries).set({
        kind: "zero", confirmedForRemovalId: lineage.removalId, deletedAt: new Date(),
      }).where(eq(emissionEntries.id, entry.id));
    }
    if (state === "deleted") {
      const current = await getEmissionEntry(ctx, entry.id);
      await deleteEmissionEntry(ctx, entry.id, current.version);
      await deleteCreditBatch(ctx, batch.id, batch.version);
      expect(await db.select().from(creditBatches).where(eq(creditBatches.id, batch.id))).toEqual([]);
      expect(await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id))).toEqual([]);
      expect(await db.select().from(emissionEntryValues).where(eq(emissionEntryValues.entryId, entry.id))).toEqual([]);
      expect(await db.select().from(documents).where(eq(documents.id, document.id))).toEqual([]);
    } else {
      await expect(deleteCreditBatch(ctx, batch.id, batch.version)).rejects.toMatchObject({
        name: "ActionConflictError",
        message: "Delete this credit batch's emissions entries before deleting it.",
      });
      expect(await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id)))
        .toHaveLength(1);
    }
  } finally {
    await db.delete(documents).where(eq(documents.entityId, entry.id));
    await db.delete(emissionEntryValues).where(eq(emissionEntryValues.entryId, entry.id));
    await db.delete(emissionEntries).where(eq(emissionEntries.id, entry.id));
    await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
  }
});

it("refuses document lists for unknown, tombstoned and other-organization entries", async () => {
  const entry = await create();
  await expect(listDocumentsForEntity(ctx, "emission_entry", entry.id)).resolves.toEqual([]);
  await expect(listDocumentsForEntityIds(ctx, "emission_entry", [entry.id])).resolves.toEqual([]);
  const otherCtx = { ...ctx, organizationId: otherOrg };
  await expect(listDocumentsForEntity(otherCtx, "emission_entry", entry.id))
    .rejects.toThrow("Emissions entry was not found or is archived.");
  await expect(listDocumentsForEntityIds(otherCtx, "emission_entry", [entry.id]))
    .rejects.toThrow("Emissions entry was not found or is archived.");
  await deleteEmissionEntry(ctx, entry.id, entry.version);
  for (const id of [entry.id, crypto.randomUUID()]) {
    await expect(listDocumentsForEntity(ctx, "emission_entry", id))
      .rejects.toThrow("Emissions entry was not found or is archived.");
    await expect(listDocumentsForEntityIds(ctx, "emission_entry", [id]))
      .rejects.toThrow("Emissions entry was not found or is archived.");
  }
});

it("allows document lists for claimed entries while writes are disabled", async () => {
  const entry = await create();
  await claim(entry.id, "sent");
  flag.enabled = false;
  try {
    await expect(listDocumentsForEntity(ctx, "emission_entry", entry.id)).resolves.toEqual([]);
    await expect(listDocumentsForEntityIds(ctx, "emission_entry", [entry.id])).resolves.toEqual([]);
  } finally {
    flag.enabled = true;
  }
});

it("uses the read model blocker for an unpinned batch", async () => {
  await db.update(creditBatches).set({ removalTemplateId: null })
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, lineage.batchId)));
  try {
    await expect(create()).rejects.toThrow("Choose a Removal template for this credit batch.");
    await expect(loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId))
      .rejects.toThrow("Choose a Removal template for this credit batch.");
  } finally {
    await db.update(creditBatches).set({ removalTemplateId: templateId })
      .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, lineage.batchId)));
  }
});

it("defaults additive dates to an ended batch and fixes single-line dates through updates", async () => {
  const [original] = await db.select().from(creditBatches).where(eq(creditBatches.id, lineage.batchId));
  const [batch] = await db.insert(creditBatches).values({
    ...original, id: crypto.randomUUID(), code: `CB-DATES-${crypto.randomUUID()}`,
    startDate: "2026-06-01", endDate: "2026-06-30", productionEmissionsClaimedByRemovalId: null,
  }).returning();
  const ids: string[] = [];
  try {
    const additive = await createEmissionEntry(ctx, { creditBatchId: batch.id, componentId: "energy",
      values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }],
    });
    ids.push(additive.id);
    expect(additive.occurredOn).toBe("2026-06-30");
    const single = await createEmissionEntry(ctx, { creditBatchId: batch.id, componentId: "meter",
      occurredOn: "2099-01-01",
      values: ["initial_readout", "final_readout"].map((inputKey) => ({ inputKey, quantityKind: "energy", magnitude: "1", unit: "kWh" })),
    });
    ids.push(single.id);
    expect(single.occurredOn).toBe("2026-06-01");
    const updated = await updateEmissionEntry(ctx, { id: single.id, expectedVersion: single.version,
      occurredOn: "2020-01-01", note: "Date stays fixed",
    });
    expect(updated).toMatchObject({ occurredOn: "2026-06-01", contentRevision: single.contentRevision });
    await expect(createEmissionEntry(ctx, { creditBatchId: batch.id, componentId: "energy", occurredOn: "2026-05-31",
      values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }],
    })).rejects.toThrow("before the credit batch start");
  } finally {
    if (ids.length) {
      await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, ids));
      await db.delete(emissionEntries).where(inArray(emissionEntries.id, ids));
    }
    await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
  }
});

it("scopes the facility overview, excludes archived batches and ignores entries when disabled", async () => {
  const [original] = await db.select().from(creditBatches).where(eq(creditBatches.id, lineage.batchId));
  const [batch] = await db.insert(creditBatches).values({
    ...original, id: crypto.randomUUID(), code: `CB-OVERVIEW-${crypto.randomUUID()}`,
    productionEmissionsClaimedByRemovalId: null,
  }).returning();
  let entryId: string | undefined;
  try {
    const entry = await createEmissionEntry(ctx, { creditBatchId: batch.id, componentId: "energy", occurredOn: "2026-06-13",
      values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }],
    });
    entryId = entry.id;
    const overview = await loadFacilityEmissionsOverview(ctx, lineage.facilityId);
    expect(overview.batches.find((row) => row.creditBatchId === batch.id)).toMatchObject({
      status: batch.status, lastEntryOn: "2026-06-13", entriesThisMonth: 1,
      lineCounts: { total: 2, open: 2, fileMissing: 1, notRecorded: 1 },
    });
    await expect(loadFacilityEmissionsOverview({ ...ctx, organizationId: otherOrg }, lineage.facilityId)).rejects.toThrow();
    flag.enabled = false;
    const disabled = await loadFacilityEmissionsOverview(ctx, lineage.facilityId);
    expect(disabled.batches.find((row) => row.creditBatchId === batch.id)).toMatchObject({
      entriesThisMonth: 0, lastEntryOn: null, lineCounts: { fileMissing: 0, notRecorded: 2 },
    });
    await db.update(creditBatches).set({ archivedAt: new Date() }).where(eq(creditBatches.id, batch.id));
    expect((await loadFacilityEmissionsOverview(ctx, lineage.facilityId)).batches.some((row) => row.creditBatchId === batch.id)).toBe(false);
  } finally {
    flag.enabled = true;
    if (entryId) {
      await db.delete(emissionEntryValues).where(eq(emissionEntryValues.entryId, entryId));
      await db.delete(emissionEntries).where(eq(emissionEntries.id, entryId));
    }
    await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
  }
});
