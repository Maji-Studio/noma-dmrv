import type { GisBoundary } from "@/lib/geojson/types";
import type { ProductSourceAllocationFact } from "./biochar-product-application-allocation";

export interface BatchLineageFeedstockFact {
  id: string;
  code: string;
  status: string | null;
  deliveryDate: Date | null;
  massDryKg: number | null;
  wetMassUsedKg: number | null;
  eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
  supplierName: string | null;
  feedstockTypeName: string | null;
  feedstockDeliveryCode: string | null;
}

export interface BatchLineageRunFact {
  id: string;
  code: string;
  status: string | null;
  date: Date | string;
  biocharStorageName?: string | null;
  biocharOutputKg?: number | null;
  biocharDryMassKg: number | null;
  feedstockMassDryKg: number | null;
  reactor: {
    id: string;
    code: string;
    identifier: string;
    reactorType: string | null;
  } | null;
  feedstocks: BatchLineageFeedstockFact[];
}

export interface BatchLineageApplicationFact {
  id: string;
  code: string;
  status: string | null;
  applicationDate: Date;
  fieldIdentifier: string | null;
  evidenceMethod: "location" | "boundary" | "visual";
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gisBoundary: GisBoundary | null;
  biocharAppliedTons: number;
  biocharAppliedDryTons: number | null;
  sourceAllocation: ProductSourceAllocationFact | null;
  soilTemperatureC: number | null;
  facility: { id: string; code: string; name: string };
  delivery: {
    id: string;
    code: string;
    status: string | null;
    deliveryDate: Date;
    deliveredWetMassKg?: number | null;
    massDryKg: number | null;
  };
  order: {
    id: string;
    code: string;
    orderDate: Date;
    quantityKg: number | null;
  } | null;
  biocharProduct: {
    id: string;
    code: string;
    status: string | null;
    productionDate: Date;
    massKg: number | null;
    moistureContentPercent: number | null;
    formulationName: string | null;
    linkedProductionRunId: string;
  };
}

export interface CreditBatchLineageFacts {
  batchId: string;
  productionRunIds: string[];
  runs: BatchLineageRunFact[];
  applications: BatchLineageApplicationFact[];
  applicationIds: string[];
  appliedWeightTons: number;
}
