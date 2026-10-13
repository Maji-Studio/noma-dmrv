import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import type { OutputStockPreview } from "@/types/output-stock";

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }) }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

const state = vi.hoisted(() => ({ blocker: null as string | null }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] }, error: null }),
  useOutputStockBalance: () => ({ data: undefined }),
  usePostOutputStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOutputStockPreview: () => ({ isFetching: false, refetch: vi.fn(), data: {
    basisFingerprint: "basis", storageLocationId: "bin", binName: "Source bin", lane: "biochar",
    beforeDryKg: 80, afterDryKg: 0, removedDryKg: 80, removedWetKg: 100,
    beforeEstimatedWetKg: 100, afterEstimatedWetKg: 0, movementMoisturePercent: 20,
    discrepancySolidsKg: 0, allocations: [], blockingMessage: state.blocker,
  } satisfies Partial<OutputStockPreview> }),
}));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => <button type="button">Stock history</button> }));
import { OutputStockForm } from "./output-stock-form";

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
it("shows lost-mass inputs, the stock preview and blockers at both levels, and keeps the calculation Detailed", async () => {
  const form = () => <FormDetailProvider scope="loss"><FormDetailControl /><OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} /></FormDetailProvider>;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(form()); });
  const simple = visible(renderer.root);
  // The wet balance and the movement card are decision info.
  for (const label of ["Stock history", "Source bin", "Wet stock in bin, estimate"]) expect(simple).toContain(label);
  expect(simple).not.toContain("Dry biochar removed");
  expect(simple).not.toContain("Original entry");
  expect(simple).toContain("Date and time");
  expect(simple).toContain("Wet mass removed");
  expect(simple).toContain("Save lost mass");
  state.blocker = "Not enough stock in this bin";
  await act(async () => renderer.update(form()));
  expect(visible(renderer.root)).toContain(state.blocker);
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  const detailed = visible(renderer.root);
  // Detailed keeps the same card and adds its explanation: the figures behind
  // it sit in the card's single collapsed disclosure.
  expect(detailed).toContain("Wet stock in bin, estimate");
  expect(detailed).toContain("Dry biochar");
  expect(detailed).toContain("80 kg");
  expect(detailed).toContain("Source bin");
  expect(detailed).toContain("Stock history");
  expect(detailed).not.toContain("Batch breakdown");
  expect(detailed).not.toContain("Dry biochar removed");
  const disclosures = renderer.root.findAllByType("button").filter(node => node.props["aria-controls"]);
  expect(disclosures).toHaveLength(1);
  expect(disclosures[0].props["aria-expanded"]).toBe(false);
  await act(async () => disclosures[0].props.onClick());
  expect(visible(renderer.root)).toContain("Dry biochar removed");
  await act(async () => renderer.unmount());
});
