import { randomUUID } from "node:crypto";
import { createBiocharProductFn } from "@/fn/biochar-products";
import { previewProductStockFn } from "@/fn/product-stock-preview";
import { previewOutputStockFn } from "@/fn/output-stock";
import { createOrderFn } from "@/fn/orders";
import { createDeliveryFn } from "@/fn/deliveries";
import { createBiocharProductSchema } from "@/schemas/biochar-products";
import { createOrderSchema } from "@/schemas/orders";
import { deliveryFormSchema } from "@/schemas/deliveries";
import { deriveBlendMassKg } from "@/lib/biochar-composition";
import { MANURE, ORDER, PRODUCT, PRODUCT_DATES, SHIPMENT } from "./constants";
import { SeedError, unwrap, type SeedCounts } from "./actions";
import type { Infrastructure } from "./infrastructure";

export async function seedDistribution(infra: Infrastructure, counts: SeedCounts) {
  const facilityId = infra.facility.id;
  const ingredient = infra.formulation.ingredients.find(item => item.feedstockTypeId === infra.manure.id);
  if (!ingredient) throw new SeedError("create products: formulation ingredient missing");
  for (const placedAt of PRODUCT_DATES) {
    const form = {
      facilityId, formulationId: infra.formulation.id, placedAt,
      sourceBiocharStorageLocationId: infra.biocharBin.id, storageLocationId: infra.productBin.id,
      massKg: PRODUCT.biocharWetKg, moistureContentPercent: PRODUCT.moisturePercent,
      waterAddedKg: PRODUCT.waterAddedKg,
      ingredientBins: [{
        formulationIngredientId: ingredient.id, feedstockTypeId: infra.manure.id,
        feedstockTypeName: MANURE.name, feedstockTypeCategory: MANURE.category,
        ratio: ingredient.ratio, storageLocationId: infra.manureBin.id,
        massKg: PRODUCT.ingredientWetKg, moistureSource: "weighted_remaining" as const,
      }],
    };
    const preview = await unwrap(`preview product stock ${placedAt}`, previewProductStockFn(form));
    const blocked = preview.find(bin => bin.blockingMessage);
    if (blocked) throw new SeedError(`preview product stock ${placedAt}: ${blocked.blockingMessage}`);
    const basisFingerprint = preview[0]?.basisFingerprint;
    if (!basisFingerprint) throw new SeedError(`preview product stock ${placedAt}: missing stock basis`);
    // Mirrors prepareBiocharProductSubmission: preview takes BIOCHAR ONLY,
    // create takes pre-water blend total. Use its shared pure mass helper,
    // avoiding importing the client component into this CLI.
    const massKg = deriveBlendMassKg(form.massKg, form.ingredientBins);
    await unwrap(`create product ${placedAt}`, createBiocharProductFn(createBiocharProductSchema.parse({
      ...form, massKg, basisFingerprint, idempotencyKey: randomUUID(),
    })));
    counts.add("biochar products");
  }
  const order = await unwrap("create coffee farm order", createOrderFn(createOrderSchema.parse({
    facilityId, customerId: infra.customer.id, customerLocationId: infra.customerLocation.id,
    formulationId: infra.formulation.id, orderDate: ORDER.date, quantityKg: ORDER.quantityKg,
    packaging: ORDER.packaging, currency: ORDER.currency,
  })));
  counts.add("orders");
  const preview = await unwrap("preview delivery stock", previewOutputStockFn({
    facilityId, storageLocationId: infra.productBin.id, physicalDate: SHIPMENT.date,
    kind: "delivery", wetMassKg: SHIPMENT.wetMassKg, moisturePercent: SHIPMENT.moisturePercent,
  }));
  if (preview.blockingMessage) throw new SeedError(`preview delivery stock: ${preview.blockingMessage}`);
  await unwrap("create coffee farm delivery", createDeliveryFn({ ...deliveryFormSchema.parse({
    orderId: order.id, deliveryDate: SHIPMENT.date,
    storageLocationId: infra.productBin.id, idempotencyKey: randomUUID(), basisFingerprint: preview.basisFingerprint,
    driverId: infra.driver.id, vehicleId: infra.vehicle.id, status: "delivered",
    deliveredWetMassKg: SHIPMENT.wetMassKg, moistureContentPercent: SHIPMENT.moisturePercent,
    tripType: "one_way",
  }), facilityId, code: "" }));
  counts.add("deliveries");
}
