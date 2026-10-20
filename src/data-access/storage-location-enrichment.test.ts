import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { createOrderInTransaction } from "./orders";
import { createDeliveryInTransaction } from "./delivery-output-writes";
import { enrichStorageLocationRows } from "./storage-location-enrichment";
import { seedOutputStockParents } from "../../tests/helpers/output-stock-fixture";
import { postMeasurement, postProduct, STOCK_DATE, STOCK_TIME } from "../../tests/helpers/posted-output-stock-fixture";
import { randomUUID } from "node:crypto";

const RECEIPT = { wetKg: 200, dryKg: 160, moisturePercent: 20 };
const DELIVERY = { wetKg: 160, dryKg: 128 };
const LOSS = { wetKg: 10, dryKg: 8 };
const ROLLBACK = new Error("Roll back enrichment fixture");

describe("product bin lifetime biochar received", () => {
  it("keeps lifetime dry biochar received while delivery and loss reduce stock", async () => {
    // Route the real readers and writers through one transaction, then discard
    // the whole fixture. No database resets or persistent fixture cleanup.
    await expect(db.transaction(async tx => {
      vi.spyOn(db, "transaction").mockImplementation(async callback => callback(tx));
      vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx));
      try {
        const parents = await seedOutputStockParents(tx as unknown as typeof db);
        const [bin] = await tx.update(storageLocations).set({ formulationId: parents.pure.id })
          .where(eq(storageLocations.id, parents.bin.id)).returning();
        const product = await postProduct(parents, {
          massKg: RECEIPT.wetKg, moistureContentPercent: RECEIPT.moisturePercent,
        });
        const order = await createOrderInTransaction(parents.ctx, tx, {
          code: `E2E-RECEIVED-O-${parents.tag}`, facilityId: parents.facility.id,
          customerId: parents.customer.id, customerLocationId: parents.location.id,
          formulationId: parents.pure.id, orderDate: new Date(STOCK_DATE),
          quantityKg: RECEIPT.wetKg, packaging: "loose",
        });
        const fixture = { ...parents, bin, product, order };
        const readInventory = async () => {
          const [enriched] = await enrichStorageLocationRows(parents.ctx, [{
            ...bin, facilityCode: parents.facility.code, facilityName: parents.facility.name,
            feedstockTypeName: null, formulationName: parents.pure.name,
          }]);
          return enriched.productInventory;
        };

        expect(await readInventory()).toMatchObject({
          biocharEquivalentKg: RECEIPT.dryKg, dryMassKg: RECEIPT.dryKg,
          currentMassKg: RECEIPT.wetKg,
        });
        const { delivery } = await createDeliveryInTransaction(parents.ctx, tx, {
          code: `E2E-RECEIVED-D-${parents.tag}`, orderId: order.id, storageLocationId: bin.id,
          deliveredAt: STOCK_TIME, deliveredWetMassKg: DELIVERY.wetKg,
          moisturePercent: RECEIPT.moisturePercent, idempotencyKey: randomUUID(),
        });
        expect(delivery.massDryKg).toBe(DELIVERY.dryKg);
        expect(await readInventory()).toMatchObject({
          biocharEquivalentKg: RECEIPT.dryKg,
          dryMassKg: RECEIPT.dryKg - DELIVERY.dryKg,
          currentMassKg: RECEIPT.wetKg - DELIVERY.wetKg,
        });
        await postMeasurement(fixture, {
          kind: "loss", wetMassKg: LOSS.wetKg, moisturePercent: RECEIPT.moisturePercent,
        });
        expect(await readInventory()).toMatchObject({
          biocharEquivalentKg: RECEIPT.dryKg,
          dryMassKg: RECEIPT.dryKg - DELIVERY.dryKg - LOSS.dryKg,
          currentMassKg: RECEIPT.wetKg - DELIVERY.wetKg - LOSS.wetKg,
        });
      } finally {
        vi.restoreAllMocks();
      }
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });
});
