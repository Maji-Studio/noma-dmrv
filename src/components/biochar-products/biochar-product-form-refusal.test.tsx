// @vitest-environment jsdom
/**
 * A refused product save lands at the form field the server names, through
 * the aliases next to the payload builder (#1327 PR G).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { BIOCHAR_PRODUCT_REFUSAL_ALIASES } from "@/lib/biochar-composition/product-submission";
import { planSaveRefusal } from "@/lib/save-refusal";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

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
  InfoHint: () => null,
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
  useFacilityContext: () => ({ facilityId: "facility", facilities: [], selectedFacility: { id: "facility", name: "Mafinga", timezone: "UTC" } }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  EntitySelect: () => null,
}));
vi.mock("@/components/forms/event-time-input", () => ({ EventTimeInput: () => null }));

import { BiocharProductForm } from "./biochar-product-form";
import { OPEN_LOCK } from "../../../tests/helpers/record-lock-mocks";

afterEach(cleanup);

const LOCK_REASON = "This product feeds a Removal sent to Isometric. Correct the Removal first.";
const FALLBACK = "Biochar product was not saved. Try again.";
const FACILITY_ID = "55555555-5555-4555-8555-555555555555";
const product = {
  id: "11111111-1111-4111-8111-111111111111", version: 1, facility: { id: FACILITY_ID }, placedAt: "2026-09-21T12:00:00.000Z", massKg: 350, waterAddedKg: 50, moistureContentPercent: 5,
  sourceAllocatedDryMassKg: 200, formulationId: "22222222-2222-4222-8222-222222222222", storageLocation: { id: "33333333-3333-4333-8333-333333333333" },
  sourceBiocharStorageLocationId: "44444444-4444-4444-8444-444444444444", composition: { ingredients: [] },
} as unknown as BiocharProductWithRelations;

const refusal = (code: string, path: (string | number)[], message: string) =>
  new ActionError({ error: message, code: code as never, issues: [{ path, code: code as never, message }] });

function submitRefused(error: ActionError, edit: () => void = () => undefined) {
  const footers: Array<string | null> = [];
  const onSubmit = vi.fn((_data: unknown, onRefusal: SaveRefusalHandler) => { footers.push(onRefusal(error, FALLBACK)); });
  render(<NuqsTestingAdapter><BiocharProductForm product={product} lock={OPEN_LOCK} onSubmit={onSubmit} /></NuqsTestingAdapter>);
  edit();
  fireEvent.click(screen.getByRole("button", { name: "Update product" }));
  return { onSubmit, footers };
}

describe("BiocharProductForm refused saves", () => {
  it("brings the saved value back into a locked field and keeps the reason in the footer", async () => {
    const field = () => document.querySelector<HTMLInputElement>('input[name="densityKgM3"]')!;
    let saved = "";
    const { onSubmit, footers } = submitRefused(
      refusal("certification_locked", ["densityKgM3"], LOCK_REASON),
      () => { saved = field().value; fireEvent.change(field(), { target: { value: "75" } }); },
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ densityKgM3: 75 });
    await screen.findByText("Locked. Your change was not saved.");
    expect(field().value).toBe(saved);
    expect(footers).toEqual([LOCK_REASON]);
  });
});

describe("BIOCHAR_PRODUCT_REFUSAL_ALIASES", () => {
  const plan = (path: (string | number)[]) =>
    planSaveRefusal(refusal("validation_failed", path, "Refused."), {
      aliases: BIOCHAR_PRODUCT_REFUSAL_ALIASES, isShown: () => true, isChanged: () => true,
    })?.fieldErrors.map((error) => error.field);

  it.each([
    [["biocharWetMassKg"], "massKg"],
    [["biocharMoisturePercent"], "moistureContentPercent"],
    [["ingredients", 1, "wetMassKg"], "ingredientBins.1.massKg"],
    [["ingredients", 0, "moisturePercent"], "ingredientBins.0.moistureContentPercent"],
    [["ingredients", 2, "storageLocationId"], "ingredientBins.2.storageLocationId"],
    [["composition"], "ingredientBins"],
    [["sources", 1], "massKg"],
    [["waterAddedKg"], "waterAddedKg"],
  ])("maps %j to %s", (path, field) => {
    expect(plan(path as (string | number)[])).toEqual([field]);
  });
});
