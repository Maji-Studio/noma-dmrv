/**
 * Required marker guards: every sheet form renders in create mode and is
 * submitted empty, and every field it refuses carries the star
 * (`form-required-markers-harness.tsx`). Conditional requirements start from a
 * valid fixture and empty one field.
 *
 * Data hooks are neutralised at the React Query seam, so every query reads as
 * settled and empty and no server action runs.
 */
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { act } from "react-test-renderer";
import type { ComponentProps, ReactElement, ReactNode } from "react";
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

import { DistanceOverrideField } from "@/components/transport-legs/distance-override-field";
import { FieldPositionField } from "@/components/applications/field-position-field";
import { ApplicationEvidencePanel } from "@/components/applications/application-evidence-panel";
import { RequiredMarker } from "./required-marker";
import { FormEntitySelect } from "./entity-select/form-entity-select";
import { FormField } from "./form-field";
import { ChoiceCardGroup } from "./choice-card-group";
import { EventTimeInput } from "./event-time-input";
import { change, conditionalRequired, renderForm, requiredMarkers } from "./form-required-markers-harness";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import { FeedstockForm } from "@/components/feedstocks/feedstock-form";
import { OutputStockForm } from "@/components/storage-locations/output-stock-form";
import { StorageLocationForm } from "@/components/storage-locations/storage-location-form";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";
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

function ProductionSampleFormHarness() {
  const deferredAttachments = useDeferredAttachments();
  return <ProductionSampleForm facilityId="facility" productionRunId="run" onSubmit={noop} deferredAttachments={deferredAttachments} onRetryDeferredAttachment={async () => undefined} onRemoveDeferredAttachment={noop} />;
}

type FormCase = { file: string; name: string; element: ReactElement; shows?: string };

/** Every sheet form in create mode, with only the props it requires. */
const CREATE_CASES: FormCase[] = [
  { file: "components/feedstocks/feedstock-form.tsx", name: "feedstock delivery", element: <FeedstockForm onSubmit={noop} /> },
  { file: "components/storage-locations/output-stock-form.tsx", name: "output stock loss", element: <OutputStockForm storageLocationId="bin" facilityId="facility" onCancel={noop} onRecorded={noop} />, shows: "Preview bin" },
  { file: "components/storage-locations/storage-location-form.tsx", name: "storage bin", element: <StorageLocationForm onSubmit={noop} /> },
  { file: "components/production-runs/production-run-form.tsx", name: "production run", element: <ProductionRunForm onSubmit={noop} /> },
  { file: "components/production-runs/production-incident-form.tsx", name: "production incident", element: <ProductionIncidentForm facilityId="facility" productionRunId="run" onSubmit={noop} /> },
  { file: "components/production-runs/production-sample-form.tsx", name: "production sample", element: <ProductionSampleFormHarness /> },
  // Its stock previews render only once bins are picked, which props cannot preset;
 
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

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Pickers listen for outside clicks; this node suite has no DOM.
  vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("storage bin form", () => {
  it.each([
    ["biochar_bin", "split", true], ["product_bin", "split", true],
    ["biochar_bin", "mix", false], ["product_bin", "mix", false], ["feedstock_bin", "split", false],
  ] as const)("shows default draw order only for split output bins (%s, %s)", async (type, stockMode, shown) => {
    const renderer = await renderForm(<StorageLocationForm onSubmit={noop}
      storageLocation={as({ id: "bin", facilityId: "facility", type, stockMode, drawOrder: "newest_first", name: "Bin" })} />);
    const labels = renderer.root.findAllByType(FormField).map(field => field.props.label);
    expect(labels.includes("Default draw order")).toBe(shown);
    await act(async () => renderer.unmount());
  });
});

/**
 * Fields that refuse an empty submit without carrying the star, each with the
 * reason: the rule is one of several fields, so no single input is required.
 */
const REFUSES_EMPTY_WITHOUT_STAR: Record<string, string[]> = {
  "production sample": ["weightGrams"], // at least one measured value, any field
};

describe("required markers match what a form needs to submit", () => {
  it.each(CREATE_CASES)("$name form stars every field an empty submit refuses", async ({ name, element }) => {
    const { starred, failing, markerCount } = await requiredMarkers(<NuqsTestingAdapter>{element}</NuqsTestingAdapter>);
    // Every star renders the shared RequiredMarker.
    expect(markerCount).toBeGreaterThanOrEqual(starred.length);
    const allowed = REFUSES_EMPTY_WITHOUT_STAR[name] ?? [];
    const unstarred = failing.filter(id => !starred.includes(id) && !allowed.includes(id));
    expect(unstarred).toEqual([]);
    // The exemptions stay honest: an exempt field still refuses an empty submit.
    for (const id of allowed) expect(failing).toContain(id);
  });

  it.each([
    ["running", ["reactorId", "startDate", "startTime", "feedstockDraws.0.storageLocationId", "feedstockDraws.0.wetMassKg"]],
    ["complete", ["reactorId", "startDate", "startTime", "endTime", "feedstockDraws.0.storageLocationId", "feedstockDraws.0.wetMassKg", "feedstockMoisturePercent", "biocharStorageLocationId", "biocharOutputKg", "biocharMoisturePercent"]],
    ["failed", ["reactorId", "startDate", "startTime", "endTime", "feedstockDraws.0.storageLocationId", "feedstockDraws.0.wetMassKg", "feedstockMoisturePercent"]],
    ["cancelled", ["reactorId", "cancellationReason", "startDate", "startTime", "feedstockDraws.0.storageLocationId", "feedstockDraws.0.wetMassKg"]],
  ] as const)("production run stars the fields a %s run needs, and no others", async (status, expected) => {
    const run = as<ProductionRunWithRelations>({ id: "run", facilityId: "facility", reactorId: "reactor", status, startTime: DAY, endTime: DAY, feedstockDraws: [{ storageLocationId: "bin", storageLocationName: "Feedstock bin", wetMassKg: 1000 }], feedstocks: [], totalFeedstockWetMassKg: 1000 });
    const { starred } = await requiredMarkers(<NuqsTestingAdapter><ProductionRunForm onSubmit={noop} productionRun={run} /></NuqsTestingAdapter>, { submit: false });
    expect([...starred].sort()).toEqual([...expected].sort());
  });
});

const NOW_ISO = "2026-09-01T10:00:00.000Z";
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
type Case = { name: string; target: Parameters<typeof conditionalRequired>[1]; element: ReactElement; empty?: Parameters<typeof conditionalRequired>[2] };
const application = (overrides: object) => as<NonNullable<ComponentProps<typeof ApplicationForm>["application"]>>({ id: "application", deliveryId: UUID_A, applicationDate: DAY, biocharAppliedTons: 5, fieldSizeHa: 1.5, evidenceMethod: "location", ...overrides });
const delivery = (overrides: object) => as<NonNullable<ComponentProps<typeof DeliveryForm>["delivery"]>>({ id: "delivery", facilityId: "facility", orderId: UUID_A, storageLocationId: UUID_B, deliveryDate: DAY, deliveredWetMassKg: 100, moistureContentPercent: 20, status: "delivered", ...overrides });
const CONDITIONAL_CASES: Case[] = [
  { name: "cancellation reason", target: "cancellationReason", element: <ProductionRunForm onSubmit={noop} productionRun={as<ProductionRunWithRelations>({ id: "run", facilityId: "facility", reactorId: "reactor", status: "cancelled", startTime: DAY, endTime: null, cancellationReason: null, feedstockDraws: [], feedstocks: [], totalFeedstockWetMassKg: 0 })} /> },
  { name: "delivery wet mass", target: "deliveredWetMassKg", element: <DeliveryForm onSubmit={noop} delivery={delivery({ deliveredWetMassKg: null })} /> },
  { name: "nutrient share", target: "phosphorusPercent", element: <SampleForm onSubmit={noop} sample={as({ id: "sample", creditBatchId: UUID_A, samplingTime: DAY, analysisDate: DAY, labName: "Lab", totalCarbonPercent: 80, organicCarbonPercent: 75, durabilityOption: "200_year", nutrientClaimEnabled: true })} /> },
  { name: "override distance", target: "distanceKmOverride", element: <DeliveryForm onSubmit={noop} delivery={delivery({})} />,
    empty: async root => { await change(() => root.findAllByType(DistanceOverrideField)[0]!.props.onOverride()); } },
  { name: "application GPS, set manually", target: "gps-latitude", element: <ApplicationForm onSubmit={noop} application={application({ gpsLatitude: 1, gpsLongitude: 2 })} />,
    empty: async root => {
      await change(() => root.findByType(FieldPositionField).props.onModeChange("manual"));
      await change(() => root.findByType(FieldPositionField).props.onPositionChange({ lat: null, lng: null }));
    } },
  { name: "application GIS reference", target: root => ({ starred: root.findAllByType(RequiredMarker).length > 0 && root.findByType(ApplicationEvidencePanel).props.mode === "boundary", error: root.findByType(ApplicationEvidencePanel).props.error }), element: <ApplicationForm onSubmit={noop} application={application({ evidenceMethod: "boundary", gisBoundary: null, gpsLatitude: 1, gpsLongitude: 2 })} /> },
  { name: "storage bin feedstock type", target: root => { const field = root.findAll(node => node.type === FormEntitySelect && node.props.name === "feedstockTypeId")[0]!.findByType(FormField); return { starred: Boolean(field.props.required), error: field.props.error }; }, element: <StorageLocationForm onSubmit={noop} storageLocation={as({ id: "bin", facilityId: "facility", type: "feedstock_bin", name: "Feedstock bin", feedstockTypeId: null })} /> },
  { name: "storage bin merge time", target: "mergedAt", element: <StorageLocationForm onSubmit={noop} storageLocation={as({ id: "bin", facilityId: UUID_A, type: "biochar_bin", stockMode: "split", drawOrder: "newest_first", name: "Biochar bin" })} />,
    empty: async root => {
      await change(() => root.findAllByType(ChoiceCardGroup).find(node => node.props.id === "stockMode")!.props.onChange({ target: { value: "mix", name: "stockMode" }, type: "change" }));
      await change(() => root.findAllByType(EventTimeInput)[0]!.findByType("input").props.onChange({ target: { value: "" } }));
    } },
  { name: "biochar product moisture", target: "moistureContentPercent", element: <BiocharProductForm onSubmit={noop} product={as({
    id: "product", facilityId: UUID_A, placedAt: NOW_ISO, massKg: 350, waterAddedKg: 50, moistureContentPercent: null, formulationId: UUID_A, storageLocationId: UUID_B,
    sourceBiocharStorageLocationId: UUID_A, composition: { ingredients: [] },
  })} /> },
];

/**
 * Starts from a valid fixture and empties one conditionally required field, so
 * the empty-submit guard's blind spot (Zod aborts a superRefine after an
 * invalid_type issue; handler checks run after validation) cannot hide it.
 * Not in this table, each covered by a focused test instead: the over-allocation
 * justification and the ingredient moisture (conditional-required-markers.test.tsx,
 * the forms need bins and formulations the query seam cannot supply) and the
 * output stock moisture (shown only once the stock preview picks a single reading).
 */
describe("a conditionally required field carries the star and the error together", () => {
  it.each(CONDITIONAL_CASES)("$name", async ({ target, element, empty }) => {
    const result = await conditionalRequired(<NuqsTestingAdapter>{element}</NuqsTestingAdapter>, target, empty);
    expect(result.starred).toBe(true);
    expect(result.error).toBeTruthy();
    expect(result.markerCount).toBeGreaterThan(0);
  });
});
