/**
 * The product form draws biochar from its source bin (a production draw). When
 * that draw is wetter than the bin's estimate the form shows the same
 * re-estimate notice as the stock forms and drops its fields' own advisory.
 */
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { act } from "react-test-renderer";
import type { ReactNode } from "react";
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
  reestimate: null as unknown,
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


import { MassMoistureFields } from "@/components/forms/mass-moisture-fields";
import { renderForm } from "@/components/forms/form-required-markers-harness";
import { ReestimateNotice } from "@/components/storage-locations/reestimate-notice";
import { BiocharProductForm } from "./biochar-product-form";

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterAll(() => { vi.unstubAllGlobals(); });

const REESTIMATE = { moisturePercent: 50, layers: [{ layerId: "a", name: "Batch A", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }], stayWetKg: 110, staySolidsKg: 55, stayDryKg: 55 };

async function open() {
  const renderer = await renderForm(<NuqsTestingAdapter><BiocharProductForm onSubmit={() => undefined} /></NuqsTestingAdapter>);
  const result = { notices: renderer.root.findAllByType(ReestimateNotice).map(notice => ({ kind: notice.props.kind as string })), hidden: renderer.root.findByType(MassMoistureFields).props.moisture.hideDeviationWarning };
  await act(async () => renderer.unmount());
  return result;
}

describe("biochar product source draw", () => {
  it("shows the re-estimate notice for the biochar and hides the moisture field's own advisory", async () => {
    PREVIEW.reestimate = REESTIMATE;
    const { notices, hidden } = await open();
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("biochar");
    expect(hidden).toBe(true);
  });

  it("shows neither while the draw does not re-estimate", async () => {
    PREVIEW.reestimate = null;
    const { notices, hidden } = await open();
    expect(notices).toHaveLength(0);
    expect(hidden).toBe(false);
  });
});
