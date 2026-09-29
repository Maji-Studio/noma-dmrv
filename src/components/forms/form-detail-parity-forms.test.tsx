/**
 * Detail level parity for sheet forms: one form per family renders at Simple,
 * then at Detailed, and must show the same inputs, field labels, section
 * titles, actions and text outside explanation blocks (docs/forms.md, "Simple
 * and Detailed presentation").
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

import { renderBothLevels } from "./form-detail-parity-harness";
import { FeedstockForm } from "@/components/feedstocks/feedstock-form";
import { OutputStockForm } from "@/components/storage-locations/output-stock-form";
import { ProductionRunForm } from "@/components/production-runs/production-run-form";
import { BiocharProductForm } from "@/components/biochar-products/biochar-product-form";
import { OrderForm } from "@/components/orders/order-form";
import { ApplicationForm } from "@/components/applications/application-form";
import { CreditBatchForm } from "@/components/credit-batches/credit-batch-form";
import { SampleForm } from "@/components/samples/sample-form";

const noop = () => undefined;

/** One create form per family, with only the props the form requires. */
const FORM_CASES: { name: string; element: ReactElement }[] = [
  { name: "feedstock delivery", element: <FeedstockForm onSubmit={noop} /> },
  { name: "output stock loss", element: <OutputStockForm storageLocationId="bin" facilityId="facility" kind="loss" onCancel={noop} onRecorded={noop} /> },
  { name: "production run", element: <ProductionRunForm onSubmit={noop} /> },
  { name: "biochar product", element: <BiocharProductForm onSubmit={noop} /> },
  { name: "order", element: <OrderForm onSubmit={noop} /> },
  { name: "application", element: <ApplicationForm onSubmit={noop} /> },
  { name: "credit batch", element: <CreditBatchForm onSubmit={noop} /> },
  { name: "sample", element: <SampleForm onSubmit={noop} /> },
];

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Pickers listen for outside clicks; this node suite has no DOM.
  vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("sheet form detail level parity", () => {
  it.each(FORM_CASES)("$name form shows the same inputs, sections and actions at both levels", async ({ element }) => {
    const { simple, detailed } = await renderBothLevels(element);
    expect(simple.items.some(item => item.startsWith("input:"))).toBe(true);
    expect(detailed.items).toEqual(simple.items);
    expect(detailed.text).toEqual(simple.text);
  });
});
