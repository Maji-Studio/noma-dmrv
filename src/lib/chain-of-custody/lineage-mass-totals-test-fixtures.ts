import type { ChainOfCustodyData, ChainSourceLineage } from "@/data-access/chain-of-custody";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";

export const RUN_ID = "production-run:run-1";
export const PRODUCT_ID = "biochar-product:product-1";
export const APPLICATION_ID = "application:application-1";
export const DELIVERY_ID = "delivery:delivery-1";
export const SOURCE_EDGE_ID = `${RUN_ID}->${PRODUCT_ID}`;
export const SHIPMENT_EDGE_ID = `${PRODUCT_ID}->${DELIVERY_ID}`;
export const APPLICATION_EDGE_ID = `${DELIVERY_ID}->${APPLICATION_ID}`;

export function massTotalsLineage(
  wetKg: number | null = 120,
  dryKg: number | null = 90,
): ChainOfCustodyData {
  const source: ChainSourceLineage = {
    productionRun: {
      id: "run-1", code: "PR-1", status: "complete", date: "2026-05-17",
      biocharOutputKg: 1_000, biocharDryMassKg: 900, feedstockMassDryKg: 2_000,
      href: "/production-runs",
    },
    reactor: null,
    feedstocks: [{
      ownsTransport: true, id: "feedstock-1", code: "FS-1", status: "complete", deliveryDate: null,
      massDryKg: 2_000, wetMassUsedKg: 3_000, supplierName: null,
      feedstockTypeName: null, href: "/feedstock-intake",
    }],
    allocatedWetMassKg: wetKg,
    allocatedDryMassKg: dryKg,
  };
  return {
    facility: { id: "facility-1", code: "FAC-1", name: "Fixture facility" },
    application: {
      id: "application-1", code: "AP-1", status: "applied",
      applicationDate: new Date("2026-05-20T00:00:00Z"), fieldIdentifier: null,
      evidenceMethod: "visual", gisBoundary: null, soilTemperatureC: null,
      biocharAppliedTons: wetKg == null ? null : kgToTonnes(wetKg),
      biocharAppliedDryTons: dryKg == null ? null : kgToTonnes(dryKg),
      href: "/applications",
    },
    delivery: {
      id: "delivery-1", code: "DL-1", status: "delivered", proofOfDeliveryCount: 0,
      deliveryDate: new Date("2026-05-19T00:00:00Z"), deliveredWetMassKg: 850,
      massDryKg: 820, href: "/deliveries",
    },
    order: { id: "order-1", code: "OR-1", orderDate: new Date("2026-05-18T00:00:00Z"), quantityKg: 850, href: "/orders" },
    biocharProduct: {
      id: "product-1", code: "BP-1", status: "ready", productionDate: "2026-05-18",
      massKg: 850, moistureContentPercent: 2, formulationName: null,
      linkedProductionRunId: "run-1", href: "/biochar-products",
    },
    productionRun: source.productionRun,
    reactor: source.reactor,
    feedstocks: source.feedstocks,
    sources: [source],
    warnings: [],
  };
}

