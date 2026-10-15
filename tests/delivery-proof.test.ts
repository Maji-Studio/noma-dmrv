import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents, organizations } from "@/db/schema";
import { getDeliveryProofCounts } from "@/data-access/delivery-proof";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("delivery proof projection", () => {
  it("counts only uploaded delivery proof for the requested organization and deliveries", async () => {
    const foreignOrgId = `org_proof_${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: foreignOrgId, name: "Proof test", slug: foreignOrgId });
    const deliveryId = crypto.randomUUID();
    const otherDeliveryId = crypto.randomUUID();
    const values = [
      { entityId: deliveryId, documentType: "delivery_receipt", uploadStatus: "pending" },
      { entityId: deliveryId, documentType: "delivery_receipt", uploadStatus: "failed" },
      { entityId: deliveryId, documentType: "weighbridge_ticket", uploadStatus: "uploaded" },
      { entityId: deliveryId, documentType: "other_transport_evidence", uploadStatus: "uploaded" },
      { entityId: otherDeliveryId, documentType: "photo", uploadStatus: "uploaded" },
    ] as const;
    const inserted = await db.insert(documents).values(values.map((value) => ({
      ...value, organizationId: TEST_ORG_ID, entityType: "delivery",
      fileName: "proof.pdf", storageProvider: "local-fs", storageBucket: "test",
      storageKey: `proof-test/${crypto.randomUUID()}`,
    }))).returning({ id: documents.id });
    const ids = inserted.map((row) => row.id);
    try {
      const ctx = makeTestOrgContext();
      expect((await getDeliveryProofCounts(ctx, [deliveryId, otherDeliveryId])).get(deliveryId) ?? 0).toBe(0);
      expect((await getDeliveryProofCounts(ctx, [deliveryId, otherDeliveryId])).get(otherDeliveryId)).toBe(1);
      for (const documentType of ["delivery_receipt", "bill_of_lading", "photo"] as const) {
        const [row] = await db.insert(documents).values({ organizationId: TEST_ORG_ID,
          entityType: "delivery", entityId: deliveryId, documentType, uploadStatus: "uploaded",
          fileName: "proof.pdf", fileUrl: "https://example.test/proof.pdf",
        }).returning({ id: documents.id });
        ids.push(row.id);
      }
      const [wrongOwner] = await db.insert(documents).values({ organizationId: TEST_ORG_ID,
        entityType: "feedstock", entityId: deliveryId, documentType: "bill_of_lading", uploadStatus: "uploaded",
        fileName: "proof.pdf", fileUrl: "https://example.test/proof.pdf",
      }).returning({ id: documents.id });
      ids.push(wrongOwner.id);
      expect((await getDeliveryProofCounts(ctx, [deliveryId])).get(deliveryId)).toBe(3);
      const [foreignProof] = await db.insert(documents).values({
        organizationId: foreignOrgId, entityType: "delivery", entityId: deliveryId,
        documentType: "delivery_receipt", uploadStatus: "uploaded",
        fileName: "proof.pdf", fileUrl: "https://example.test/proof.pdf",
      }).returning({ id: documents.id });
      ids.push(foreignProof.id);
      expect((await getDeliveryProofCounts(ctx, [deliveryId])).get(deliveryId)).toBe(3);
      expect((await getDeliveryProofCounts({ ...ctx, organizationId: foreignOrgId }, [deliveryId])).get(deliveryId)).toBe(1);
      await db.delete(documents).where(eq(documents.id, ids[values.length]));
      expect((await getDeliveryProofCounts(ctx, [deliveryId])).get(deliveryId)).toBe(2);
      expect(await getDeliveryProofCounts(ctx, [])).toEqual(new Map());
    } finally {
      await db.delete(documents).where(inArray(documents.id, ids));
      await db.delete(organizations).where(eq(organizations.id, foreignOrgId));
    }
  });
});
