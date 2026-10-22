// @vitest-environment jsdom
/**
 * Refused saves in the states they happen in: a new product (the mass is
 * editable, the stock previews are live) and a legacy product whose ingredient
 * rows are editable (#1327 PR G).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

const preview = vi.hoisted(() => ({
  block: null as string | null,
  // The recipe the product was made from, so the form's ingredient sync runs as it does on screen.
  formulation: null as unknown,
  recipe: {
    id: "22222222-2222-4222-8222-222222222222", biocharRatio: 0.5,
    ingredients: [{ id: "77777777-7777-4777-8777-777777777777", feedstockTypeId: "88888888-8888-4888-8888-888888888888", ratio: 0.5, feedstockType: { name: "Compost", category: "compost" } }],
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const base = { data: undefined, error: null, isLoading: false, isPending: false, isFetching: false, isError: false, isSuccess: true, status: "success", dataUpdatedAt: 0, refetch: async () => ({}) };
  const mutation = { mutate: () => undefined, mutateAsync: async () => undefined, reset: () => undefined, isPending: false, isError: false, error: null, data: undefined };
  const client = new actual.QueryClient();
  const useQuery = (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey ?? [];
    if (key[0] === "outputStock" && key[1] === "subBins") return { ...base, data: { stockMode: "mix", subBins: [] } };
    if (key[0] === "outputStock" && key[1] === "preview") return { ...base, data: { blockingMessage: preview.block, basisFingerprint: "fp-1" } };
    if (key[0] === "outputStock" && key[1] === "productPreview") return { ...base, data: [{ lane: "biochar", storageLocationId: "b", basisFingerprint: "fp-1", blockingMessage: null }] };
    if (key[0] === "formulations" && key[1] === "detail") return { ...base, data: preview.formulation };
    return base;
  };
  return {
    ...actual,
    useQuery,
    useSuspenseQuery: () => base,
    useQueries: ({ queries }: { queries: unknown[] }) => queries.map(() => base),
    useInfiniteQuery: () => ({ ...base, fetchNextPage: async () => ({}), hasNextPage: false }),
    useMutation: () => mutation,
    useQueryClient: () => client,
    useIsFetching: () => 0,
  };
});
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
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
  useFacilityContext: () => ({ facilityId: "55555555-5555-4555-8555-555555555555", facilities: [], selectedFacility: { id: "55555555-5555-4555-8555-555555555555", name: "Mafinga", timezone: "UTC" } }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  EntitySelect: ({ id, value, onChange }: { id?: string; value?: string; onChange: (value: string) => void }) => (
    <input data-testid={`pick-${id}`} name={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("@/components/forms/event-time-input", () => ({ EventTimeInput: () => null }));

import { BiocharProductForm } from "./biochar-product-form";
import { OPEN_LOCK } from "../../../tests/helpers/record-lock-mocks";

beforeEach(() => { preview.block = null; preview.formulation = null; });
afterEach(cleanup);

const SOURCE_BIN = "44444444-4444-4444-8444-444444444444";
const OTHER_BIN = "66666666-6666-4666-8666-666666666666";
const RECONCILIATION = "Open bin reconciliation";
const LOCKED = "Locked. Your change was not saved.";
const refusal = (code: string, path: (string | number)[], message: string) =>
  new ActionError({ error: message, code: code as never, issues: [{ path, code: code as never, message }] });

function fillNewProduct(errors: unknown[]) {
  const footers: Array<string | null> = [];
  let call = 0;
  const onSubmit = vi.fn((_data: unknown, onRefusal: SaveRefusalHandler) => { footers.push(onRefusal(errors[call++], "FALLBACK")); });
  render(<NuqsTestingAdapter><BiocharProductForm onSubmit={onSubmit} /></NuqsTestingAdapter>);
  const byName = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const pick = (id: string, value: string) => fireEvent.change(screen.getByTestId(`pick-${id}`), { target: { value } });
  pick("sourceBiocharStorageLocationId", SOURCE_BIN);
  pick("formulationId", "22222222-2222-4222-8222-222222222222");
  pick("storageLocationId", "33333333-3333-4333-8333-333333333333");
  fireEvent.change(byName("massKg"), { target: { value: "100" } });
  fireEvent.change(byName("moistureContentPercent"), { target: { value: "5" } });
  fireEvent.change(byName("waterAddedKg"), { target: { value: "0" } });
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create product" }));
  return { onSubmit, footers, submit, pick, byName };
}

describe("new product refused saves", () => {
  it("files a short source bin at the mass field with the reconciliation link and no footer", async () => {
    const message = "Not enough dry biochar in the selected bin for this wet mass at this moisture.";
    const { onSubmit, footers, submit } = fillNewProduct([refusal("insufficient_stock", ["biocharWetMassKg"], message)]);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(await screen.findByText(RECONCILIATION)).toBeTruthy();
    expect(footers).toEqual([null]);
  });

  it("files the zero-source refusal at the mass field without the reconciliation link", async () => {
    const message = "A product requires positive source biochar.";
    const { onSubmit, footers, submit } = fillNewProduct([refusal("validation_failed", ["biocharWetMassKg"], message)]);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(screen.queryByText(RECONCILIATION)).toBeNull();
    expect(footers).toEqual([null]);
  });

  it("files a short sub-bin at the mass field without the reconciliation link", async () => {
    const message = "This load holds more dry solids than SB-2 holds by the records.";
    const { onSubmit, footers, submit } = fillNewProduct([refusal("insufficient_stock", ["sources", 1], message)]);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(screen.queryByText(RECONCILIATION)).toBeNull();
    expect(footers).toEqual([null]);
  });

  it("drops the refusal and its link when another source bin is picked, and shows the live preview instead", async () => {
    const message = "Not enough dry biochar in the selected bin.";
    const live = "The other bin holds less than this.";
    const { onSubmit, submit, pick } = fillNewProduct([refusal("insufficient_stock", ["biocharWetMassKg"], message)]);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    await screen.findByText(RECONCILIATION);
    preview.block = live;
    pick("sourceBiocharStorageLocationId", OTHER_BIN);
    await waitFor(() => expect(screen.queryAllByText(message)).toHaveLength(0));
    expect(screen.queryByText(RECONCILIATION)).toBeTruthy();
    expect(screen.queryAllByText(live).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-form-error-summary]")).toBeNull();
  });

  it.each([
    ["moisture", (t: ReturnType<typeof fillNewProduct>) => fireEvent.change(t.byName("moistureContentPercent"), { target: { value: "6" } })],
    ["formulation", (t: ReturnType<typeof fillNewProduct>) => t.pick("formulationId", "12222222-2222-4222-8222-222222222222")],
  ])("clears the refusal and the error summary when the %s changes", async (_name, change) => {
    const message = "A product requires positive source biochar.";
    const form = fillNewProduct([refusal("validation_failed", ["biocharWetMassKg"], message)]);
    form.submit();
    await waitFor(() => expect(form.onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(document.querySelector("[data-form-error-summary]")?.textContent).toContain("Biochar wet mass");
    change(form);
    await waitFor(() => expect(screen.queryAllByText(message)).toHaveLength(0));
    expect(document.querySelector("[data-form-error-summary]")).toBeNull();
  });
});

describe("legacy product ingredient rows", () => {
  const ROW = {
    formulationIngredientId: "77777777-7777-4777-8777-777777777777", feedstockTypeId: "88888888-8888-4888-8888-888888888888", feedstockTypeName: "Compost",
    feedstockTypeCategory: "compost", ratio: 0.5, massKg: 50, moistureContentPercent: 30, storageLocationId: "99999999-9999-4999-8999-999999999999",
  };
  const product = {
    id: "11111111-1111-4111-8111-111111111111", version: 1, facility: { id: "55555555-5555-4555-8555-555555555555" }, placedAt: "2026-09-21T12:00:00.000Z",
    massKg: 350, waterAddedKg: 50, moistureContentPercent: 5, sourceAllocatedDryMassKg: 200, formulationId: "22222222-2222-4222-8222-222222222222",
    storageLocation: { id: "33333333-3333-4333-8333-333333333333" }, sourceBiocharStorageLocationId: null,
    linkedProductionRun: { biocharStorageLocationId: SOURCE_BIN }, composition: { ingredients: [ROW] },
  } as unknown as BiocharProductWithRelations;

  it("restores a changed row and says Locked at the rows when the composition is locked", async () => {
    preview.formulation = preview.recipe;
    const reason = "This product feeds a Removal sent to Isometric.";
    const footers: Array<string | null> = [];
    const onSubmit = vi.fn((_data: unknown, onRefusal: SaveRefusalHandler) => { footers.push(onRefusal(refusal("certification_locked", ["composition"], reason), "FALLBACK")); });
    render(<NuqsTestingAdapter><BiocharProductForm product={product} lock={OPEN_LOCK} onSubmit={onSubmit} /></NuqsTestingAdapter>);
    const mass = () => document.querySelector<HTMLInputElement>('[name="ingredientBins.0.massKg"]')!;
    const saved = mass().value;
    fireEvent.change(mass(), { target: { value: "60" } });
    fireEvent.blur(mass());
    fireEvent.click(screen.getByRole("button", { name: "Update product" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.getElementById("ingredientBins-error")?.textContent).toBe(LOCKED));
    // The summary names the set; the sentence itself shows once, under the rows.
    const entry = document.querySelector("[data-form-error-summary] a[href='#ingredientBins']");
    expect(entry?.textContent).toBe("Ingredients");
    expect(screen.getAllByText(LOCKED)).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.getElementById("ingredientBins-error")?.textContent).toBe(LOCKED);
    expect(mass().value).toBe(saved);
    expect(footers).toEqual([reason]);
  });
});
