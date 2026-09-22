import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import type { OutputStockHistoryEntry, OutputStockPreview } from "@/types/output-stock";

vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

const state = vi.hoisted(() => ({ blocker: null as string | null }));
vi.mock("@/hooks/use-output-stock", () => ({
  usePostOutputStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOutputStockPreview: () => ({ isFetching: false, refetch: vi.fn(), data: {
    basisFingerprint: "basis", storageLocationId: "bin", binName: "Source bin", lane: "biochar",
    beforeDryKg: 80, afterDryKg: 0, removedDryKg: 80, removedWetKg: 100,
    beforeEstimatedWetKg: 100, afterEstimatedWetKg: 0, estimateMoisturePercent: 20,
    discrepancySolidsKg: 0, allocations: [], blockingMessage: state.blocker,
  } satisfies Partial<OutputStockPreview> }),
}));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => <button type="button">Stock history</button> }));
import { OutputStockForm } from "./output-stock-form";

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
it("shows correction inputs and blockers without optional headings or allocations in Simple", async () => {
  const original: OutputStockHistoryEntry = { id: "00000000-0000-4000-8000-000000000001", deliveryId: null, kind: "count", physicalDate: "2026-09-22", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 0, moisturePercent: null, dryMassKg: 80, beforeDryKg: 80, afterDryKg: 0, allocations: [] };
  const form = () => <FormDetailProvider scope="correction"><FormDetailControl /><OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" kind="count" original={original} onCancel={vi.fn()} onRecorded={vi.fn()} /></FormDetailProvider>;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(form()); });
  const simple = visible(renderer.root);
  for (const label of ["Stock preview", "Stock history", "Before loading", "Batch breakdown", "Original stock", "80 kg"]) expect(simple).not.toContain(label);
  expect(simple).toContain("Original entry");
  expect(simple).toContain("Physical date");
  expect(simple).toContain("Counted wet mass");
  expect(simple).toContain("Save correction");
  state.blocker = "Correction is blocked by a saved application";
  await act(async () => renderer.update(form()));
  expect(visible(renderer.root)).toContain(state.blocker);
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  expect(visible(renderer.root)).toContain("Original stock");
  expect(visible(renderer.root)).not.toContain("Batch breakdown");
  await act(async () => renderer.root.findAllByType("button").filter(node => node.props["aria-controls"]).forEach(node => node.props.onClick()));
  expect(visible(renderer.root)).toContain("Batch breakdown");
  expect(visible(renderer.root)).toContain("Before loading");
  expect(visible(renderer.root)).toContain("Stock history");
  await act(async () => renderer.unmount());
});
