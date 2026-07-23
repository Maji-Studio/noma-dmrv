import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Real-DB regression coverage for the transport-leg evidence projections.
 *
 * The biochar branch of `legEvidenceDocumentCount` embeds a joined subquery in
 * a raw sql template; drizzle renders `${table.column}` UNQUALIFIED there,
 * which once produced ambiguous SQL (42702) that no unit test executed. These
 * tests run the real query per category and pin the biochar min-across-
 * contributing-deliveries semantics (a file on an upcoming delivery must not
 * count; every delivered, non-archived delivery must carry a file).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import { facilities } from "@/db/schema/facilities";
import { customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";
import { deliveries, orders, transportLegs } from "@/db/schema/logistics";
import { documents } from "@/db/schema/documentation";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

describe("getTransportLegsWithEvidenceForEntities — biochar delivery evidence", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let productId: string;
  let customerId: string;
  let orderId: string;
  let deliveredWithDocId: string;
  let deliveredWithoutDocId: string;
  let upcomingId: string;
  let legId: string;
  const documentIds: string[] = [];

  beforeAll(async () => {
    await ensureTestOrg();

    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-TEP-${tag}`,
        name: `TEP Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-TEP-${tag}`,
        facilityId,
      })
      .returning({ id: biocharProducts.id });
    productId = product.id;

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CUS-TEP-${tag}`,
        name: `TEP Customer ${tag}`,
      })
      .returning({ id: customers.id });
    customerId = customer.id;

    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        code: `OR-TEP-${tag}`,
        facilityId,
        orderDate: new Date("2026-01-05T00:00:00Z"),
        customerId,
        biocharProductId: productId,
        quantityKg: 500,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    orderId = order.id;

    async function makeDelivery(
      suffix: string,
      status: "delivered" | "upcoming",
    ): Promise<string> {
      const [row] = await db
        .insert(deliveries)
        .values({
          organizationId: TEST_ORG_ID,
          code: `DL-TEP-${suffix}-${tag}`,
          facilityId,
          deliveryDate: new Date("2026-01-10T00:00:00Z"),
          status,
          orderId,
          biocharProductId: productId,
          distanceSource: "document",
        })
        .returning({ id: deliveries.id });
      return row.id;
    }

    deliveredWithDocId = await makeDelivery("A", "delivered");
    deliveredWithoutDocId = await makeDelivery("B", "delivered");
    upcomingId = await makeDelivery("C", "upcoming");

    const [leg] = await db
      .insert(transportLegs)
      .values({
        organizationId: TEST_ORG_ID,
        entityType: "biochar",
        entityId: productId,
        distanceKm: 40,
        distanceSource: "document",
        transportMethodType: "road",
        loadMassKg: 500,
      })
      .returning({ id: transportLegs.id });
    legId = leg.id;
  });

  afterAll(async () => {
    async function cleanup(step: () => Promise<unknown>) {
      try {
        await step();
      } catch {
        // Best-effort teardown; keep the original test failure visible.
      }
    }
    if (documentIds.length > 0) {
      await cleanup(() =>
        db.delete(documents).where(inArray(documents.id, documentIds)),
      );
    }
    if (legId) {
      await cleanup(() => db.delete(transportLegs).where(eq(transportLegs.id, legId)));
    }
    await cleanup(() => db.delete(deliveries).where(eq(deliveries.orderId, orderId)));
    if (orderId) {
      await cleanup(() => db.delete(orders).where(eq(orders.id, orderId)));
    }
    if (productId) {
      await cleanup(() =>
        db.delete(biocharProducts).where(eq(biocharProducts.id, productId)),
      );
    }
    if (customerId) {
      await cleanup(() => db.delete(customers).where(eq(customers.id, customerId)));
    }
    if (facilityId) {
      await cleanup(() => db.delete(facilities).where(eq(facilities.id, facilityId)));
    }
  });

  async function addEvidence(deliveryId: string): Promise<string> {
    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: TEST_ORG_ID,
        entityType: "delivery",
        entityId: deliveryId,
        documentType: "bill_of_lading",
        fileName: `tep-${tag}.pdf`,
        fileUrl: `https://example.invalid/tep-${tag}.pdf`,
        uploadStatus: "uploaded",
      })
      .returning({ id: documents.id });
    documentIds.push(doc.id);
    return doc.id;
  }

  async function loadCount(): Promise<number> {
    const legs = await getTransportLegsWithEvidenceForEntities(
      makeTestOrgContext(TEST_USER_ID),
      "biochar",
      [productId],
    );
    expect(legs).toHaveLength(1);
    return legs[0].transportEvidenceDocumentCount;
  }

  it("executes for every category and fails closed with no evidence anywhere", async () => {
    // The query must EXECUTE (regression: ambiguous unqualified columns) for
    // all three ownership branches, not just biochar.
    for (const entityType of ["feedstock", "sample"] as const) {
      await expect(
        getTransportLegsWithEvidenceForEntities(
          makeTestOrgContext(TEST_USER_ID),
          entityType,
          [crypto.randomUUID()],
        ),
      ).resolves.toEqual([]);
    }
    expect(await loadCount()).toBe(0);
  });

  it("ignores files on non-contributing (upcoming) deliveries", async () => {
    await addEvidence(upcomingId);
    expect(await loadCount()).toBe(0);
  });

  it("stays 0 while any contributing delivery lacks a file", async () => {
    await addEvidence(deliveredWithDocId);
    expect(await loadCount()).toBe(0);
  });

  it("turns positive only when every contributing delivery has a file", async () => {
    await addEvidence(deliveredWithoutDocId);
    expect(await loadCount()).toBe(1);
  });

  it("drops back to 0 when a contributing delivery is archived out vs in", async () => {
    // Archiving the covered delivery removes it from the contributing set —
    // the remaining delivered rows still all carry files, so count stays > 0;
    // archiving the ONLY evidenced one of two would instead expose the gap.
    await db
      .update(deliveries)
      .set({ archivedAt: new Date() })
      .where(eq(deliveries.id, deliveredWithoutDocId));
    expect(await loadCount()).toBe(1);

    await db
      .update(deliveries)
      .set({ archivedAt: null })
      .where(eq(deliveries.id, deliveredWithoutDocId));
    await db
      .delete(documents)
      .where(eq(documents.entityId, deliveredWithoutDocId));
    expect(await loadCount()).toBe(0);
  });
});

describe("getTransportLegsWithEvidenceForEntities — correlated direct evidence", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const feedstockEntityId = crypto.randomUUID();
  const sampleEntityId = crypto.randomUUID();
  const legIds: string[] = [];
  const documentIds: string[] = [];

  beforeAll(async () => {
    await ensureTestOrg();

    const insertedLegs = await db
      .insert(transportLegs)
      .values([
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: feedstockEntityId,
          distanceKm: 25,
          distanceSource: "document",
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "sample",
          entityId: sampleEntityId,
          distanceKm: 10,
          distanceSource: "document",
          transportMethodType: "road",
          loadMassKg: 1,
        },
      ])
      .returning({ id: transportLegs.id });
    legIds.push(...insertedLegs.map((row) => row.id));
  });

  afterAll(async () => {
    if (documentIds.length > 0) {
      await db.delete(documents).where(inArray(documents.id, documentIds));
    }
    if (legIds.length > 0) {
      await db.delete(transportLegs).where(inArray(transportLegs.id, legIds));
    }
  });

  async function addEvidence(
    entityType: "feedstock" | "transport_leg",
    entityId: string,
    suffix: string,
  ) {
    const [document] = await db
      .insert(documents)
      .values({
        organizationId: TEST_ORG_ID,
        entityType,
        entityId,
        documentType: "bill_of_lading",
        fileName: `direct-${suffix}-${tag}.pdf`,
        fileUrl: `https://example.invalid/direct-${suffix}-${tag}.pdf`,
        uploadStatus: "uploaded",
      })
      .returning({ id: documents.id });
    documentIds.push(document.id);
  }

  async function loadDirectCounts() {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [feedstockRows, sampleRows] = await Promise.all([
      getTransportLegsWithEvidenceForEntities(
        ctx,
        "feedstock",
        [feedstockEntityId],
      ),
      getTransportLegsWithEvidenceForEntities(ctx, "sample", [sampleEntityId]),
    ]);
    return {
      feedstock: feedstockRows[0]?.transportEvidenceDocumentCount,
      sample: sampleRows[0]?.transportEvidenceDocumentCount,
    };
  }

  it("counts only evidence attached to the projected parent", async () => {
    await addEvidence("feedstock", crypto.randomUUID(), "sibling-feedstock");
    await addEvidence("transport_leg", crypto.randomUUID(), "sibling-leg");
    expect(await loadDirectCounts()).toEqual({ feedstock: 0, sample: 0 });

    await addEvidence("feedstock", feedstockEntityId, "target-feedstock");
    await addEvidence("transport_leg", legIds[1], "target-leg");
    expect(await loadDirectCounts()).toEqual({ feedstock: 1, sample: 1 });
  });
});
