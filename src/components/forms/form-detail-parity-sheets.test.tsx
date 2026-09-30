/**
 * Detail level parity for every read sheet: each read-section builder renders
 * through the shared side-sheet spine at Simple, then at Detailed, and must
 * show the same field labels, section titles, actions and text outside
 * explanation blocks (docs/forms.md, "Simple and Detailed presentation").
 *
 * Section content that only fetches and lists (documents, evidence panels,
 * transport legs, sampling) is stubbed: the source scan in
 * `form-detail-parity.test.tsx` already proves those modules never read the
 * level. Content built on level-aware blocks (moisture splits, stock blocks,
 * applied batches, the mix pile) renders for real.
 *
 * A builder is a file ending `-read-sections.tsx` or a function returning
 * `DetailPanelSection[]`; adding one without a case here fails the coverage check.
 */
import type { ReactElement, ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => name }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilities: [{ id: "facility", timezone: "UTC" }] }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/hooks/use-output-stock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-output-stock")>(),
  useMatchingOutputBins: () => ({ data: [{ id: "bin", code: "PB-001", name: "Product bin", dryMassKg: 1500, estimatedWetMassKg: 1800 }], isLoading: false, error: null }),
  useOutputStockBalance: () => ({ data: { binName: "Mix bin", beforeDryKg: 1440, beforeEstimatedWetKg: 1800, moistureEstimate: { moisturePercent: 20 } }, isLoading: false, error: null }),
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [{ code: "B-001", dryMassKg: 800 }, { code: "B-002", dryMassKg: 640 }] }, isLoading: false, error: null }),
  useOutputStockHistory: () => ({ data: [{ id: "entry", deliveryId: "delivery", kind: "delivery", occurredAt: "2026-09-22T12:00:00.000Z", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 80, runs: [{ productionRunId: "run", code: "PR-001", dryMassKg: 80 }] }] }], isLoading: false, error: null }),
}));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: ({ triggerLabel }: { triggerLabel?: string }) => <button type="button">{triggerLabel ?? "Stock history"}</button> }));
vi.mock("@/components/storage-locations/bin-movement-history-modal", () => ({ BinMovementHistoryModal: ({ triggerLabel }: { triggerLabel: string }) => <button type="button">{triggerLabel}</button> }));
vi.mock("@/components/transport-legs", () => ({ TransportLegsSummary: stub("Transport legs"), TransportEvidencePanel: stub("Transport evidence") }));
vi.mock("@/components/ui/entity-detail-value", () => ({ EntityDetailValue: stub("Manure store") }));
vi.mock("@/components/feedstock-types/feedstock-type-sampling", () => ({ FeedstockTypeSampling: stub("Feedstock sampling") }));
vi.mock("@/components/production-runs/production-incident-table", () => ({ ProductionIncidentTable: stub("Incidents") }));
vi.mock("@/components/production-runs/production-sample-table", () => ({ ProductionSampleTable: stub("Samples") }));
vi.mock("@/components/production-runs/production-readings-documents", () => ({ ProductionReadingsDocuments: stub("Readings file"), isUploadedReadingsDocument: () => false }));
vi.mock("@/components/applications/application-evidence-panel", () => ({ ApplicationEvidencePanel: stub("Evidence panel") }));
vi.mock("@/components/applications/application-storage-location-sync", () => ({ ApplicationStorageLocationSync: stub("Application site") }));
vi.mock("@/components/applications/application-supporting-evidence-panel", () => ({ ApplicationSupportingEvidencePanel: stub("Supporting evidence") }));
vi.mock("@/components/samples/sample-documents-panel", () => ({ SampleDocumentsPanel: stub("Sample documents") }));
vi.mock("@/components/certification/facility-certifier-summary", () => ({ FacilityCertifierSummary: stub("Registry connection") }));

import { renderBothLevels, sourceFiles } from "./form-detail-parity-harness";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import { orderSheetSections } from "@/components/orders/order-read-sections";
import { creditBatchSheetSections } from "@/components/credit-batches/credit-batch-view";
import { productSheetSections } from "@/components/biochar-products/product-read-details";
import { applicationSheetSections } from "@/components/applications/application-read-sections";
import { customerSheetSections } from "@/components/customers/customer-read-sections";
import { deliverySheetSections } from "@/components/deliveries/delivery-read-sections";
import { facilitySheetSections } from "@/components/facilities/facility-read-sections";
import { feedstockTypeSheetSections } from "@/components/feedstock-types/feedstock-type-read-sections";
import { feedstockSheetSections } from "@/components/feedstocks/feedstock-read-sections";
import { formulationSheetSections } from "@/components/formulations/formulation-read-sections";
import { productionRunSheetSections } from "@/components/production-runs/production-run-read-sections";
import { reactorSheetSections } from "@/components/reactors/reactor-read-sections";
import { sampleSheetSections } from "@/components/samples/sample-read-sections";
import { storageLocationSheetSections } from "@/components/storage-locations/storage-location-read-sections";
import { supplierSheetSections } from "@/components/suppliers/supplier-read-sections";

const FACILITIES = [{ id: "facility", timezone: "UTC" }];
const noop = () => undefined;
/** Fixtures carry only the fields each builder reads. */
const as = <T,>(value: object) => value as unknown as T;
type Arg<F extends (...args: never[]) => unknown, I extends number = 0> = Parameters<F>[I];

const location = { name: "North field", country: "TZ", stateRegion: "Iringa", city: "Mafinga", address: "Plot 4", gpsLatitude: -8.3, gpsLongitude: 35.3, distanceFromFacilityKm: 12, isDefault: true, defaultSoilTemperatureC: 22 };

const storageBin = (type: string, stockMode: string) => as<Arg<typeof storageLocationSheetSections>>({
  id: `${type}-bin`, facilityId: "facility", type, stockMode, name: `${type} bin`, capacityKg: 5000, storageMethod: "Covered heap", storageDescription: null,
  feedstockTypeName: "Maize cobs", formulationName: "Mix",
  feedstockInventory: { currentWetMassKg: 900, pendingWetMassKg: 100, pendingBatchCount: 1, estimatedDryMassKg: 700, estimatedMoisturePercent: 22, feedstockTypes: ["Maize cobs"] },
  biocharInventory: { allocatedToProductsKg: 400, productionRunCount: 3, downstreamFormulations: ["Mix"] },
  productInventory: { batchCount: 2, biocharEquivalentKg: 1440, formulationNames: ["Mix"], appliedApplicationCount: 1, appliedDryMassKg: 200, lastAppliedAt: new Date("2026-09-01") },
});

/** Every read-section builder, rendered through the shared side-sheet spine. */
const READ_SECTION_CASES: { file: string; name: string; sections: DetailPanelSection[] }[] = [
  { file: "components/orders/order-read-sections.tsx", name: "order", sections: orderSheetSections(as({
    id: "order", facilityId: "facility", formulationId: "formulation", formulationName: "Mix", customerName: "Customer", customerLocationName: "North field",
    orderDate: new Date("2026-09-21"), quantityKg: 2000, packaging: "loose", value: 500, currency: "TZS", fulfillmentStatus: "partial", deliveryCount: 1, deliveredWetMassKg: 1200,
  })) },
  { file: "components/biochar-products/product-read-details.tsx", name: "biochar product", sections: productSheetSections(as({
    id: "product", facilityId: "facility", placedAt: "2026-09-21T12:00:00.000Z", massKg: 350, waterAddedKg: 50, moistureContentPercent: 5, sourceAllocatedDryMassKg: 200, densityKgM3: 300,
    formulation: { id: "formulation", name: "Biochar with manure" }, storageLocation: { id: "destination", name: "Product store" }, sourceBiocharStorageLocation: { id: "source", name: "Biochar store" },
    composition: { ingredients: [{ formulationIngredientId: "ingredient", feedstockTypeId: "feedstock", feedstockTypeName: "Chicken manure", feedstockTypeCategory: "manure", massKg: 100, massDryKg: 80, moistureContentPercent: 50 }] },
  }), "UTC") },
  { file: "components/credit-batches/credit-batch-view.tsx", name: "credit batch", sections: creditBatchSheetSections({
    creditBatch: as({
      id: "batch", code: "CB-26-001", facilityId: "facility", feedstockTypeName: "Maize cobs", durabilityOption: "200_year", startDate: "2026-01-01", endDate: "2026-03-31", appliedWeightTons: 12, productionRunCount: 1,
      co2eStoredPreview: { co2eStoredTonnes: 3.2, componentKey: "biochar_storage", formulaVersion: "v1", missingInputs: [], warnings: [], applicationResults: [{ fDurable: 0.85, rawFDurable: 0.9, durabilityCapped: true }] },
    }),
    productionRuns: as([{ id: "run", date: "2026-02-01", status: "completed", biocharStorageName: "Biochar store", biocharOutputKg: 1000, biocharDryMassKg: 800 }]),
    isLoadingRuns: false, runsError: null, isRetryingRuns: false, onRetryRuns: noop, isHealthLoading: false,
  }) },
  { file: "components/applications/application-read-sections.tsx", name: "application", sections: applicationSheetSections(as({
    id: "application", applicationDate: new Date("2026-09-02"), biocharAppliedTons: 5, biocharAppliedDryTons: 4, heldOutOfCredits: true,
    allocationShares: [{ applicationId: "application", deliveryId: "delivery", biocharProductId: "product", productCode: "BP-26-001", productionRunId: "run", productionRunCode: "PR-26-001", dryMassKg: 600, wetMassKg: 1200 }],
    fieldSizeHa: 1.5, fieldIdentifier: "Plot 4", cropType: "Maize", applicationMethodType: null, gpsLatitude: -8.3, gpsLongitude: 35.3,
    evidenceMethod: "location", gisBoundary: null, durabilityOption: "200_year", soilTemperatureSource: null, soilTemperatureC: 21,
  }), { delivery: { productBinName: "Product bin", formulationName: "Mix", deliveryDate: new Date("2026-09-01"), deliveryDay: "2026-09-01" }, lock: as({ data: false, isPending: false, error: null, isFetching: false, refetch: noop }), durabilityOption: "200_year" }) },
  { file: "components/customers/customer-read-sections.tsx", name: "customer", sections: customerSheetSections(as({ name: "Customer", contactEmail: null, contactPhone: "+255", cropType: "Maize", address: null }), [location]) },
  { file: "components/deliveries/delivery-read-sections.tsx", name: "delivery", sections: deliverySheetSections(as({
    id: "delivery", facilityId: "facility", deliveryDate: new Date("2026-09-01T10:00:00Z"), status: "delivered", orderCode: "OR-001", deliveredWetMassKg: 100, moistureContentPercent: 20,
    storageLocationId: "bin", massDryKg: 80, effectiveDistanceKm: 12, distanceKmOverride: 14, distanceNote: "Detour", effectiveDistanceSource: "manual",
  }), FACILITIES) },
  { file: "components/facilities/facility-read-sections.tsx", name: "facility", sections: facilitySheetSections(as({
    id: "facility", name: "Mafinga", country: "TZ", timezone: "Africa/Dar_es_Salaam", location: "Mafinga", address: null, gpsLatitude: -8.3, gpsLongitude: 35.3,
    contactEmail: null, contactPhone: null, durabilityOption: "200_year", reactorCount: 2,
    storageSummary: { feedstockBinCount: 2, biocharBinCount: 1, productBinCount: 3 }, inventorySummary: { feedstockWetKg: 1200, biocharKg: 800, productKg: 400 },
  })) },
  { file: "components/feedstock-types/feedstock-type-read-sections.tsx", name: "feedstock type", sections: feedstockTypeSheetSections(as({
    id: "type", name: "Maize cobs", code: "FT-001", category: "agricultural_residue", usage: "pyrolysis", archivedAt: null, isometricFeedstockTypeId: null, registryUrl: null, description: null,
  }), { facilityId: "facility", canManage: true }) },
  { file: "components/feedstocks/feedstock-read-sections.tsx", name: "feedstock delivery", sections: feedstockSheetSections(as({
    id: "feedstock", deliveryDate: new Date("2026-08-01"), supplierName: "Supplier", vehiclePlateNumber: "T 123", transportDistanceKm: 20, transportDistanceSource: "supplier_default",
    feedstockTypeName: "Maize cobs", massWetKg: 1000, moistureContentPercent: 20, massDryKg: 800, storageLocationCode: "FB-01", storageLocationName: "Feedstock bin", overrideJustification: null, notes: null,
  })) },
  { file: "components/formulations/formulation-read-sections.tsx", name: "formulation", sections: formulationSheetSections(as({
    id: "formulation", name: "Mix", description: null, biocharRatio: 0.6, ingredients: [{ feedstockTypeId: "manure", ratio: 0.4, feedstockType: { name: "Manure" } }],
  })) },
  { file: "components/production-runs/production-run-read-sections.tsx", name: "production run", sections: productionRunSheetSections(as({
    id: "run", facilityId: "facility", startTime: new Date("2026-09-01T08:00:00Z"), endTime: new Date("2026-09-01T16:00:00Z"), status: "complete", cancellationReason: null,
    reactorIdentifier: "R-1", operatorName: "Operator", feedstocks: [], feedstockDraws: [{ storageLocationName: "Feedstock bin", wetMassKg: 1000 }],
    totalFeedstockWetMassKg: 1000, feedstockMoisturePercent: 20, feedstockMassDryKg: 800, feedingRateKgHr: 120, residenceTimeMinutes: 30,
    biocharStorageLocationName: "Biochar bin", biocharOutputKg: 300, biocharMoisturePercent: 10, biocharDryMassKg: 270,
    dieselOperationLiters: 5, dieselGensetLiters: null, preprocessingFuelLiters: null, electricityKwh: 40,
  }), FACILITIES) },
  { file: "components/reactors/reactor-read-sections.tsx", name: "reactor", sections: reactorSheetSections(as({ identifier: "R-1", reactorType: "kon_tiki", nominalThroughputTph: 0.5 })) },
  { file: "components/samples/sample-read-sections.tsx", name: "sample (1000-year)", sections: sampleSheetSections(as({
    id: "sample", creditBatchCode: "CB-26-001", samplingTime: new Date("2026-09-01T09:00:00Z"), analysisDate: new Date("2026-09-10"), labName: "Lab", labAccreditation: null, volumeMl: 100, weightGrams: 50,
    totalCarbonPercent: 80, organicCarbonPercent: 75, inorganicCarbonPercent: 5, totalHydrogenPercent: 2, totalNitrogenPercent: 1, totalOxygenPercent: 10, totalSulfurPercent: 0.1,
    ashContentPercent: 8, moistureContentPercent: 5, bulkDensityKgPerM3: 300, ph: 9, saltContentGPerKg: 1, durabilityOption: "1000_year", hToCOrgRatio: 0.3, oToCOrgRatio: 0.1,
    randomReflectanceR0Percent: 2.5, sReflectanceFraction: 0.9, r0MeasurementCount: 500, r0AnalysisDate: new Date("2026-09-11"), reactiveCarbonPercent: 10, residualCarbonPercent: 70, tgaAnalysisDate: new Date("2026-09-12"),
    nutrientClaimEnabled: true, phosphorusPercent: 1, potassiumPercent: 1, magnesiumPercent: 1, calciumPercent: 1, ironPercent: 1,
  })) },
  { file: "components/storage-locations/storage-location-read-sections.tsx", name: "storage bin (feedstock)", sections: storageLocationSheetSections(storageBin("feedstock_bin", "fifo"), noop) },
  { file: "components/storage-locations/storage-location-read-sections.tsx", name: "storage bin (mix product)", sections: storageLocationSheetSections(storageBin("product_bin", "mix"), noop) },
  { file: "components/suppliers/supplier-read-sections.tsx", name: "supplier", sections: supplierSheetSections(
    as({ name: "Supplier", contactName: null, contactEmail: null, contactPhone: null, location: "Mafinga", sourceRegion: "Iringa", address: null, distanceToFacilityKm: 20 }),
    as({ data: [location], isPending: false, isError: false, isFetching: false, refetch: noop }),
  ) },
];

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

describe("read sheet detail level parity", () => {
  it("covers every read-section builder", () => {
    const builders = sourceFiles()
      .filter(file => /\):\s*DetailPanelSection\[\]/.test(file.text) || file.path.endsWith("-read-sections.tsx"))
      .map(file => file.path);
    expect(builders.sort()).toEqual([...new Set(READ_SECTION_CASES.map(entry => entry.file))].sort());
  });

  it.each(READ_SECTION_CASES)("$name shows the same fields, sections and actions at both levels", async ({ sections }) => {
    const element: ReactElement = <EntitySideSheetSections numbered sections={sections} />;
    const { simple, detailed } = await renderBothLevels(element);
    expect(simple.items.some(item => item.startsWith("section:"))).toBe(true);
    expect(detailed.items).toEqual(simple.items);
    expect(detailed.text).toEqual(simple.text);
  });
});
