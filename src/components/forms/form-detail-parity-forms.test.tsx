/**
 * Detail level parity for sheet forms: every sheet form renders in create mode,
 * and one form per family also in edit mode, at Simple then at Detailed. Both
 * must show the same inputs, field labels, section titles, actions and text
 * outside explanation blocks (docs/forms.md, "Simple and Detailed presentation").
 * Stock preview hooks return a preview, so the delivery and stock forms render
 * it inside the form at both levels. Every `*-form.tsx` is either covered here or
 * listed in `NOT_SHEET_FORMS` with its reason; a new form fails the inventory.
 *
 * Data hooks are neutralised at the React Query seam, so every query reads as
 * settled and empty and no server action runs. That is enough for parity: a
 * form can only differ between the levels through a level reader, and those
 * are the primitives exercised with data in `form-detail-parity.test.tsx`.
 */
import type { ReactElement, ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const settled = { data: undefined, error: null, isLoading: false, isPending: false, isFetching: false, isError: false, isSuccess: true, status: "success", dataUpdatedAt: 0, refetch: async () => ({}) };
  const mutation = { mutate: () => undefined, mutateAsync: async () => undefined, reset: () => undefined, isPending: false, isError: false, error: null, data: undefined };
  const client = new actual.QueryClient();
  return {
    ...actual,
    useQuery: () => settled,
    useSuspenseQuery: () => settled,
    useQueries: ({ queries }: { queries: unknown[] }) => queries.map(() => settled),
    useInfiniteQuery: () => ({ ...settled, fetchNextPage: async () => ({}), hasNextPage: false }),
    useMutation: () => mutation,
    useQueryClient: () => client,
    useIsFetching: () => 0,
  };
});
const { PREVIEW } = vi.hoisted(() => ({ PREVIEW: {
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Preview bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420, removedDryKg: 1150, removedWetKg: 2000, movementMoisturePercent: 30,
  beforeEstimatedWetKg: 2600, afterEstimatedWetKg: 600, discrepancySolidsKg: 0, blockingMessage: null, blockers: [],
  allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 1150, runs: [{ productionRunId: "r1", code: "Run A", dryMassKg: 1150 }] }],
} }));
vi.mock("@/hooks/use-output-stock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-output-stock")>(),
  useOutputStockPreview: () => ({ data: PREVIEW, error: null, isFetching: false, isLoading: false, refetch: async () => ({}) }),
}));
vi.mock("@/hooks/use-product-stock-preview", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-product-stock-preview")>(),
  useProductStockPreview: () => ({ data: [PREVIEW], error: null, isFetching: false, isLoading: false, refetch: async () => ({}) }),
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/ui/toast")>(),
  useToast: () => ({ toast: () => undefined, success: () => undefined, error: () => undefined, info: () => undefined, dismiss: () => undefined }),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility", facilities: [{ id: "facility", name: "Mafinga", timezone: "UTC", durabilityOption: "200_year" }], selectedFacility: { id: "facility", name: "Mafinga", timezone: "UTC", durabilityOption: "200_year" } }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));

import { renderBothLevels, sourceFiles } from "./form-detail-parity-harness";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import { FeedstockForm } from "@/components/feedstocks/feedstock-form";
import { OutputStockForm } from "@/components/storage-locations/output-stock-form";
import { StorageLocationForm } from "@/components/storage-locations/storage-location-form";
import { ProductionRunForm } from "@/components/production-runs/production-run-form";
import { ProductionIncidentForm } from "@/components/production-runs/production-incident-form";
import { ProductionSampleForm } from "@/components/production-runs/production-sample-form";
import { BiocharProductForm } from "@/components/biochar-products/biochar-product-form";
import { FormulationForm } from "@/components/formulations/formulation-form";
import { OrderForm } from "@/components/orders/order-form";
import { DeliveryForm } from "@/components/deliveries/delivery-form";
import { ApplicationForm } from "@/components/applications/application-form";
import { CreditBatchForm } from "@/components/credit-batches/credit-batch-form";
import { SampleForm } from "@/components/samples/sample-form";
import { CustomerForm } from "@/components/customers/customer-form";
import { CustomerLocationForm } from "@/components/customers/customer-location-form";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { SupplierLocationForm } from "@/components/suppliers/supplier-location-form";
import { FacilityForm } from "@/components/facilities/facility-form";
import { ReactorForm } from "@/components/reactors/reactor-form";
import { FeedstockTypeForm } from "@/components/feedstock-types/feedstock-type-form";
import { DriverForm } from "@/components/drivers/driver-form";
import { OperatorForm } from "@/components/operators/operator-form";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { TransportLegForm } from "@/components/transport-legs/transport-leg-form";

const noop = () => undefined;
/** Fixtures carry only the fields each form reads. */
const as = <T,>(value: object) => value as unknown as T;
const DAY = new Date("2026-09-01T10:00:00Z");

/** `*-form.tsx` files that are not sheet forms, so the detail toggle never reaches them. */
const NOT_SHEET_FORMS: Record<string, string> = {
  "components/auth/forgot-password-form.tsx": "auth page, no detail toggle",
  "components/auth/login-form.tsx": "auth page, no detail toggle",
  "components/auth/reset-password-form.tsx": "auth page, no detail toggle",
  "components/auth/set-password-form.tsx": "auth page, no detail toggle",
  "components/organizations/invitation-bootstrap-form.tsx": "onboarding page, no detail toggle",
  "components/settings/organization-defaults-form.tsx": "settings page, no detail toggle",
  "components/admin/emission-estimates-form.tsx": "admin page, no detail toggle",
  "components/certification/facility-emission-factors-form.tsx": "settings page, no detail toggle",
  "components/api-keys/api-key-form.tsx": "settings dialog, no detail toggle",
};

function ProductionSampleFormHarness() {
  const deferredAttachments = useDeferredAttachments();
  return <ProductionSampleForm productionRunId="run" onSubmit={noop} deferredAttachments={deferredAttachments} onRetryDeferredAttachment={async () => undefined} onRemoveDeferredAttachment={noop} />;
}

type FormCase = { file: string; name: string; element: ReactElement; shows?: string };

/** Every sheet form in create mode, with only the props it requires. */
const CREATE_CASES: FormCase[] = [
  { file: "components/feedstocks/feedstock-form.tsx", name: "feedstock delivery", element: <FeedstockForm onSubmit={noop} /> },
  { file: "components/storage-locations/output-stock-form.tsx", name: "output stock loss", element: <OutputStockForm storageLocationId="bin" facilityId="facility" kind="loss" onCancel={noop} onRecorded={noop} />, shows: "Preview bin" },
  { file: "components/storage-locations/storage-location-form.tsx", name: "storage bin", element: <StorageLocationForm onSubmit={noop} /> },
  { file: "components/production-runs/production-run-form.tsx", name: "production run", element: <ProductionRunForm onSubmit={noop} /> },
  { file: "components/production-runs/production-incident-form.tsx", name: "production incident", element: <ProductionIncidentForm productionRunId="run" onSubmit={noop} /> },
  { file: "components/production-runs/production-sample-form.tsx", name: "production sample", element: <ProductionSampleFormHarness /> },
  // Its stock previews render only once bins are picked, which props cannot preset;
  // the stock blocks themselves are covered in form-detail-parity.test.tsx.
  { file: "components/biochar-products/biochar-product-form.tsx", name: "biochar product", element: <BiocharProductForm onSubmit={noop} /> },
  { file: "components/formulations/formulation-form.tsx", name: "formulation", element: <FormulationForm onSubmit={noop} /> },
  { file: "components/orders/order-form.tsx", name: "order", element: <OrderForm onSubmit={noop} /> },
  { file: "components/deliveries/delivery-form.tsx", name: "delivery", element: <DeliveryForm onSubmit={noop} />, shows: "Preview bin" },
  { file: "components/applications/application-form.tsx", name: "application", element: <ApplicationForm onSubmit={noop} /> },
  { file: "components/credit-batches/credit-batch-form.tsx", name: "credit batch", element: <CreditBatchForm onSubmit={noop} /> },
  { file: "components/samples/sample-form.tsx", name: "sample", element: <SampleForm onSubmit={noop} /> },
  { file: "components/customers/customer-form.tsx", name: "customer", element: <CustomerForm onSubmit={noop} /> },
  { file: "components/customers/customer-location-form.tsx", name: "customer location", element: <CustomerLocationForm onSubmit={noop} /> },
  { file: "components/suppliers/supplier-form.tsx", name: "supplier", element: <SupplierForm onSubmit={noop} /> },
  { file: "components/suppliers/supplier-location-form.tsx", name: "supplier location", element: <SupplierLocationForm onSubmit={noop} /> },
  { file: "components/facilities/facility-form.tsx", name: "facility", element: <FacilityForm onSubmit={noop} /> },
  { file: "components/reactors/reactor-form.tsx", name: "reactor", element: <ReactorForm onSubmit={noop} /> },
  { file: "components/feedstock-types/feedstock-type-form.tsx", name: "feedstock type", element: <FeedstockTypeForm onSubmit={noop} /> },
  { file: "components/drivers/driver-form.tsx", name: "driver", element: <DriverForm onSubmit={noop} /> },
  { file: "components/operators/operator-form.tsx", name: "operator", element: <OperatorForm onSubmit={noop} /> },
  { file: "components/vehicles/vehicle-form.tsx", name: "vehicle", element: <VehicleForm onSubmit={noop} /> },
  { file: "components/transport-legs/transport-leg-form.tsx", name: "transport leg", element: <TransportLegForm onSubmit={noop} onCancel={noop} /> },
];

/** One edit-mode case per family, from a saved entity. */
const EDIT_CASES: FormCase[] = [
  { file: "components/feedstocks/feedstock-form.tsx", name: "feedstock delivery (edit)", element: <FeedstockForm onSubmit={noop} feedstock={as({
    id: "feedstock", facilityId: "facility", deliveryDate: DAY, supplierId: "supplier", supplierName: "Supplier", feedstockTypeId: "type", feedstockTypeName: "Maize cobs",
    massWetKg: 1000, moistureContentPercent: 20, massDryKg: 800, storageLocationId: "bin", transportDistanceKm: 20, notes: null,
  })} /> },
  { file: "components/storage-locations/output-stock-form.tsx", name: "output stock correction (edit)", shows: "Preview bin", element: <OutputStockForm storageLocationId="bin" facilityId="facility" kind="count" onCancel={noop} onRecorded={noop} original={as({
    id: "00000000-0000-4000-8000-000000000001", deliveryId: null, kind: "count", occurredAt: "2026-09-22T12:00:00.000Z", recordedAt: "2026-09-22", actorName: null, reason: "Recorded",
    correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 80, afterDryKg: 0, allocations: [],
  })} /> },
  { file: "components/production-runs/production-run-form.tsx", name: "production run (edit)", element: <ProductionRunForm onSubmit={noop} productionRun={as({
    id: "run", facilityId: "facility", reactorId: "reactor", status: "complete", startTime: DAY, endTime: DAY, feedstockDraws: [{ storageLocationId: "bin", storageLocationName: "Feedstock bin", wetMassKg: 1000 }],
    feedstocks: [], totalFeedstockWetMassKg: 1000, feedstockMoisturePercent: 20, biocharOutputKg: 300, biocharMoisturePercent: 10, biocharStorageLocationId: "biochar-bin",
  })} /> },
  { file: "components/biochar-products/biochar-product-form.tsx", name: "biochar product (edit)", element: <BiocharProductForm onSubmit={noop} product={as({
    id: "product", facilityId: "facility", placedAt: "2026-09-21T12:00:00.000Z", massKg: 350, waterAddedKg: 50, moistureContentPercent: 5, sourceAllocatedDryMassKg: 200,
    formulationId: "formulation", storageLocationId: "destination", sourceBiocharStorageLocationId: "source", composition: { ingredients: [] },
  })} /> },
  { file: "components/orders/order-form.tsx", name: "order (edit)", element: <OrderForm onSubmit={noop} order={as({
    id: "order", facilityId: "facility", customerId: "customer", customerLocationId: "location", formulationId: "formulation", orderDate: DAY, quantityKg: 2000, packaging: "loose", value: 500, currency: "TZS",
  })} /> },
  { file: "components/deliveries/delivery-form.tsx", name: "delivery (edit)", element: <DeliveryForm onSubmit={noop} delivery={as({
    id: "delivery", facilityId: "facility", orderId: "order", storageLocationId: "bin", deliveryDate: DAY, deliveredWetMassKg: 100, moistureContentPercent: 20, status: "delivered",
  })} /> },
  { file: "components/applications/application-form.tsx", name: "application (edit)", element: <ApplicationForm onSubmit={noop} application={as({
    id: "application", deliveryId: "delivery", applicationDate: DAY, biocharAppliedTons: 5, fieldSizeHa: 1.5, evidenceMethod: "location",
  })} /> },
  { file: "components/credit-batches/credit-batch-form.tsx", name: "credit batch (edit)", element: <CreditBatchForm onSubmit={noop} creditBatch={as({
    id: "batch", facilityId: "facility", feedstockTypeId: "type", startDate: "2026-01-01", endDate: "2026-01-31", productionRunIds: ["run"], appliedWeightTons: 12,
  })} /> },
  { file: "components/samples/sample-form.tsx", name: "sample (edit)", element: <SampleForm onSubmit={noop} sample={as({
    id: "sample", creditBatchId: "batch", samplingTime: DAY, analysisDate: DAY, labName: "Lab", organicCarbonPercent: 75, durabilityOption: "200_year", nutrientClaimEnabled: false,
  })} /> },
  { file: "components/customers/customer-form.tsx", name: "customer (edit)", element: <CustomerForm onSubmit={noop} customerId="customer" customer={as({ id: "customer", name: "Customer", cropType: "Maize" })} /> },
  { file: "components/suppliers/supplier-form.tsx", name: "supplier (edit)", element: <SupplierForm onSubmit={noop} supplierId="supplier" supplier={as({ id: "supplier", name: "Supplier" })} /> },
  { file: "components/facilities/facility-form.tsx", name: "facility (edit)", element: <FacilityForm onSubmit={noop} facility={as({ id: "facility", name: "Mafinga", country: "TZ", timezone: "Africa/Dar_es_Salaam", durabilityOption: "200_year" })} /> },
  { file: "components/reactors/reactor-form.tsx", name: "reactor (edit)", element: <ReactorForm onSubmit={noop} reactor={as({ id: "reactor", facilityId: "facility", identifier: "R-1", reactorType: "kon_tiki", nominalThroughputTph: 0.5 })} /> },
  { file: "components/feedstock-types/feedstock-type-form.tsx", name: "feedstock type (edit)", element: <FeedstockTypeForm onSubmit={noop} feedstockType={as({ id: "type", name: "Maize cobs", code: "FT-001", category: "agricultural_residue", usage: "pyrolysis" })} /> },
  { file: "components/storage-locations/storage-location-form.tsx", name: "storage bin (edit)", element: <StorageLocationForm onSubmit={noop} storageLocation={as({ id: "bin", facilityId: "facility", type: "product_bin", stockMode: "mix", name: "Mix bin", formulationId: "formulation" })} /> },
  { file: "components/formulations/formulation-form.tsx", name: "formulation (edit)", element: <FormulationForm onSubmit={noop} formulation={as({ id: "formulation", name: "Mix", description: null, biocharRatio: 0.6, ingredients: [{ feedstockTypeId: "manure", ratio: 0.4, feedstockType: { name: "Manure" } }] })} /> },
];

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Pickers listen for outside clicks; this node suite has no DOM.
  vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("sheet form detail level parity", () => {
  it("covers every sheet form, or names why a form is not one", () => {
    const forms = sourceFiles().map(file => file.path).filter(path => path.endsWith("-form.tsx"));
    const covered = new Set([...CREATE_CASES, ...EDIT_CASES].map(entry => entry.file));
    expect(forms.filter(path => !covered.has(path) && !(path in NOT_SHEET_FORMS)).sort()).toEqual([]);
    // Every sheet form also has a create case.
    expect(new Set(CREATE_CASES.map(entry => entry.file)).size).toBe(covered.size);
  });

  it.each([...CREATE_CASES, ...EDIT_CASES])("$name form shows the same inputs, sections and actions at both levels", async ({ element, shows }) => {
    const { simple, detailed } = await renderBothLevels(element);
    expect(simple.items.some(item => item.startsWith("input:"))).toBe(true);
    if (shows) expect(simple.text).toContain(shows);
    expect(detailed.items).toEqual(simple.items);
    expect(detailed.text).toEqual(simple.text);
  });
});
