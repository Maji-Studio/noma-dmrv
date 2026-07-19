import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  certifierDocumentUploads,
  customerLocations,
  customers,
  deliveries,
  documents,
  facilities,
  feedstocks,
  feedstockTypes,
  incidentReports,
  organizations,
  orders,
  productionSamples,
  productionRuns,
  reactors,
  transportLegs,
} from "@/db/schema";
import { deleteFeedstock } from "@/data-access/feedstocks";
import { deleteDelivery } from "@/data-access/deliveries";
import { deleteProductionIncident } from "@/data-access/production-incidents";
import { deleteProductionRun } from "@/data-access/production-runs";
import { deleteProductionSample } from "@/data-access/production-samples";
import { deleteReactor } from "@/data-access/reactors";
import { deleteSample } from "@/data-access/samples";
import { syncFeedstockTransportLeg } from "@/data-access/transport-legs";
import { __setStorageProviderForTests } from "@/lib/storage";
import type {
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from "@/lib/storage";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "parent-document-retirement-user";

class RetirementStorageProvider implements StorageProvider {
  readonly name = "local-fs" as const;
  readonly bucket = "local-fs";
  readonly objects = new Set<string>();
  readonly deleteCalls: string[] = [];
  failKey: string | null = null;

  async createUploadUrl(): Promise<PresignedUpload> {
    throw new Error("Not used by retirement tests");
  }

  async createDownloadUrl(): Promise<string> {
    throw new Error("Not used by retirement tests");
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    return this.objects.has(key)
      ? { size: 1, contentType: "application/pdf", etag: "test" }
      : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteCalls.push(key);
    if (key === this.failKey) throw new Error("Injected storage failure");
    this.objects.delete(key);
  }

  async putObject(key: string): Promise<void> {
    this.objects.add(key);
  }
}

let provider: RetirementStorageProvider;

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  provider = new RetirementStorageProvider();
  __setStorageProviderForTests(provider);
});

afterEach(() => {
  __setStorageProviderForTests(null);
});

async function createReactorFixture(tag: string) {
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DOC-${tag}`,
        name: `Document retirement facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RE-DOC-${tag}`,
        identifier: `Document retirement reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });
    return { facilityId: facility.id, reactorId: reactor.id };
  });
}

async function insertManagedDocument(
  entityType: string,
  entityId: string,
  storageKey: string,
  organizationId = TEST_ORG_ID,
) {
  provider.objects.add(storageKey);
  const [document] = await db
    .insert(documents)
    .values({
      organizationId,
      entityType,
      entityId,
      documentType: "pdf",
      storageProvider: "local-fs",
      storageBucket: "local-fs",
      storageKey,
      fileName: "evidence.pdf",
    })
    .returning({ id: documents.id });
  return document.id;
}

describe("parent document retirement", () => {
  it("deletes managed and external evidence while preserving another organization's rows", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const fixture = await createReactorFixture(tag);
    const otherOrgId = `org_document_retirement_${tag}`;
    const managedKey = `reactor/${fixture.reactorId}/pdf/${tag}.pdf`;
    const otherOrgKey = `reactor/${fixture.reactorId}/pdf/${tag}-other.pdf`;

    try {
      await db.insert(organizations).values({
        id: otherOrgId,
        name: `Other document organization ${tag}`,
        slug: `other-document-${tag}`,
      });
      await insertManagedDocument("reactor", fixture.reactorId, managedKey);
      await db.insert(documents).values({
        organizationId: TEST_ORG_ID,
        entityType: "reactor",
        entityId: fixture.reactorId,
        documentType: "pdf",
        fileUrl: "https://example.test/external-evidence.pdf",
        fileName: "external-evidence.pdf",
      });
      const otherDocumentId = await insertManagedDocument(
        "reactor",
        fixture.reactorId,
        otherOrgKey,
        otherOrgId,
      );

      await deleteReactor(
        makeTestOrgContext(TEST_USER_ID),
        fixture.reactorId,
      );

      expect(provider.deleteCalls).toEqual([managedKey]);
      expect(provider.objects.has(managedKey)).toBe(false);
      expect(provider.objects.has(otherOrgKey)).toBe(true);
      expect(
        await db.select().from(documents).where(eq(documents.id, otherDocumentId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, TEST_ORG_ID),
              eq(documents.entityId, fixture.reactorId),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await db.delete(documents).where(eq(documents.organizationId, otherOrgId));
      await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
      await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
      await db.delete(organizations).where(eq(organizations.id, otherOrgId));
    }
  });

  it("blocks a mirrored document before deleting either database or storage state", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const fixture = await createReactorFixture(tag);
    const key = `reactor/${fixture.reactorId}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument(
      "reactor",
      fixture.reactorId,
      key,
    );

    try {
      await db.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID,
        documentId,
        provider: "puro_earth",
        externalDocumentId: `source-${tag}`,
      });

      await expect(
        deleteReactor(makeTestOrgContext(TEST_USER_ID), fixture.reactorId),
      ).rejects.toThrow(/certification provider/);

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(key)).toBe(true);
      expect(
        await db.select().from(reactors).where(eq(reactors.id, fixture.reactorId)),
      ).toHaveLength(1);
      expect(
        await db.select().from(documents).where(eq(documents.id, documentId)),
      ).toHaveLength(1);
    } finally {
      await db
        .delete(certifierDocumentUploads)
        .where(eq(certifierDocumentUploads.documentId, documentId));
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
      await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    }
  });

  it("preflights delivery and derived-leg evidence together before deleting storage", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DEL-${tag}`,
        name: `Delivery evidence facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CUS-DEL-${tag}`,
        name: `Delivery evidence customer ${tag}`,
      })
      .returning({ id: customers.id });
    const [location] = await db
      .insert(customerLocations)
      .values({
        organizationId: TEST_ORG_ID,
        customerId: customer.id,
        name: `Delivery evidence site ${tag}`,
      })
      .returning({ id: customerLocations.id });
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BP-DEL-${tag}`,
        massKg: 1_000,
      })
      .returning({ id: biocharProducts.id });
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        customerLocationId: location.id,
        biocharProductId: product.id,
        code: `OR-DEL-${tag}`,
        orderDate: new Date("2026-07-19T00:00:00Z"),
        quantityKg: 100,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        code: `DL-DEL-${tag}`,
        deliveryDate: new Date("2026-07-19T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 100,
      })
      .returning({ id: deliveries.id });
    const [leg] = await db
      .insert(transportLegs)
      .values({
        organizationId: TEST_ORG_ID,
        entityType: "biochar",
        entityId: product.id,
        isDerived: true,
        distanceKm: 20,
        distanceSource: "manual",
        transportMethodType: "road",
        loadMassKg: 100,
      })
      .returning({ id: transportLegs.id });
    const deliveryKey = `delivery/${delivery.id}/pdf/${tag}.pdf`;
    const legKey = `transport_leg/${leg.id}/pdf/${tag}.pdf`;
    const deliveryDocumentId = await insertManagedDocument(
      "delivery",
      delivery.id,
      deliveryKey,
    );
    const legDocumentId = await insertManagedDocument(
      "transport_leg",
      leg.id,
      legKey,
    );

    try {
      await db.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID,
        documentId: legDocumentId,
        provider: "verra",
        externalDocumentId: `derived-source-${tag}`,
      });

      await expect(
        deleteDelivery(makeTestOrgContext(TEST_USER_ID), delivery.id),
      ).rejects.toThrow(/certification provider/);

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(deliveryKey)).toBe(true);
      expect(provider.objects.has(legKey)).toBe(true);
      expect(
        await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(documents)
          .where(inArray(documents.id, [deliveryDocumentId, legDocumentId])),
      ).toHaveLength(2);
    } finally {
      await db
        .delete(certifierDocumentUploads)
        .where(eq(certifierDocumentUploads.documentId, legDocumentId));
      await db
        .delete(documents)
        .where(inArray(documents.id, [deliveryDocumentId, legDocumentId]));
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(customerLocations).where(eq(customerLocations.id, location.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it.each([
    ["production incident", "production_incident", deleteProductionIncident],
    ["production sample", "production_sample", deleteProductionSample],
    ["lab sample", "sample", deleteSample],
  ] as const)(
    "does not retire orphaned %s evidence when the entity delete finds no row",
    async (_label, entityType, deleteEntity) => {
      const entityId = crypto.randomUUID();
      const key = `${entityType}/${entityId}/pdf/orphan.pdf`;
      const documentId = await insertManagedDocument(entityType, entityId, key);

      try {
        await expect(
          deleteEntity(makeTestOrgContext(TEST_USER_ID), entityId),
        ).rejects.toThrow(/not found/i);
        expect(provider.deleteCalls).toEqual([]);
        expect(provider.objects.has(key)).toBe(true);
        expect(
          await db.select().from(documents).where(eq(documents.id, documentId)),
        ).toHaveLength(1);
      } finally {
        await db.delete(documents).where(eq(documents.id, documentId));
      }
    },
  );

  it("keeps storage intact when a parent foreign-key delete fails", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const fixture = await createReactorFixture(tag);
    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        reactorId: fixture.reactorId,
        code: `PR-FK-${tag}`,
        startTime: new Date("2026-07-02T10:00:00Z"),
      })
      .returning({ id: productionRuns.id });
    const [productionSample] = await db
      .insert(productionSamples)
      .values({
        organizationId: TEST_ORG_ID,
        productionRunId: run.id,
        timestamp: new Date("2026-07-02T11:00:00Z"),
      })
      .returning({ id: productionSamples.id });
    const key = `production_run/${run.id}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument(
      "production_run",
      run.id,
      key,
    );

    try {
      await expect(
        deleteProductionRun(makeTestOrgContext(TEST_USER_ID), run.id),
      ).rejects.toThrow();

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(key)).toBe(true);
      expect(
        await db.select().from(productionRuns).where(eq(productionRuns.id, run.id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(documents).where(eq(documents.id, documentId)),
      ).toHaveLength(1);
    } finally {
      await db.delete(productionSamples).where(eq(productionSamples.id, productionSample.id));
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
      await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
      await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    }
  });

  it("keeps rows after storage failure and succeeds on an idempotent retry", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const fixture = await createReactorFixture(tag);
    const keys = [
      `reactor/${fixture.reactorId}/pdf/${tag}-first.pdf`,
      `reactor/${fixture.reactorId}/pdf/${tag}-second.pdf`,
    ];
    await insertManagedDocument("reactor", fixture.reactorId, keys[0]);
    await insertManagedDocument("reactor", fixture.reactorId, keys[1]);
    provider.failKey = keys[1];

    try {
      await expect(
        deleteReactor(makeTestOrgContext(TEST_USER_ID), fixture.reactorId),
      ).rejects.toThrow(/retry deletion to finish storage cleanup/);

      expect(
        await db.select().from(reactors).where(eq(reactors.id, fixture.reactorId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.entityId, fixture.reactorId)),
      ).toHaveLength(2);

      provider.failKey = null;
      await deleteReactor(
        makeTestOrgContext(TEST_USER_ID),
        fixture.reactorId,
      );
      expect(provider.objects.has(keys[0])).toBe(false);
      expect(provider.objects.has(keys[1])).toBe(false);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.entityId, fixture.reactorId)),
      ).toHaveLength(0);
    } finally {
      await db.delete(documents).where(eq(documents.entityId, fixture.reactorId));
      await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
      await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    }
  });

  it("retires a stale derived leg through the mirrored-evidence guard", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DERIVED-${tag}`,
        name: `Derived leg facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-DERIVED-${tag}`,
        name: `Derived leg feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `FS-DERIVED-${tag}`,
        status: "missing_data",
        massDryKg: 0,
      })
      .returning({ id: feedstocks.id });
    const [leg] = await db
      .insert(transportLegs)
      .values({
        organizationId: TEST_ORG_ID,
        entityType: "feedstock",
        entityId: feedstock.id,
        isDerived: true,
        distanceKm: 10,
        transportMethodType: "road",
        loadMassKg: 100,
      })
      .returning({ id: transportLegs.id });
    const key = `transport_leg/${leg.id}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument("transport_leg", leg.id, key);
    try {
      await db.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID,
        documentId,
        provider: "isometric",
        externalDocumentId: `derived-source-${tag}`,
      });

      await expect(
        db.transaction((tx) =>
          syncFeedstockTransportLeg(
            makeTestOrgContext(TEST_USER_ID),
            tx,
            feedstock.id,
          ),
        ),
      ).rejects.toThrow(/Unlink the document/);
      expect(provider.deleteCalls).toEqual([]);
      expect(
        await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id)),
      ).toHaveLength(1);

      await db
        .delete(certifierDocumentUploads)
        .where(eq(certifierDocumentUploads.documentId, documentId));
      await db.transaction((tx) =>
        syncFeedstockTransportLeg(
          makeTestOrgContext(TEST_USER_ID),
          tx,
          feedstock.id,
        ),
      );
      expect(provider.objects.has(key)).toBe(false);
      expect(
        await db.select().from(documents).where(eq(documents.id, documentId)),
      ).toHaveLength(0);
    } finally {
      await db
        .delete(certifierDocumentUploads)
        .where(eq(certifierDocumentUploads.documentId, documentId));
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstock.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("retires nested transport-leg and production-incident evidence", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-NEST-${tag}`,
        name: `Nested evidence facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-NEST-${tag}`,
        name: `Nested evidence feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `FS-NEST-${tag}`,
        status: "missing_data",
        massDryKg: 0,
      })
      .returning({ id: feedstocks.id });
    const [leg] = await db
      .insert(transportLegs)
      .values({
        organizationId: TEST_ORG_ID,
        entityType: "feedstock",
        entityId: feedstock.id,
        distanceKm: 10,
        transportMethodType: "road",
        loadMassKg: 100,
      })
      .returning({ id: transportLegs.id });
    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RE-NEST-${tag}`,
        identifier: `Nested evidence reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });
    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        code: `PR-NEST-${tag}`,
        startTime: new Date("2026-07-01T10:00:00Z"),
      })
      .returning({ id: productionRuns.id });
    const [incident] = await db
      .insert(incidentReports)
      .values({
        organizationId: TEST_ORG_ID,
        productionRunId: run.id,
        incidentTime: new Date("2026-07-01T11:00:00Z"),
        incidentDate: new Date("2026-07-01T11:00:00Z"),
        description: "Nested evidence test incident",
        severity: "low",
      })
      .returning({ id: incidentReports.id });
    const entityIds = [feedstock.id, leg.id, run.id, incident.id];

    try {
      await Promise.all([
        insertManagedDocument("feedstock", feedstock.id, `feedstock/${feedstock.id}/pdf/${tag}.pdf`),
        insertManagedDocument("transport_leg", leg.id, `transport_leg/${leg.id}/pdf/${tag}.pdf`),
        insertManagedDocument("production_run", run.id, `production_run/${run.id}/pdf/${tag}.pdf`),
        insertManagedDocument("production_incident", incident.id, `production_incident/${incident.id}/pdf/${tag}.pdf`),
      ]);

      await deleteFeedstock(makeTestOrgContext(TEST_USER_ID), feedstock.id);
      await deleteProductionRun(makeTestOrgContext(TEST_USER_ID), run.id);

      expect(
        await db.select().from(documents).where(inArray(documents.entityId, entityIds)),
      ).toHaveLength(0);
      expect(
        await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id)),
      ).toHaveLength(0);
      expect(
        await db.select().from(incidentReports).where(eq(incidentReports.id, incident.id)),
      ).toHaveLength(0);
    } finally {
      await db.delete(documents).where(inArray(documents.entityId, entityIds));
      await db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
      await db.delete(incidentReports).where(eq(incidentReports.id, incident.id));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstock.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
